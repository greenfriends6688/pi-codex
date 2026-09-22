/**
 * fork:cron — schedule math for the built-in scheduler (pure).
 *
 * Three fixed shapes (daily / weekly / once) plus a real 5-field cron expression
 * (lib/cron-expression.ts — hand-written, no dependency). Times are wall-clock in the
 * task's timezone ("host" by default, see lib/cron-timezone.ts), and an optional idle
 * window confines runs to a part of the day, deferring a hit to the window start
 * instead of dropping it.
 *
 * Everything here is pure so the due/next-run behaviour is unit-testable without
 * waiting for a clock.
 */

import { cronMatchesDay, cronMatchesMinute, parseCronExpression, type CronExpression } from "./cron-expression";
import { addZonedDays, resolveTimezone, zonedParts, zonedTimeToInstant } from "./cron-timezone";

export const CRON_SCHEDULE_KINDS = ["daily", "weekly", "once", "cron"] as const;
export type CronScheduleKind = (typeof CRON_SCHEDULE_KINDS)[number];

/** "HH:MM"–"HH:MM" window the task is allowed to run in (cross-midnight allowed). */
export interface CronIdleWindow {
  start: string;
  end: string;
}

export interface CronSchedule {
  kind: CronScheduleKind;
  /** "HH:MM" local times, any order, duplicates allowed. Unused by `cron`. */
  times: string[];
  /** 0 = Sunday … 6 = Saturday (weekly only). */
  weekdays?: number[];
  /** "YYYY-MM-DD" (once only). */
  date?: string;
  /** 5-field expression (a 5-field expression, for example every 5 minutes) — `cron` kind only. */
  expression?: string;
  /** "host" (default) or an IANA zone name. */
  timezone?: string;
  /** Runs are confined to this window; a hit outside it is deferred to the window start. */
  idleWindow?: CronIdleWindow;
  /** fork:zc-19 — last calendar day a recurring task may fire ("YYYY-MM-DD", inclusive). */
  endDate?: string;
}

