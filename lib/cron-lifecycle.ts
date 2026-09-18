/**
 * fork:fix-cron-lifecycle — 定时任务的运行生命周期语义（纯逻辑，可在 Node 里单测）。
 *
 * 本仓库原有的调度能力（真 5 字段 cron + 时区 + idleWindow + 运行历史 + missed 标记）
 * 比对照项目更强，缺的是它那侧的**运行生命周期**四件事：
 *
 *   1. 子会话复用（同日复用 / 始终复用 / 每次新建）+ 用户手发消息即"毕业"；
 *   2. 连续失败自动暂停（失败不再只是记一笔，而是停下来等用户看）；
 *   3. `maxRuns` 达上限自动停用并标完成；
 *   4. 单次运行超时（原先跑多久都不会被自己砍掉）。
 *
 * 这里只放判定与补丁计算，副作用（读会话、abort、写文件）留在 `cron-runner.ts`。
 * 所有新字段都是可选，旧任务文件（version 1）无需迁移即可读。
 */

import type { CronTask, CronRunStatus } from "./cron-schedule";

/** 连续失败达到这个次数就自动暂停任务（与对照项目同值）。 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** 单次运行上限：无人值守的任务不能无限占着一个会话。 */
export const DEFAULT_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** 复用的会话上下文占用超过这个比例就换新会话（给 SDK 压缩留余量）。 */
export const SESSION_REUSE_CONTEXT_LIMIT = 0.7;

export type CronSessionMode = "new" | "daily" | "reuse";

/**
 * 完成通知策略。默认 `"error"`：定时任务成功是常态、不该每次打扰，
 * 失败才值得推一条到手机/桌面。
 */
export type CronNotifyMode = "never" | "always" | "success" | "error";

export function resolveSessionMode(task: Pick<CronTask, "sessionMode">): CronSessionMode {
  return task.sessionMode ?? "new";
}

/**
 * 某个时区下的自然日键（`YYYY-MM-DD`）。用 `Intl` 而不是手算偏移，
 * 这样跨夏令时不会错一天。
 */
export function sessionDayKey(date: Date, timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

export interface ReuseInput {
  /** 复用候选（上一次运行留下的会话）。 */
  reusableSessionId?: string;
  /** 该会话最后一次活动的日期键（由调用方按同一时区算好）。 */
  reusableSessionDayKey?: string;
  /** 该会话当前上下文占用率（0..1）；未知时传 undefined。 */
  contextRatio?: number;
  /** 用户是否已经在这个会话里手发过消息——是则"毕业"，不再当定时任务的容器。 */
  graduated?: boolean;
}

/**
 * 是否复用上一次的会话。
 * - `new`：永不复用；
 * - `daily`：同一天内复用；
 * - `reuse`：一直复用。
 * 两种情况都不复用：会话已"毕业"，或上下文占用已达上限。
 */
export function shouldReuseSession(
  mode: CronSessionMode,
  now: Date,
  input: ReuseInput,
  timeZone?: string,
): { reuse: boolean; sessionId?: string; reason: string } {
  if (mode === "new") return { reuse: false, reason: "mode-new" };
  const sessionId = input.reusableSessionId;
  if (!sessionId) return { reuse: false, reason: "no-previous-session" };
  if (input.graduated) return { reuse: false, reason: "graduated" };
  if (typeof input.contextRatio === "number" && input.contextRatio >= SESSION_REUSE_CONTEXT_LIMIT) {
    return { reuse: false, reason: "context-full" };
  }
  if (mode === "daily") {
    const today = sessionDayKey(now, timeZone);
    if (input.reusableSessionDayKey !== today) return { reuse: false, reason: "new-day" };
  }
  return { reuse: true, sessionId, reason: "reuse" };
}

/** 是否已达到运行次数上限（上限未设置时永远 false）。 */
export function isRunLimitReached(task: Pick<CronTask, "maxRuns" | "runCount">): boolean {
  if (typeof task.maxRuns !== "number" || task.maxRuns <= 0) return false;
  return task.runCount >= task.maxRuns;
}

/** 该任务是否应该被跳过（已停用、已完成、已达上限）。 */
export function isTaskExhausted(task: Pick<CronTask, "maxRuns" | "runCount" | "completedAt">): boolean {
  if (task.completedAt) return true;
  return isRunLimitReached(task);
}

export interface RunOutcomePatch {
  runCount: number;
  lastStatus: CronRunStatus;
  lastError?: string;
  consecutiveFailures: number;
  enabled?: boolean;
  pausedReason?: string;
  completedAt?: string;
}

export interface RunResultInput {
  status: "ok" | "error";
  error?: string;
  /** 任务当前的连续失败计数（由调用方从任务上读，便于单测构造边界）。 */
  previousFailures: number;
}

export interface RunOutcome extends RunOutcomePatch {
  /** 本次是否触发了自动暂停。 */
  paused: boolean;
  /** 本次是否达到 maxRuns 并标记完成。 */
  completed: boolean;
}

/**
 * 根据一次运行结果算出要写回任务的补丁。
 *
 * 两条自动动作都只改 `enabled` 并记原因，不删任务、不清历史——
 * 自动动作必须可被用户看见并撤销。
 */
export function applyRunResult(
  task: Pick<CronTask, "runCount" | "maxRuns">,
  input: RunResultInput,
): RunOutcome {
  const runCount = task.runCount + 1;

  if (input.status === "ok") {
    const outcome: RunOutcome = {
      runCount,
      lastStatus: "ok",
      lastError: undefined,
      consecutiveFailures: 0,
      paused: false,
      completed: false,
    };
    if (typeof task.maxRuns === "number" && task.maxRuns > 0 && runCount >= task.maxRuns) {
      outcome.completed = true;
      outcome.enabled = false;
      outcome.completedAt = new Date().toISOString();
    }
    return outcome;
  }

  const consecutiveFailures = input.previousFailures + 1;
  const paused = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
  const outcome: RunOutcome = {
    runCount,
    lastStatus: "error",
    lastError: input.error,
    consecutiveFailures,
    paused,
    completed: false,
  };
  if (paused) {
    outcome.enabled = false;
    outcome.pausedReason = `连续失败 ${consecutiveFailures} 次，已自动暂停`;
  }
  return outcome;
}

/** 是否应该为这次运行发通知。 */
export function shouldNotifyRun(
  task: Pick<CronTask, "notify">,
  status: "ok" | "error",
): boolean {
  const mode = task.notify ?? "error";
  if (mode === "never") return false;
  if (mode === "always") return true;
  return mode === "success" ? status === "ok" : status === "error";
}

/** 运行超时的上限：任务自带 timeoutMs 优先，否则用默认值。 */
export function resolveRunTimeoutMs(task: Pick<CronTask, "timeoutMs">): number {
  const value = task.timeoutMs;
  if (typeof value === "number" && value > 0) return value;
  return DEFAULT_RUN_TIMEOUT_MS;
}
