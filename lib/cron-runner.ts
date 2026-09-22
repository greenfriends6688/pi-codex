import { randomUUID } from "node:crypto";
import { computeNextRun, cronDueState, type CronTask } from "./cron-schedule";
import {
  applyRunResult,
  claimIsStale,
  isTaskExhausted,
  resolveRunTimeoutMs,
  resolveSessionMode,
  sessionDayKey,
  shouldNotifyRun,
  shouldReuseSession,
} from "./cron-lifecycle";
import {
  appendCronHistory,
  getCronConfigPath,
  patchCronTask,
  readCronFile,
  updateCronRun,
  type CronRunRecord,
} from "./cron-store";
import {
  classifyCronFailure,
  CRON_MAX_ATTEMPTS,
  retryPatchFor,
} from "./cron-failure";
import {
  finishRunRecord,
  skipRunRecord,
  startRunRecord,
  summarizeRunOutput,
  type CronClock,
  type CronRunStart,
} from "./cron-history";

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
 *
 * fork:zc-19 hardening (same file, no second scheduler):
 *   - a missed run records a `skipped` history entry with the reason and, for a
 *     one-shot, finalises the task instead of re-arming it;
 *   - a task runs at most once at a time, and a claim with no heartbeat for more
 *     than 10 minutes is reclaimed after a crash;
 *   - retryable failures back off 30s·2^(n-1) (cap 15 min, 5 attempts) instead of
 *     waiting for the next scheduled occurrence.
 */

export const CRON_TICK_MS = 30_000;

/** fork:zc-19 — how often a running task refreshes its claim. */
export const CRON_HEARTBEAT_MS = 60_000;

declare global {
  var __piCronTimer: ReturnType<typeof setInterval> | undefined;
  var __piCronRunning: Set<string> | undefined;
  /** fork:zc-21 — session ids currently executing a scheduled run (recursion guard). */
  var __piCronActiveSessionIds: Set<string> | undefined;
}

function runningTasks(): Set<string> {
  if (!globalThis.__piCronRunning) globalThis.__piCronRunning = new Set();
  return globalThis.__piCronRunning;
}

function activeScheduledSessions(): Set<string> {
  if (!globalThis.__piCronActiveSessionIds) globalThis.__piCronActiveSessionIds = new Set();
  return globalThis.__piCronActiveSessionIds;
}

/**
 * fork:zc-21 — mark the session a scheduled run is executing in. `cron-extension`
 * consults this so a run cannot create or modify more scheduled tasks.
 * Exported for tests and for the extension's default provider.
 */
export function markScheduledCronSession(sessionId: string, active: boolean): void {
  const sessions = activeScheduledSessions();
  if (active) sessions.add(sessionId);
  else sessions.delete(sessionId);
}

export function isScheduledCronRunSession(sessionId: string): boolean {
  return activeScheduledSessions().has(sessionId);
}

export interface CronRunResult {
  taskId: string;
  sessionId?: string;
  status: "ok" | "error" | "duplicate";
  error?: string;
  /** fork:zc-19 — set when the failure was scheduled for a backoff retry. */
  retryAt?: string;
}

export interface CronRunOptions {
  trigger?: CronRunStart["trigger"];
  /** 1 for the first try; a retry tick passes `retryAttempt + 1`. */
  attempt?: number;
  /** Injected clock (tests and deterministic ticks). */
  now?: CronClock;
  /**
   * Injected clock for heartbeats. Defaults to the real wall clock on purpose:
   * a tick's clock can be frozen, and a heartbeat frozen with it would make a
   * long-running task look like a crashed claim.
   */
  heartbeatNow?: CronClock;
}

/** The synchronous answer to "start this task now" (the run continues in the background). */
export interface CronLaunchResult {
  taskId: string;
  status: "ok" | "duplicate";
  error?: string;
}

/** Both single-flight checks in one place: in-memory and the persisted claim. */
function duplicateReason(task: CronTask, file: string, clock: CronClock): string | null {
  if (runningTasks().has(task.id)) return "already running";
  const initial = findTask(task.id, file) ?? task;
  // fork:zc-19 — a persisted `running` claim that is still fresh means another
  // holder (this process after a restart, or a crashed one under 10 minutes) is
  // alive; a stale one is reclaimed by cronTick/runCronTask and may restart.
  if (initial.lastStatus === "running" && !claimIsStale(initial, clock())) return "already running";
  return null;
}

