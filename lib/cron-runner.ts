import { randomUUID } from "node:crypto";
import { cronDueState } from "./cron-schedule";
import {
  applyRunResult,
  shouldNotifyRun,
  isTaskExhausted,
  resolveRunTimeoutMs,
  resolveSessionMode,
  sessionDayKey,
  shouldReuseSession,
} from "./cron-lifecycle";
import {
  appendCronHistory,
  getCronConfigPath,
  patchCronTask,
  readCronFile,
  toCronTaskView,
  type CronTask,
} from "./cron-store";

/**
 * fork:cron — the scheduler.
 *
 * Lives in the server process (started from `instrumentation.ts`) and runs a task
 * by opening an **ordinary session** through the same `startRpcSession` the UI
 * uses, then sending the prompt. No second process, no IPC: a scheduled run is
 * indistinguishable from a run the user started, so it appears in the sidebar and
 * can be opened, branched and archived like any conversation.
 *
 * Two deliberate limits:
 *   - One tick every 30s. Anything finer than that is not a coding task.
 *   - A missed occurrence is skipped, not replayed (see CRON_MISSED_WINDOW_MS);
 *     the server may have been asleep for hours and replaying old prompts then is
 *     worse than silence.
 */

export const CRON_TICK_MS = 30_000;

declare global {
  var __piCronTimer: ReturnType<typeof setInterval> | undefined;
  var __piCronRunning: Set<string> | undefined;
}

function runningTasks(): Set<string> {
  if (!globalThis.__piCronRunning) globalThis.__piCronRunning = new Set();
  return globalThis.__piCronRunning;
}

export interface CronRunResult {
  taskId: string;
  sessionId?: string;
  status: "ok" | "error";
  error?: string;
}

