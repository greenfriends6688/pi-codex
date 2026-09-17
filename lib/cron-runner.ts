import { randomUUID } from "node:crypto";
import { cronDueState } from "./cron-schedule";
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

    const { session, realSessionId } = await startRpcSession(`__cron__${randomUUID()}`, "", cwd, {
      ...(task.model ? { initialModel: task.model } : {}),
      ...(task.thinking ? { thinkingLevel: task.thinking as never } : {}),
    });
    patchCronTask(task.id, {
      lastRunAt: new Date().toISOString(),
      lastStatus: "running",
      lastSessionId: realSessionId,
      runCount: task.runCount + 1,
      lastError: undefined,
    });

    await session.send({ type: "prompt", message: task.prompt });

    patchCronTask(task.id, { lastStatus: "ok", lastError: undefined });
    appendCronHistory(task.id, { at: new Date().toISOString(), status: "ok", sessionId: realSessionId });
    return { taskId: task.id, sessionId: realSessionId, status: "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    patchCronTask(task.id, { lastRunAt: new Date().toISOString(), lastStatus: "error", lastError: message });
    appendCronHistory(task.id, { at: new Date().toISOString(), status: "error", error: message });
    console.error(`[pi-web] cron task "${task.name}" failed:`, message);
    return { taskId: task.id, status: "error", error: message };
  } finally {
    running.delete(task.id);
  }
}

/** One pass over the file. Exported for tests and for an explicit "check now". */
export async function cronTick(now = new Date()): Promise<CronRunResult[]> {
  const results: CronRunResult[] = [];
  for (const task of readCronFile(getCronConfigPath()).tasks) {
    if (!task.enabled) continue;
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