/**
 * Start a task without waiting for the agent run to finish.
 *
 * `runCronTask` awaits settlement (retry classification, history end time,
 * output excerpt), so a caller that must stay responsive — the 30s tick and the
 * HTTP "run now" route — must not await it directly. The synchronous prefix of
 * `runCronTask` still registers the in-memory claim before this returns, so two
 * consecutive launches cannot both start.
 */
export function launchCronTask(task: CronTask, options: CronRunOptions = {}): CronLaunchResult {
  const clock: CronClock = options.now ?? (() => new Date());
  const file = getCronConfigPath();
  const duplicate = duplicateReason(task, file, clock);
  if (duplicate) return { taskId: task.id, status: "duplicate", error: duplicate };
  void runCronTask(task, options).catch((error) => {
    console.error(
      `[pi-web] cron task "${task.name}" runner crashed:`,
      error instanceof Error ? error.message : error,
    );
  });
  return { taskId: task.id, status: "ok" };
}

/** Run one task now and wait for the agent run to settle. */
export async function runCronTask(task: CronTask, options: CronRunOptions = {}): Promise<CronRunResult> {
  const clock: CronClock = options.now ?? (() => new Date());
  const heartbeatClock: CronClock = options.heartbeatNow ?? (() => new Date());
  const file = getCronConfigPath();
  const running = runningTasks();
  const duplicate = duplicateReason(task, file, clock);
  if (duplicate) return { taskId: task.id, status: "duplicate", error: duplicate };

  running.add(task.id);
  const trigger = options.trigger ?? "schedule";
  const attempt = Math.max(1, Math.floor(options.attempt ?? 1));
  const runId = randomUUID();
  const startedAt = clock();
  // A stale claim is being taken over (direct "Run now" before the next tick):
  // settle the abandoned history row first so it does not read "running" forever.
  const claimed = findTask(task.id, file) ?? task;
  if (claimed.lastStatus === "running" && claimIsStale(claimed, clock())) {
    recoverStaleClaim(claimed, file, startedAt);
  }
  const startRecord = startRunRecord({ id: runId, trigger, attempt, at: startedAt }, clock);
  appendCronHistory(task.id, startRecord, file);

  let sessionId: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    // Dynamic imports keep the scheduler out of the module graph of every request:
    // rpc-manager pulls in the whole agent runtime.
    const { startRpcSession } = await import("./rpc-manager");
    const { allowFileRoot } = await import("./file-access");
    const { ensureChatWorkspace } = await import("./chat-workspace");

    const current = findTask(task.id, file) ?? task;
    // Empty cwd = "default working directory" (the chat workspace), which is what the
    // task form's blank option means.
    const cwd = current.cwd || ensureChatWorkspace();

    // Same allow-list bookkeeping as /api/agent/new: a session in a brand-new cwd
    // must make that cwd readable for the file routes.
    allowFileRoot(cwd);

    // fork:fix-cron-lifecycle — 子会话复用。
    //
    // 复用判定放在建会话之前，且只依赖任务自身记录的 `reusableSessionId`
    // 与那个会话的上下文占用（从会话进程里问，不做额外的文件扫描）。
    const mode = resolveSessionMode(current);
    const reuseCandidate = mode === "new" ? { reuse: false as const } : await evaluateReuse(current, mode, clock());
    const { session, realSessionId } = reuseCandidate.reuse && reuseCandidate.sessionId
      ? await startRpcSession(reuseCandidate.sessionId, "", cwd, {
          ...(current.model ? { initialModel: current.model } : {}),
          ...(current.thinking ? { thinkingLevel: current.thinking as never } : {}),
        })
      : await startRpcSession(`__cron__${randomUUID()}`, "", cwd, {
          ...(current.model ? { initialModel: current.model } : {}),
          ...(current.thinking ? { thinkingLevel: current.thinking as never } : {}),
        });
    sessionId = realSessionId;
    // fork:zc-21 — while this run is in flight, cron write tools are refused.
    markScheduledCronSession(realSessionId, true);

    patchCronTask(task.id, {
      lastRunAt: startedAt.toISOString(),
      lastStatus: "running",
      lastSessionId: realSessionId,
      lastError: undefined,
      // fork:zc-19 — claim + heartbeat; starting the attempt clears the pending retry.
      heartbeatAt: startedAt.toISOString(),
      retryAt: undefined,
      retryAttempt: attempt,
    }, file);

    // fork:zc-19 — heartbeat so a long legitimate run is never mistaken for a
    // crashed claim (and a crashed one is reclaimed after CRON_CLAIM_STALE_MS).
    heartbeat = setInterval(() => {
      try {
        patchCronTask(task.id, { heartbeatAt: heartbeatClock().toISOString() }, file);
      } catch (error) {
        console.warn(`[pi-web] cron heartbeat failed for "${current.name}":`, error instanceof Error ? error.message : error);
      }
    }, CRON_HEARTBEAT_MS);
    heartbeat.unref?.();

    // 无人值守的任务不能无限占着会话：超时后按错误收尾（会累计失败计数，
    // 连续多次即自动暂停，见 lib/cron-lifecycle.ts）。
    const timeoutMs = resolveRunTimeoutMs(current);
    const result = await runPromptToSettlement(session, current.prompt, timeoutMs, clock);
    if (result.error) throw new Error(result.error);

    const outcome = applyRunResult(current, { status: "ok", previousFailures: current.consecutiveFailures ?? 0 });
    finishCronRun(
      task.id,
      runId,
      finishRunRecord(startRecord, {
        status: "ok",
        outputExcerpt: summarizeRunOutput(result.output),
        sessionId: realSessionId,
      }, clock),
      file,
    );
    patchCronTask(task.id, {
      runCount: outcome.runCount,
      lastStatus: "ok",
      lastError: undefined,
      consecutiveFailures: 0,
      retryAt: undefined,
      retryAttempt: undefined,
      heartbeatAt: undefined,
      reusableSessionId: realSessionId,
      reusableSessionDayKey: sessionDayKey(startedAt, current.schedule.timezone),
      ...(outcome.enabled === false ? { enabled: false } : {}),
      ...(outcome.completedAt ? { completedAt: outcome.completedAt } : {}),
    }, file);
    await notifyRunFinished(current, "ok", realSessionId);
    return { taskId: current.id, sessionId: realSessionId, status: "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = findTask(task.id, file) ?? task;
    // fork:zc-19 — retryable failures back off instead of failing the run outright.
    const failure = classifyCronFailure(error);
    const retryPatch = retryPatchFor(failure, attempt, clock());
    const retrying = retryPatch.retryAt !== undefined;

    if (retrying) {
      patchCronTask(task.id, {
        lastStatus: "error",
        lastError: message,
        heartbeatAt: undefined,
        ...retryPatch,
      }, file);
      finishCronRun(
        task.id,
        runId,
        finishRunRecord(startRecord, { status: "error", error: message, sessionId }, clock),
        file,
      );
      console.warn(
        `[pi-web] cron task "${current.name}" failed (attempt ${attempt}/${CRON_MAX_ATTEMPTS}, ${failure.code}); retrying at ${retryPatch.retryAt}: ${message}`,
      );
      return { taskId: current.id, status: "error", error: message, retryAt: retryPatch.retryAt };
    }

    // fork:fix-cron-lifecycle — 失败不再只是记一笔：连续失败到阈值会自动暂停，
    // 并把原因写在任务上（用户可见、可手动恢复；自动动作不删任务、不清历史）。
    const outcome = applyRunResult(current, {
      status: "error",
      error: message,
      previousFailures: current.consecutiveFailures ?? 0,
    });
    finishCronRun(
      task.id,
      runId,
      finishRunRecord(startRecord, { status: "error", error: message, sessionId }, clock),
      file,
    );
    patchCronTask(task.id, {
      lastStatus: "error",
      lastError: message,
      runCount: outcome.runCount,
      consecutiveFailures: outcome.consecutiveFailures,
      retryAt: undefined,
      retryAttempt: undefined,
      heartbeatAt: undefined,
      ...(outcome.enabled === false ? { enabled: false } : {}),
      ...(outcome.pausedReason ? { pausedReason: outcome.pausedReason } : {}),
    }, file);
    console.error(`[pi-web] cron task "${current.name}" failed (${failure.kind}/${failure.code}):`, message);
    await notifyRunFinished(current, "error", sessionId ?? current.lastSessionId);
    return { taskId: current.id, status: "error", error: message };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (sessionId) markScheduledCronSession(sessionId, false);
    running.delete(task.id);
  }
}