/** Run one task now. Exported so the API's "run now" uses the same path. */
export async function runCronTask(task: CronTask): Promise<CronRunResult> {
  const running = runningTasks();
  if (running.has(task.id)) return { taskId: task.id, status: "error", error: "already running" };
  running.add(task.id);

  try {
    // Dynamic imports keep the scheduler out of the module graph of every request:
    // rpc-manager pulls in the whole agent runtime.
    const { startRpcSession } = await import("./rpc-manager");
    const { allowFileRoot } = await import("./file-access");
    const { ensureChatWorkspace } = await import("./chat-workspace");

    // Empty cwd = "default working directory" (the chat workspace), which is what the
    // task form's blank option means.
    const cwd = task.cwd || ensureChatWorkspace();

    // Same allow-list bookkeeping as /api/agent/new: a session in a brand-new cwd
    // must make that cwd readable for the file routes.
    allowFileRoot(cwd);

    // fork:fix-cron-lifecycle — 子会话复用。
    //
    // 复用判定放在建会话之前，且只依赖任务自身记录的 `reusableSessionId`
    // 与那个会话的上下文占用（从会话进程里问，不做额外的文件扫描）。
    const mode = resolveSessionMode(task);
    const reuseCandidate = mode === "new" ? { reuse: false as const } : await evaluateReuse(task, mode);
    const startedAt = new Date();
    const { session, realSessionId } = reuseCandidate.reuse && reuseCandidate.sessionId
      ? await startRpcSession(reuseCandidate.sessionId, "", cwd, {
          ...(task.model ? { initialModel: task.model } : {}),
          ...(task.thinking ? { thinkingLevel: task.thinking as never } : {}),
        })
      : await startRpcSession(`__cron__${randomUUID()}`, "", cwd, {
          ...(task.model ? { initialModel: task.model } : {}),
          ...(task.thinking ? { thinkingLevel: task.thinking as never } : {}),
        });

    patchCronTask(task.id, {
      lastRunAt: new Date().toISOString(),
      lastStatus: "running",
      lastSessionId: realSessionId,
      lastError: undefined,
    });

    // 无人值守的任务不能无限占着会话：超时后按错误收尾（会累计失败计数，
    // 连续多次即自动暂停，见 lib/cron-lifecycle.ts）。
    const timeoutMs = resolveRunTimeoutMs(task);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        session.send({ type: "prompt", message: task.prompt }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`运行超时（${Math.round(timeoutMs / 60000)} 分钟）`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const outcome = applyRunResult(task, { status: "ok", previousFailures: task.consecutiveFailures ?? 0 });
    patchCronTask(task.id, {
      runCount: outcome.runCount,
      lastStatus: "ok",
      lastError: undefined,
      consecutiveFailures: 0,
      reusableSessionId: realSessionId,
      reusableSessionDayKey: sessionDayKey(startedAt, task.schedule.timezone),
      ...(outcome.enabled === false ? { enabled: false } : {}),
      ...(outcome.completedAt ? { completedAt: outcome.completedAt } : {}),
    });
    appendCronHistory(task.id, { at: new Date().toISOString(), status: "ok", sessionId: realSessionId });
    await notifyRunFinished(task, "ok", realSessionId);
    return { taskId: task.id, sessionId: realSessionId, status: "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // fork:fix-cron-lifecycle — 失败不再只是记一笔：连续失败到阈值会自动暂停，
    // 并把原因写在任务上（用户可见、可手动恢复；自动动作不删任务、不清历史）。
    const outcome = applyRunResult(task, {
      status: "error",
      error: message,
      previousFailures: task.consecutiveFailures ?? 0,
    });
    patchCronTask(task.id, {
      lastRunAt: new Date().toISOString(),
      lastStatus: "error",
      lastError: message,
      runCount: outcome.runCount,
      consecutiveFailures: outcome.consecutiveFailures,
      ...(outcome.enabled === false ? { enabled: false } : {}),
      ...(outcome.pausedReason ? { pausedReason: outcome.pausedReason } : {}),
    });
    appendCronHistory(task.id, { at: new Date().toISOString(), status: "error", error: message });
    console.error(`[pi-web] cron task "${task.name}" failed:`, message);
    await notifyRunFinished(task, "error", task.lastSessionId);
    return { taskId: task.id, status: "error", error: message };
  } finally {
    running.delete(task.id);
  }
}

/**
 * fork:fix-cron-notify — 运行结束后的完成通知。
 *
 * 复用已有的 Web Push 基础设施（`lib/web-push.ts`，桌面壳下它会主动跳过，
 * 由 Electron 原生通知接管），因此这里不需要新依赖。
 *
 * 两个刻意的边界：
 *   - 策略由任务自己的 `notify` 决定（默认只在失败时通知，见 lib/cron-lifecycle.ts）；
 *   - 失败发生在建会话之前时没有会话 id，此时**不发**通知——
 *     推送里点开要落到一个会话上，指不到会话的通知比不发更糟。
 *   - 通知失败绝不影响任务本身的成败（整段包在 try/catch 里）。
 */
async function notifyRunFinished(task: CronTask, status: "ok" | "error", sessionId?: string): Promise<void> {
  if (!shouldNotifyRun(task, status)) return;
  if (!sessionId) return;
  try {
    const { notifySessionComplete } = await import("./web-push");
    await notifySessionComplete(sessionId);
  } catch (error) {
    console.warn(
      `[pi-web] cron task "${task.name}" finished but the push notification failed:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * 复用判定：只问会话进程要上下文占用，不做文件扫描。
 * `get_state` 返回的 `contextUsage.percent` 缺失时按“占用未知”处理——
 * 也就是仍然允许复用（宁可复用也不要因为拿不到数字而每次都新建会话）。
 */
async function evaluateReuse(
  task: CronTask,
  mode: ReturnType<typeof resolveSessionMode>,
): Promise<{ reuse: boolean; sessionId?: string }> {
  const candidate = task.reusableSessionId;
  if (!candidate) return { reuse: false };
  let contextRatio: number | undefined;
  try {
    const { getRpcSession } = await import("./rpc-manager");
    const rpc = getRpcSession(candidate);
    if (rpc?.isAlive()) {
      const state = await rpc.send({ type: "get_state" }) as { contextUsage?: { percent?: number } } | undefined;
      const percent = state?.contextUsage?.percent;
      if (typeof percent === "number" && Number.isFinite(percent)) {
        contextRatio = percent > 1 ? percent / 100 : percent;
      }
    }
  } catch {
    // 会话进程已回收：保留复用意图，startRpcSession 会从文件恢复。
  }
  const decision = shouldReuseSession(mode, new Date(), {
    reusableSessionId: candidate,
    reusableSessionDayKey: task.reusableSessionDayKey,
    contextRatio,
  }, task.schedule.timezone);
  return { reuse: decision.reuse, sessionId: decision.sessionId };
}

/** One pass over the file. Exported for tests and for an explicit "check now". */
export async function cronTick(now = new Date()): Promise<CronRunResult[]> {
  const results: CronRunResult[] = [];
  for (const task of readCronFile(getCronConfigPath()).tasks) {
    if (!task.enabled) continue;
    // fork:fix-cron-lifecycle — 达到 maxRuns 或已标记完成的任务不再调度。
    if (isTaskExhausted(task)) continue;
    const anchor = task.lastRunAt ? new Date(task.lastRunAt) : new Date(task.createdAt);
    const state = cronDueState(task.schedule, Number.isNaN(anchor.getTime()) ? now : anchor, now);
    if (state.missed) {
      // Advance past the occurrence we skipped so it does not keep looking due.
      patchCronTask(task.id, { lastRunAt: now.toISOString(), lastError: "skipped (server was not running)" });
      continue;
    }
    if (!state.due) continue;
    results.push(await runCronTask(task));
  }
  return results;
}

export function startCronScheduler(): void {
  if (globalThis.__piCronTimer) return;
  const timer = setInterval(() => {
    void cronTick().catch((error) => {
      console.error("[pi-web] cron tick failed:", error instanceof Error ? error.message : error);
    });
  }, CRON_TICK_MS);
  // Do not hold the event loop open for the scheduler alone (tests, CLI usage).
  timer.unref?.();
  globalThis.__piCronTimer = timer;
}

export function stopCronScheduler(): void {
  if (!globalThis.__piCronTimer) return;
  clearInterval(globalThis.__piCronTimer);
  globalThis.__piCronTimer = undefined;
}

export { toCronTaskView };
