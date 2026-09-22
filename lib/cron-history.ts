/**
 * fork:zc-14 — cron run history (pure logic + a tolerant parser).
 *
 * WHY: the scheduler already kept a bounded list of run outcomes on each task
 * (`CronRunRecord[]`), but the entries only had `{ at, status }`. The history
 * browser needs start/end, trigger, attempt, an output excerpt, and a stable id
 * so a still-running entry can be finished in place and a bad row deleted. All of
 * that is derived here, with the clock injected, so the write/trim/order rules are
 * testable without waiting for a real run.
 *
 * This module never touches the filesystem: `cron-store.ts` is the I/O layer
 * (same `pi-web-cron.json` file) and `cron-runner.ts` is the caller. Keeping the
 * pure layer free of `node:fs` is what lets the UI and the tests share it.
 */

import {
  CRON_HISTORY_LIMIT,
  type CronRunRecord,
  type CronRunStatus,
  type CronRunTrigger,
  type CronSkipReason,
} from "./cron-schedule";

/** How many runs are kept per task. Older entries fall off the end. */
export const CRON_HISTORY_KEEP = CRON_HISTORY_LIMIT;

/** Default length of the output excerpt shown in the history row. */
export const CRON_OUTPUT_EXCERPT_CHARS = 800;

/** Injected clock: every timestamp in this module is derived from it. */
export type CronClock = () => Date;

export interface CronRunStart {
  /** Stable id; `cron-runner.ts` supplies a UUID, tests can pass a literal. */
  id?: string;
  trigger?: CronRunTrigger;
  /** 1-based attempt number (retries increment it). */
  attempt?: number;
  /** Explicit start instant; defaults to `clock()`. */
  at?: Date;
}

/** A run that has been claimed and is now in flight. */
export function startRunRecord(input: CronRunStart, clock: CronClock): CronRunRecord {
  const at = input.at ?? clock();
  return {
    ...(input.id ? { id: input.id } : {}),
    at: at.toISOString(),
    status: "running",
    ...(input.trigger ? { trigger: input.trigger } : {}),
    ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
  };
}

export interface CronRunFinish {
  status: "ok" | "error";
  error?: string;
  outputExcerpt?: string;
  exitCode?: number | null;
  sessionId?: string;
  finishedAt?: Date;
}