function findTask(id: string, file: string): CronTask | null {
  return readCronFile(file).tasks.find((task) => task.id === id) ?? null;
}

/** Persist a finished record; falls back to an append when the start row is gone. */
function finishCronRun(taskId: string, runId: string, record: CronRunRecord, file: string): void {
  if (!updateCronRun(taskId, runId, record, file)) appendCronHistory(taskId, record, file);
}

/**
 * fork:zc-19 — settle a claim whose heartbeat stopped (crashed process). The
 * history row becomes an error and the task turns schedulable again. Used by the
 * tick and by a direct "Run now" that arrives before the next tick.
 */
function recoverStaleClaim(task: CronTask, file: string, now: Date): void {
  const message = "运行中断：认领超过 10 分钟没有心跳，已回收";
  const staleRun = task.history?.find((run) => run.status === "running");
  if (staleRun?.id) {
    finishCronRun(
      task.id,
      staleRun.id,
      finishRunRecord(staleRun, { status: "error", error: message, finishedAt: now }, () => now),
      file,
    );
  } else {
    appendCronHistory(task.id, skipRunRecord({ at: now, trigger: "schedule" }, "claim_expired", () => now), file);
  }
  patchCronTask(task.id, { lastStatus: "error", lastError: message, heartbeatAt: undefined }, file);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fork:zc-14 — `session.send({type:"prompt"})` only acknowledges preflight; the
 * agent run continues in the background. The scheduler needs the real end, both
 * for the history row (duration + output) and for retry decisions, so this waits
 * until the wrapper reports idle, aborting at the task's timeout, and captures
 * the final assistant text as the output excerpt.
 */
async function runPromptToSettlement(
  session: { isRunning: () => boolean; send: (command: Record<string, unknown>) => Promise<unknown>; onEvent: (listener: (event: { type: string; [key: string]: unknown }) => void) => () => void; inner: { sessionManager: { getBranch: () => unknown[] } } },
  message: string,
  timeoutMs: number,
  clock: CronClock,
): Promise<{ error?: string; output?: string }> {
  let promptError: string | undefined;
  const unsubscribe = session.onEvent((event) => {
    if (event.type === "prompt_error" && typeof event.errorMessage === "string" && event.errorMessage) {
      promptError = event.errorMessage;
    }
  });
  const deadline = clock().getTime() + timeoutMs;
  try {
    await session.send({ type: "prompt", message });
    while (session.isRunning()) {
      if (clock().getTime() >= deadline) {
        try {
          await session.send({ type: "abort" });
        } catch {
          // The run already ended between the check and the abort; nothing to stop.
        }
        return { error: `运行超时（${Math.round(timeoutMs / 60000)} 分钟）` };
      }
      await delay(500);
    }
    if (promptError) return { error: promptError };
    return { output: lastAssistantText(session) };
  } finally {
    unsubscribe();
  }
}

function lastAssistantText(session: { inner: { sessionManager: { getBranch: () => unknown[] } } }): string | undefined {
  try {
    const branch = session.inner.sessionManager.getBranch();
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      const entry = branch[index] as { type?: string; message?: { role?: string; content?: unknown } } | null;
      if (!entry || entry.type !== "message" || entry.message?.role !== "assistant") continue;
      const content = entry.message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        const text = content
          .map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text" ? String((block as { text?: string }).text ?? "") : ""))
          .filter(Boolean)
          .join("\n");
        return text || undefined;
      }
    }
  } catch {
    // Reading back the output is best effort; the run itself already succeeded.
  }
  return undefined;
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
  now: Date,
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
  const decision = shouldReuseSession(mode, now, {
    reusableSessionId: candidate,
    reusableSessionDayKey: task.reusableSessionDayKey,
    contextRatio,
  }, task.schedule.timezone);
  return { reuse: decision.reuse, sessionId: decision.sessionId };
}

