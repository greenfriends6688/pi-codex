import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import {
  CRON_SCHEDULE_KINDS,
  cronDueState,
  parseCronDate,
  normalizeCronTimes,
  normalizeIdleWindow,
  normalizeWeekdays,
  CRON_HISTORY_LIMIT,
  type CronSchedule,
  type CronScheduleKind,
  type CronTask,
  type CronTaskView,
  type CronRunRecord,
} from "./cron-schedule";
import { parseCronExpression } from "./cron-expression";
import { isKnownTimezone } from "./cron-timezone";

/**
 * fork:cron — scheduled tasks, stored next to pi's own config.
 *
 * File: `<agentDir>/pi-web-cron.json` (`{ version, tasks }`). Same choice as the
 * chat workspace config: pi's agent directory survives a pi-web reinstall, and it
 * is the one place the runtime is guaranteed to be able to write.
 *
 * A task owns only the *when* and the *what*; the session it creates is an ordinary
 * session (`startRpcSession` + `prompt`), so a scheduled run shows up in the sidebar
 * like any other conversation and can be opened, branched and archived.
 */

export const CRON_CONFIG_VERSION = 1;
export const CRON_CONFIG_FILE = "pi-web-cron.json";

export type { CronTask, CronTaskView, CronRunStatus, CronRunRecord } from "./cron-schedule";

export interface CronFile {
  version: number;
  tasks: CronTask[];
}

const CONFIG_CACHE_TTL_MS = 5_000;

declare global {
  // Survives Next.js hot-reload; a module-level cache does not.
  var __piCronCache: { file: string; value: CronFile; expiresAt: number } | undefined;
}

export function getCronConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, CRON_CONFIG_FILE);
}

function emptyFile(): CronFile {
  return { version: CRON_CONFIG_VERSION, tasks: [] };
}

export function readCronFile(file = getCronConfigPath()): CronFile {
  const cached = globalThis.__piCronCache;
  if (cached && cached.file === file && cached.expiresAt > Date.now()) return cached.value;

  let value = emptyFile();
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<CronFile>;
      const tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks.map((task) => normalizeTask(task as Partial<CronTask>)).filter((task): task is CronTask => task !== null)
        : [];
      value = { version: CRON_CONFIG_VERSION, tasks };
    }
  } catch {
    // A corrupt file must not take the scheduler down; the next write repairs it.
    value = emptyFile();
  }
  globalThis.__piCronCache = { file, value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  return value;
}

export function writeCronFile(next: CronFile, file = getCronConfigPath()): void {
  const directory = dirname(file);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  writePrivateFileAtomicSync(file, `${JSON.stringify({ version: CRON_CONFIG_VERSION, tasks: next.tasks }, null, 2)}\n`);
  globalThis.__piCronCache = { file, value: { version: CRON_CONFIG_VERSION, tasks: next.tasks }, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
}

export function invalidateCronCache(): void {
  globalThis.__piCronCache = undefined;
}

/** Accept only what the scheduler can actually run; drop everything else. */
export function normalizeTask(input: Partial<CronTask>): CronTask | null {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  // An empty cwd is allowed on purpose: the runner falls back to the default
  // working directory, which is what the "leave blank" option promises.
  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
  if (!prompt) return null;

  const schedule = normalizeSchedule(input.schedule);
  if (!schedule) return null;

  const model = input.model && typeof input.model === "object"
    && typeof (input.model as { provider?: unknown }).provider === "string"
    && typeof (input.model as { modelId?: unknown }).modelId === "string"
    ? { provider: (input.model as { provider: string }).provider, modelId: (input.model as { modelId: string }).modelId }
    : undefined;

  return {
    id: typeof input.id === "string" && input.id ? input.id : randomUUID(),
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 120) : prompt.slice(0, 60),
    cwd,
    prompt,
    schedule,
    enabled: input.enabled !== false,
    createdAt: typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString(),
    ...(typeof input.lastRunAt === "string" ? { lastRunAt: input.lastRunAt } : {}),
    ...(input.lastStatus === "running" || input.lastStatus === "ok" || input.lastStatus === "error" ? { lastStatus: input.lastStatus } : {}),
    ...(typeof input.lastError === "string" ? { lastError: input.lastError } : {}),
    ...(typeof input.lastSessionId === "string" ? { lastSessionId: input.lastSessionId } : {}),
    ...(model ? { model } : {}),
    ...(typeof input.thinking === "string" && input.thinking ? { thinking: input.thinking } : {}),
    runCount: Number.isFinite(input.runCount) && (input.runCount ?? 0) >= 0 ? Math.floor(input.runCount as number) : 0,
    ...(Array.isArray(input.history) ? { history: normalizeHistory(input.history) } : {}),
    // fork:fix-cron-lifecycle — 生命周期字段（全部可选）。
    // 取值都做范围校验：坏数据宁可退回默认，也不要让调度器拿着 NaN 去比较。
    ...(Number.isFinite(input.maxRuns) && (input.maxRuns ?? 0) > 0 ? { maxRuns: Math.floor(input.maxRuns as number) } : {}),
    ...(input.sessionMode === "new" || input.sessionMode === "daily" || input.sessionMode === "reuse" ? { sessionMode: input.sessionMode } : {}),
    ...(Number.isFinite(input.consecutiveFailures) && (input.consecutiveFailures ?? 0) >= 0 ? { consecutiveFailures: Math.floor(input.consecutiveFailures as number) } : {}),
    ...(typeof input.pausedReason === "string" && input.pausedReason ? { pausedReason: input.pausedReason } : {}),
    ...(typeof input.completedAt === "string" ? { completedAt: input.completedAt } : {}),
    ...(Number.isFinite(input.timeoutMs) && (input.timeoutMs ?? 0) > 0 ? { timeoutMs: Math.floor(input.timeoutMs as number) } : {}),
    ...(typeof input.reusableSessionId === "string" && input.reusableSessionId ? { reusableSessionId: input.reusableSessionId } : {}),
    ...(typeof input.reusableSessionDayKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.reusableSessionDayKey) ? { reusableSessionDayKey: input.reusableSessionDayKey } : {}),
    ...(input.notify === "never" || input.notify === "always" || input.notify === "success" || input.notify === "error" ? { notify: input.notify } : {}),
  };
}