export const CRON_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const CRON_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse "HH:MM" into minutes since midnight; null when malformed. */
export function parseCronTime(value: string): number | null {
  const match = CRON_TIME_RE.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Sorted, de-duplicated minute offsets. Invalid entries are dropped, never guessed at. */
export function normalizeCronTimes(times: readonly string[] | undefined): number[] {
  const minutes = (times ?? [])
    .map((time) => parseCronTime(time))
    .filter((value): value is number => value !== null);
  return [...new Set(minutes)].sort((a, b) => a - b);
}

/** A window is only meaningful when both ends are valid times and it is not 24h. */
export function normalizeIdleWindow(window: unknown): CronIdleWindow | undefined {
  if (!window || typeof window !== "object") return undefined;
  const raw = window as Partial<CronIdleWindow>;
  const start = typeof raw.start === "string" ? parseCronTime(raw.start) : null;
  const end = typeof raw.end === "string" ? parseCronTime(raw.end) : null;
  if (start === null || end === null || start === end) return undefined;
  return { start: raw.start!.trim(), end: raw.end!.trim() };
}

/** Is this minute inside the window? Windows may cross midnight (22:00–06:00). */
export function isInsideIdleWindow(minutes: number, window: CronIdleWindow | undefined): boolean {
  if (!window) return true;
  const start = parseCronTime(window.start);
  const end = parseCronTime(window.end);
  if (start === null || end === null || start === end) return true;
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

export function normalizeWeekdays(weekdays: readonly number[] | undefined): number[] {
  const days = (weekdays ?? [])
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Parse "YYYY-MM-DD" into a local Date at midnight; null when malformed. */
export function parseCronDate(value: string | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!CRON_DATE_RE.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Reject rollovers like 2026-02-31.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function at(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
}

/** Wall-clock fields → instant, honouring the task's timezone. */
function instantFor(parts: { year: number; month: number; day: number; hour: number; minute: number }, timeZone?: string): Date {
  return zonedTimeToInstant(parts, timeZone);
}

/**
 * Next occurrence strictly after `from`, or null when the schedule can never fire
 * again (a `once` date in the past, no valid times, a weekly schedule with no days,
 * an impossible cron expression).
 *
 * The scan is day-first: a cron expression can be "the 29th of February", so minute
 * scanning alone would have to walk years one minute at a time. Days are cheap
 * (≤ 366 tests), and only matching days expand into a 1440-minute scan.
 */
export function computeNextRun(schedule: CronSchedule, from: Date): Date | null {
  const next = computeNextRunUnbounded(schedule, from);
  if (!next || !schedule.endDate) return next;
  // fork:zc-19 — end date is inclusive: 23:59 of that wall-clock day is the last
  // allowed minute. A schedule whose next hit falls after it has no future run.
  const endExclusive = endOfCronDate(schedule.endDate, resolveTimezone(schedule.timezone));
  if (endExclusive && next.getTime() > endExclusive.getTime()) return null;
  return next;
}

/** Inclusive end-of-day instant for `endDate` in `timeZone`. */
function endOfCronDate(endDate: string, timeZone: string | undefined): Date | null {
  const date = parseCronDate(endDate);
  if (!date) return null;
  return zonedTimeToInstant(
    { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: 23, minute: 59 },
    timeZone,
  );
}

function computeNextRunUnbounded(schedule: CronSchedule, from: Date): Date | null {
  const zone = resolveTimezone(schedule.timezone);
  const window = normalizeIdleWindow(schedule.idleWindow);

  if (schedule.kind === "cron") {
    const parsed = typeof schedule.expression === "string" ? parseCronExpression(schedule.expression) : "missing expression";
    if (typeof parsed === "string") return null;
    return nextCronRun(parsed, from, zone, window);
  }

  const times = normalizeCronTimes(schedule.times);
  if (times.length === 0) return null;

  if (schedule.kind === "once") {
    const day = parseCronDate(schedule.date);
    if (!day) return null;
    for (const minutes of times) {
      const candidate = at(day, minutes);
      if (candidate.getTime() > from.getTime()) return applyIdleWindow(candidate, zone, window);
    }
    return null;
  }

  if (schedule.kind === "weekly") {
    const weekdays = normalizeWeekdays(schedule.weekdays);
    if (weekdays.length === 0) return null;
    for (let offset = 0; offset <= 7; offset += 1) {
      const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
      if (!weekdays.includes(day.getDay())) continue;
      for (const minutes of times) {
        const candidate = at(day, minutes);
        if (candidate.getTime() > from.getTime()) return applyIdleWindow(candidate, zone, window);
      }
    }
    return null;
  }

  // daily
  for (let offset = 0; offset <= 1; offset += 1) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    for (const minutes of times) {
      const candidate = at(day, minutes);
      if (candidate.getTime() > from.getTime()) return applyIdleWindow(candidate, zone, window);
    }
  }
  return null;
}

/** Bounded so an impossible expression ("0 0 31 2 *") cannot spin forever. */
const MAX_SCAN_DAYS = 366 * 2;

function nextCronRun(
  expression: CronExpression,
  from: Date,
  zone: string | undefined,
  window: CronIdleWindow | undefined,
): Date | null {
  // Work in 1-minute resolution: cron has no seconds.
  const cursor = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  const startParts = zonedParts(cursor, zone);

  for (let dayOffset = 0; dayOffset < MAX_SCAN_DAYS; dayOffset += 1) {
    const day = addZonedDays({ ...startParts, hour: 0, minute: 0 }, dayOffset);
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (!cronMatchesDay(expression, day.year, day.month, day.day, weekday)) continue;

    const firstMinute = dayOffset === 0 ? startParts.hour * 60 + startParts.minute : 0;
    for (let minutes = firstMinute; minutes < 1440; minutes += 1) {
      if (!cronMatchesMinute(expression, Math.floor(minutes / 60), minutes % 60)) continue;
      const candidate = instantFor({ ...day, hour: Math.floor(minutes / 60), minute: minutes % 60 }, zone);
      if (candidate.getTime() <= from.getTime()) continue;
      return applyIdleWindow(candidate, zone, window);
    }
  }
  return null;
}

/**
 * Deferral semantics (MusePi's "窗口外触发将顺延到窗口开始"): a hit outside the
 * window is not dropped, it moves to the start of the next window. Returns the input
 * unchanged when there is no window or it already falls inside.
 */
function applyIdleWindow(candidate: Date, zone: string | undefined, window: CronIdleWindow | undefined): Date {
  if (!window) return candidate;
  const parts = zonedParts(candidate, zone);
  const minutes = parts.hour * 60 + parts.minute;
  if (isInsideIdleWindow(minutes, window)) return candidate;
  const start = parseCronTime(window.start);
  if (start === null) return candidate;
  // Same day when the window still opens today, otherwise tomorrow.
  const target = start > minutes
    ? instantFor({ ...parts, hour: Math.floor(start / 60), minute: start % 60 }, zone)
    : instantFor(addZonedDays({ ...parts, hour: Math.floor(start / 60), minute: start % 60 } as never, 1) as never, zone);
  return target;
}

/** Human-readable summary used by the UI and the run log. */
export function describeCronSchedule(schedule: CronSchedule, weekdayNames: readonly string[]): string {
  if (schedule.kind === "cron") return schedule.expression ?? "—";
  const times = normalizeCronTimes(schedule.times).map((minutes) => (
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
  ));
  if (times.length === 0) return "—";
  const timeText = times.join(", ");
  if (schedule.kind === "once") return `${schedule.date ?? "?"} ${timeText}`;
  if (schedule.kind === "weekly") {
    const days = normalizeWeekdays(schedule.weekdays).map((day) => weekdayNames[day] ?? String(day));
    return `${days.join("/")} ${timeText}`;
  }
  return `daily ${timeText}`;
}

/**
 * Late window for a scheduled run.
 *
 * A tick that arrives more than this far past its occurrence is treated as a
 * missed run and skipped: the server may have been down, asleep, or busy, and
 * silently replaying yesterday's prompt hours later is worse than not running it.
 * Two ticks of headroom covers a slow tick and a paused laptop waking up.
 */
export const CRON_MISSED_WINDOW_MS = 5 * 60 * 1000;

export interface CronDueState {
  /** Next occurrence after the last run (never in the past). */
  nextRunAt: Date | null;
  /** A missed occurrence that is still inside the tolerance window. */
  due: boolean;
  /** A missed occurrence that is too old to run. */
  missed: boolean;
}

/**
 * @param anchor when the task last ran (or when it was created)
 */
export function cronDueState(schedule: CronSchedule, anchor: Date, now: Date, windowMs = CRON_MISSED_WINDOW_MS): CronDueState {
  // Anchor is exclusive, so a run at 09:00 does not immediately re-schedule 09:00.
  const next = computeNextRun(schedule, anchor);
  if (!next) return { nextRunAt: null, due: false, missed: false };
  const late = now.getTime() - next.getTime();
  if (late < 0) return { nextRunAt: next, due: false, missed: false };
  if (late > windowMs) {
    // Too late to run this one; the next display value is the following occurrence.
    return { nextRunAt: computeNextRun(schedule, now), due: false, missed: true };
  }
  return { nextRunAt: next, due: true, missed: false };
}

// ---------------------------------------------------------------------------
// Shared task shapes (client-safe: the settings page imports them, the store
// implements them). Keeping them here rather than in cron-store.ts is what makes
// the UI able to talk about a task without pulling `node:fs` into the browser.
// ---------------------------------------------------------------------------

export type CronRunStatus = "running" | "ok" | "error" | "skipped";

/** fork:zc-14 — what started a run. */
export type CronRunTrigger = "schedule" | "manual" | "retry";

/** fork:zc-19 — why a run never happened. */
export type CronSkipReason =
  | "computer_asleep_or_app_not_running"
  | "claim_expired"
  | "end_date_passed";

export interface CronTask {
  id: string;
  name: string;
  /**
   * Working directory the session runs in. Empty means "the default working
   * directory" (the chat workspace), so a task can be created without picking a
   * folder first — the reference UI labels that option "留空用默认工作目录".
   */
  cwd: string;
  /** Prompt sent as the first message of the run. */
  prompt: string;
  schedule: CronSchedule;
  enabled: boolean;
  createdAt: string;
  /** Last time the scheduler started this task. */
  lastRunAt?: string;
  lastStatus?: CronRunStatus;
  lastError?: string;
  /** Session created by the most recent run. */
  lastSessionId?: string;
  /** Model override; unset means the app default. */
  model?: { provider: string; modelId: string };
  /** Thinking level override; unset means the app default. */
  thinking?: string;
  runCount: number;
  /** Most recent runs, newest first (bounded — see CRON_HISTORY_LIMIT). */
  history?: CronRunRecord[];
  // ---------------------------------------------------------------------
  // fork:fix-cron-lifecycle — 运行生命周期字段（全部可选，旧任务文件无需迁移）
  // ---------------------------------------------------------------------
  /** 达到该运行次数后自动停用并标记完成；未设置表示不限次。 */
  maxRuns?: number;
  /** 子会话策略：new（每次新建，默认）/ daily（同日复用）/ reuse（始终复用）。 */
  sessionMode?: "new" | "daily" | "reuse";
  /** 连续失败计数；成功一次即清零。 */
  consecutiveFailures?: number;
  /** 自动暂停的原因（用户可在 UI 上看到并手动恢复）。 */
  pausedReason?: string;
  /** 因达到 maxRuns 而完成的时间。 */
  completedAt?: string;
  /** 单次运行超时（毫秒）；未设置时用 DEFAULT_RUN_TIMEOUT_MS。 */
  timeoutMs?: number;
  /** 最近一次运行留下的会话 id，供复用判定。 */
  reusableSessionId?: string;
  /** 该复用会话最后一次运行的自然日键（`YYYY-MM-DD`）。 */
  reusableSessionDayKey?: string;
  /** 完成通知策略；未设置按 "error"（只在失败时通知）。 */
  notify?: "never" | "always" | "success" | "error";
  // ---------------------------------------------------------------------
  // fork:zc-19 — 单飞/心跳/退避重试字段（全部可选，旧任务文件无需迁移）
  // ---------------------------------------------------------------------
  /** 运行中任务的心跳时间；超过 10 分钟没有心跳视为认领已过期。 */
  heartbeatAt?: string;
  /** 可重试失败的下一跳时间；设置期间不再按正常计划触发。 */
  retryAt?: string;
  /** 已经进行的重试次数（不含首次运行）。 */
  retryAttempt?: number;
}

/** One entry of the run log, so the page can show "what happened" without the session. */
export interface CronRunRecord {
  /** fork:zc-14 — stable id so a running entry can be finished and a row deleted. */
  id?: string;
  /** Run start (ISO). Legacy field name kept so version-1 files stay readable. */
  at: string;
  /** Run end (ISO); absent while a run is still in flight. */
  finishedAt?: string;
  status: CronRunStatus;
  /** What started the run (scheduled tick, "Run now", or a backoff retry). */
  trigger?: CronRunTrigger;
  sessionId?: string;
  error?: string;
  /** fork:zc-19 — reason a run was skipped instead of executed. */
  skipReason?: CronSkipReason;
  /** fork:zc-14 — process exit code when one exists. */
  exitCode?: number | null;
  /** fork:zc-14 — first lines of the final assistant output. */
  outputExcerpt?: string;
  /** fork:zc-19 — 1 for the first try, higher for backoff retries. */
  attempt?: number;
}

/** Keeps the file small while still giving the history browser something to page through. */
export const CRON_HISTORY_LIMIT = 50;

export interface CronTaskView extends CronTask {
  /** Next occurrence, for display; null when the schedule is exhausted. */
  nextRunAt: string | null;
  /** True when an occurrence was skipped because the server was not running. */
  missed: boolean;
}