/** One pass over the file. Exported for tests and for an explicit "check now". */
export async function cronTick(now = new Date()): Promise<CronRunResult[]> {
  const results: CronRunResult[] = [];
  const file = getCronConfigPath();
  for (const listed of readCronFile(file).tasks) {
    if (!listed.enabled) continue;
    // fork:fix-cron-lifecycle — 达到 maxRuns 或已标记完成的任务不再调度。
    if (isTaskExhausted(listed)) continue;

    // fork:zc-19 — stale claim recovery. A crash leaves `lastStatus: "running"`
    // with a heartbeat that stops; once it is older than 10 minutes the run is
    // declared interrupted and the task becomes schedulable again.
    if (listed.lastStatus === "running" && claimIsStale(listed, now)) {
      recoverStaleClaim(listed, file, now);
    }
    const task = findTask(listed.id, file) ?? listed;

    // fork:zc-19 — a pending retry pre-empts the normal schedule; the task does
    // not fire twice for one logical run.
    if (task.retryAt) {
      const retryAt = Date.parse(task.retryAt);
      const attempts = task.retryAttempt ?? 0;
      if (Number.isFinite(retryAt) && retryAt <= now.getTime() && attempts < CRON_MAX_ATTEMPTS) {
        results.push(launchCronTask(task, { trigger: "retry", attempt: attempts + 1, now: () => now }));
        continue;
      }
      if (!Number.isFinite(retryAt) || attempts >= CRON_MAX_ATTEMPTS) {
        // Corrupt/exhausted retry state: clear it and let the normal schedule continue.
        patchCronTask(task.id, { retryAt: undefined, retryAttempt: undefined }, file);
      } else {
        continue; // retry is still in the future
      }
    }

    const anchor = task.lastRunAt ? new Date(task.lastRunAt) : new Date(task.createdAt);
    const safeAnchor = Number.isNaN(anchor.getTime()) ? now : anchor;
    const state = cronDueState(task.schedule, safeAnchor, now);

    // fork:zc-19 — nothing can ever fire again: the end date passed, or a
    // one-shot's time is gone (including tasks left stuck by an older build).
    // Stop cleanly instead of leaving an enabled task that can never run.
    const endDatePassed = Boolean(task.schedule.endDate) && !task.completedAt;
    const onceExpired = task.schedule.kind === "once" && !task.completedAt;
    if (!state.nextRunAt && !state.due && !state.missed && (endDatePassed || onceExpired)) {
      appendCronHistory(
        task.id,
        skipRunRecord(
          { at: now, trigger: "schedule" },
          endDatePassed ? "end_date_passed" : "computer_asleep_or_app_not_running",
          () => now,
        ),
        file,
      );
      patchCronTask(task.id, {
        enabled: false,
        completedAt: now.toISOString(),
        lastStatus: "skipped",
        lastError: undefined,
      }, file);
      continue;
    }

    if (state.missed) {
      // fork:zc-19 — missed while the app was closed/asleep: record WHY instead
      // of only bumping lastRunAt, then move a recurring task to its next future
      // slot and finalise a one-shot.
      const missedAt = computeNextRun(task.schedule, safeAnchor) ?? now;
      appendCronHistory(
        task.id,
        skipRunRecord({ at: missedAt, trigger: "schedule" }, "computer_asleep_or_app_not_running", () => now),
        file,
      );
      patchCronTask(task.id, {
        lastRunAt: now.toISOString(),
        lastStatus: "skipped",
        lastError: undefined,
        ...(task.schedule.kind === "once"
          ? { enabled: false, completedAt: now.toISOString() }
          : {}),
      }, file);
      continue;
    }
    if (!state.due) continue;
    results.push(launchCronTask(task, { trigger: "schedule", now: () => now }));
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