function normalizeHistory(input: unknown[]): CronRunRecord[] {
  return input
    .map((raw) => {
      const entry = (raw ?? {}) as Partial<CronRunRecord>;
      if (typeof entry.at !== "string") return null;
      const status = entry.status === "ok" ? "ok" : "error";
      return {
        at: entry.at,
        status: status as CronRunRecord["status"],
        ...(typeof entry.sessionId === "string" ? { sessionId: entry.sessionId } : {}),
        ...(typeof entry.error === "string" ? { error: entry.error } : {}),
      };
    })
    .filter((entry): entry is CronRunRecord => entry !== null)
    .slice(0, CRON_HISTORY_LIMIT);
}

/** Prepend a run and keep the log bounded. */
export function appendCronHistory(id: string, record: CronRunRecord, file = getCronConfigPath()): void {
  const task = findCronTask(id, file);
  if (!task) return;
  const history = [record, ...(task.history ?? [])].slice(0, CRON_HISTORY_LIMIT);
  patchCronTask(id, { history }, file);
}

export function normalizeSchedule(input: unknown): CronSchedule | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<CronSchedule>;
  const kind = raw.kind as CronScheduleKind;
  if (!CRON_SCHEDULE_KINDS.includes(kind)) return null;
  const times = normalizeCronTimes(raw.times);
  if (times.length === 0 && kind !== "cron") return null;

  const timeText = times.map((minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  // Shared fields on every kind: the zone and the window are properties of *when* to
  // run, not of how the times are written.
  const timezone = typeof raw.timezone === "string" && raw.timezone && raw.timezone !== "host" && isKnownTimezone(raw.timezone)
    ? raw.timezone
    : undefined;
  const idleWindow = normalizeIdleWindow(raw.idleWindow);
  const shared = { ...(timezone ? { timezone } : {}), ...(idleWindow ? { idleWindow } : {}) };

  if (kind === "cron") {
    const expression = typeof raw.expression === "string" ? raw.expression.trim().replace(/\s+/g, " ") : "";
    if (typeof parseCronExpression(expression) === "string") return null;
    return { kind, times: [], expression, ...shared };
  }

  if (kind === "once") {
    const date = parseCronDate(raw.date);
    if (!date) return null;
    return { kind, times: timeText, date: raw.date, ...shared };
  }
  if (kind === "weekly") {
    const weekdays = normalizeWeekdays(raw.weekdays);
    if (weekdays.length === 0) return null;
    return { kind, times: timeText, weekdays, ...shared };
  }
  return { kind, times: timeText, ...shared };
}

export function toCronTaskView(task: CronTask, now = new Date()): CronTaskView {
  const anchor = task.lastRunAt ? new Date(task.lastRunAt) : new Date(task.createdAt);
  const state = cronDueState(task.schedule, Number.isNaN(anchor.getTime()) ? now : anchor, now);
  return {
    ...task,
    nextRunAt: state.nextRunAt ? state.nextRunAt.toISOString() : null,
    missed: state.missed,
  };
}

export function listCronTasks(now = new Date(), file = getCronConfigPath()): CronTaskView[] {
  return readCronFile(file).tasks
    .map((task) => toCronTaskView(task, now))
    .sort((a, b) => (a.nextRunAt ?? "9999").localeCompare(b.nextRunAt ?? "9999"));
}

export function findCronTask(id: string, file = getCronConfigPath()): CronTask | null {
  return readCronFile(file).tasks.find((task) => task.id === id) ?? null;
}

export function upsertCronTask(task: CronTask, file = getCronConfigPath()): CronTask {
  const current = readCronFile(file);
  const index = current.tasks.findIndex((existing) => existing.id === task.id);
  const tasks = index === -1
    ? [...current.tasks, task]
    : current.tasks.map((existing) => (existing.id === task.id ? task : existing));
  writeCronFile({ version: CRON_CONFIG_VERSION, tasks }, file);
  return task;
}

export function deleteCronTask(id: string, file = getCronConfigPath()): boolean {
  const current = readCronFile(file);
  const tasks = current.tasks.filter((task) => task.id !== id);
  if (tasks.length === current.tasks.length) return false;
  writeCronFile({ version: CRON_CONFIG_VERSION, tasks }, file);
  return true;
}

/** Record the outcome of a run (the scheduler's only write path). */
export function patchCronTask(id: string, patch: Partial<CronTask>, file = getCronConfigPath()): CronTask | null {
  const current = readCronFile(file);
  const existing = current.tasks.find((task) => task.id === id);
  if (!existing) return null;
  const next: CronTask = { ...existing, ...patch, id: existing.id };
  const tasks = current.tasks.map((task) => (task.id === id ? next : task));
  // Read-through of a cached file, so keep the cache in step with what we wrote.
  writeCronFile({ version: CRON_CONFIG_VERSION, tasks }, file);
  return next;
}