/** Finish an in-flight record. `at` and `id` are preserved. */
export function finishRunRecord(record: CronRunRecord, input: CronRunFinish, clock: CronClock): CronRunRecord {
  const finishedAt = input.finishedAt ?? clock();
  return {
    ...record,
    status: input.status,
    finishedAt: finishedAt.toISOString(),
    ...(input.error ? { error: input.error } : {}),
    ...(input.outputExcerpt ? { outputExcerpt: input.outputExcerpt } : {}),
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}

export interface CronRunSkip {
  id?: string;
  at?: Date;
  trigger?: CronRunTrigger;
  sessionId?: string;
}

/** A run that was never started (missed window, expired claim, past end date). */
export function skipRunRecord(input: CronRunSkip, reason: CronSkipReason, clock: CronClock): CronRunRecord {
  const now = clock();
  const at = input.at ?? now;
  return {
    ...(input.id ? { id: input.id } : {}),
    at: at.toISOString(),
    finishedAt: now.toISOString(),
    status: "skipped",
    skipReason: reason,
    ...(input.trigger ? { trigger: input.trigger } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}

/**
 * Prepend a record, de-duplicate by id (finishing a run replaces its start
 * entry), and trim to `keep`. Newest first.
 */
export function appendRunRecord(
  history: readonly CronRunRecord[],
  record: CronRunRecord,
  keep = CRON_HISTORY_KEEP,
): CronRunRecord[] {
  const withoutExisting = record.id
    ? history.filter((entry) => entry.id !== record.id)
    : [...history];
  return [record, ...withoutExisting].slice(0, Math.max(0, keep));
}

/** Replace a record in place (same id) without moving it. */
export function updateRunRecord(
  history: readonly CronRunRecord[],
  record: CronRunRecord,
  keep = CRON_HISTORY_KEEP,
): CronRunRecord[] {
  if (!record.id) return appendRunRecord(history, record, keep);
  let found = false;
  const next = history.map((entry) => {
    if (entry.id !== record.id) return entry;
    found = true;
    return record;
  });
  return found ? next.slice(0, Math.max(0, keep)) : appendRunRecord(history, record, keep);
}

export function deleteRunRecord(history: readonly CronRunRecord[], runId: string): CronRunRecord[] {
  return history.filter((entry) => entry.id !== runId);
}

export interface CronHistoryFilter {
  status?: CronRunStatus | readonly CronRunStatus[];
  trigger?: CronRunTrigger;
  sessionId?: string;
}

/** Filter a task's runs (newest-first order is preserved). */
export function filterRunHistory(
  history: readonly CronRunRecord[],
  filter: CronHistoryFilter = {},
): CronRunRecord[] {
  const statuses = filter.status === undefined
    ? undefined
    : Array.isArray(filter.status)
      ? filter.status
      : [filter.status];
  return history.filter((entry) => {
    if (statuses && !statuses.includes(entry.status)) return false;
    if (filter.trigger && entry.trigger !== filter.trigger) return false;
    if (filter.sessionId && entry.sessionId !== filter.sessionId) return false;
    return true;
  });
}

/** Pick one task's history out of a whole store (used by API/UI queries). */
export function historyForTask(
  tasks: ReadonlyArray<{ id: string; history?: readonly CronRunRecord[] }>,
  taskId: string,
): CronRunRecord[] {
  return tasks.find((task) => task.id === taskId)?.history?.slice() ?? [];
}

const RUN_STATUSES: readonly CronRunStatus[] = ["running", "ok", "error", "skipped"];
const RUN_TRIGGERS: readonly CronRunTrigger[] = ["schedule", "manual", "retry"];
const SKIP_REASONS: readonly CronSkipReason[] = [
  "computer_asleep_or_app_not_running",
  "claim_expired",
  "end_date_passed",
];

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Tolerant parser for a stored history array. A corrupt entry is dropped, never
 * thrown: one bad row must not make every scheduled task unreadable.
 */
export function parseRunHistory(raw: unknown, keep = CRON_HISTORY_KEEP): CronRunRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: CronRunRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    // Version-1 files only had `at`; accept `startedAt` too for forward compat.
    const at = asString(entry.at) ?? asString(entry.startedAt);
    if (!at) continue;
    const status = RUN_STATUSES.includes(entry.status as CronRunStatus)
      ? (entry.status as CronRunStatus)
      // Old files only stored ok/error; anything else is treated as a failure.
      : "error";
    const record: CronRunRecord = {
      at,
      status,
      ...(asString(entry.id) ? { id: entry.id as string } : {}),
      ...(asString(entry.finishedAt) ? { finishedAt: entry.finishedAt as string } : {}),
      ...(RUN_TRIGGERS.includes(entry.trigger as CronRunTrigger) ? { trigger: entry.trigger as CronRunTrigger } : {}),
      ...(asString(entry.sessionId) ? { sessionId: entry.sessionId as string } : {}),
      ...(asString(entry.error) ? { error: entry.error as string } : {}),
      ...(SKIP_REASONS.includes(entry.skipReason as CronSkipReason) ? { skipReason: entry.skipReason as CronSkipReason } : {}),
      ...(asString(entry.outputExcerpt) ? { outputExcerpt: entry.outputExcerpt as string } : {}),
      ...(typeof entry.exitCode === "number" || entry.exitCode === null ? { exitCode: entry.exitCode as number | null } : {}),
      ...(typeof entry.attempt === "number" && entry.attempt > 0 ? { attempt: Math.floor(entry.attempt) } : {}),
    };
    records.push(record);
  }
  // Newest first, even if the file was written out of order.
  records.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return records.slice(0, Math.max(0, keep));
}

/** Human-readable duration between start and finish; undefined while running. */
export function runDurationMs(record: CronRunRecord): number | undefined {
  if (!record.finishedAt) return undefined;
  const start = Date.parse(record.at);
  const end = Date.parse(record.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.max(0, end - start);
}

/** First lines of a run's output, bounded so the JSON file stays small. */
export function summarizeRunOutput(text: string | undefined | null, maxChars = CRON_OUTPUT_EXCERPT_CHARS): string | undefined {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1)}…` : trimmed;
}
