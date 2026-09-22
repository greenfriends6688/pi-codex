/**
 * fork:zc-03 — local usage statistics: cross-session aggregation + fingerprint cache.
 *
 * The single-session numbers already exist in `lib/session-stats.ts`
 * (`computeSessionStats` sums input/output/cacheRead/cacheWrite and
 * `usage.cost.total`). What the settings panel needs is those numbers grouped
 * by day and by model across every session on disk, which means parsing every
 * `.jsonl` in `~/.pi/agent/sessions/**`.
 *
 * Parsing everything on every request does not scale, so each file is keyed by
 * `(size, mtimeMs)` from `fs.stat`: unchanged files reuse the parsed record from
 * `~/.pi/agent/pi-web-usage-cache.json`, changed files are re-parsed. Session
 * files are only ever read, never written.
 *
 * Everything with a side effect goes through `UsageStatsIo`, so the tests can
 * drive an in-memory filesystem and assert "cache hit skips the parser",
 * "mtime change re-parses", and timezone bucketing without touching `~/.pi/`.
 *
 * The module is deliberately dependency-free (node builtins + type-only
 * imports): it is loaded directly by `node --experimental-strip-types --test`.
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const USAGE_CACHE_VERSION = 1;
export const USAGE_CACHE_FILE_NAME = "pi-web-usage-cache.json";

export const USAGE_RANGES = ["7d", "30d", "all"] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export function isUsageRange(value: unknown): value is UsageRange {
  return typeof value === "string" && (USAGE_RANGES as readonly string[]).includes(value);
}

export interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageBucket {
  messages: number;
  tokens: UsageTokens;
  cost: number;
}

export interface UsageDayBucket extends UsageBucket {
  /** 1 when the session had at least one entry that day; summed across files. */
  sessions: number;
  models: Record<string, UsageBucket>;
}

export interface SessionUsageRecord {
  path: string;
  id: string;
  cwd: string;
  /** ISO timestamp of the session header ("" when malformed). */
  created: string;
  /** ISO timestamp of the newest entry seen ("" when none). */
  modified: string;
  days: Record<string, UsageDayBucket>;
}

export interface UsageFingerprint {
  size: number;
  mtimeMs: number;
}

export interface UsageCacheEntry extends UsageFingerprint {
  record: SessionUsageRecord;
}

export interface UsageCacheState {
  version: number;
  timeZone: string;
  entries: Record<string, UsageCacheEntry>;
}

export interface UsageStatsIo {
  listSessionFiles(): Promise<string[]>;
  statFile(path: string): Promise<UsageFingerprint | null>;
  readFileText(path: string): Promise<string>;
  readCache(): Promise<string | null>;
  writeCache(content: string): Promise<void>;
}

export interface UsageDayPoint {
  day: string;
  sessions: number;
  messages: number;
  tokens: number;
  cost: number;
}

export interface UsageModelPoint {
  model: string;
  messages: number;
  tokens: number;
  cost: number;
  /** Fraction of the range's total tokens (0 when the range has none). */
  share: number;
}

export interface UsageTotals {
  sessions: number;
  messages: number;
  tokens: number;
  cost: number;
  tokensByKind: UsageTokens;
}

export interface UsageStatsSummary {
  range: UsageRange;
  timeZone: string;
  generatedAt: string;
  totals: UsageTotals;
  days: UsageDayPoint[];
  models: UsageModelPoint[];
  scanned: {
    files: number;
    parsed: number;
    cached: number;
    failed: number;
    durationMs: number;
  };
}

// ============================================================================
// Numbers / day keys
// ============================================================================

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function integer(value: unknown): number {
  const n = finite(value);
  return Math.floor(n);
}

function emptyTokens(): UsageTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function emptyBucket(): UsageBucket {
  return { messages: 0, tokens: emptyTokens(), cost: 0 };
}

function updateTokenTotal(tokens: UsageTokens): UsageTokens {
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return tokens;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Calendar-day key (`YYYY-MM-DD`) for a timestamp in a named IANA zone. When
 * `timeZone` is omitted the runtime's local zone is used; tests pass an
 * explicit zone so the UTC/UTC+8 boundary stays deterministic.
 */
export function dayKeyForTimestamp(ms: number, timeZone?: string): string {
  const date = new Date(ms);
  if (isValidTimeZone(timeZone)) {
    const parts = formatterFor(timeZone).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    return `${year}-${month}-${day}`;
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dayKeyToUtcMs(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, date ?? 1);
}

function addDays(day: string, delta: number): string {
  const date = new Date(dayKeyToUtcMs(day));
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

// ============================================================================
// Session file parsing
// ============================================================================

interface RawRecord {
  [key: string]: unknown;
}

function asRecord(value: unknown): RawRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function timestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function addUsageToBucket(bucket: UsageBucket, usage: unknown): void {
  const record = asRecord(usage);
  if (!record) return;
  bucket.tokens.input += finite(record.input);
  bucket.tokens.output += finite(record.output);
  bucket.tokens.cacheRead += finite(record.cacheRead);
  bucket.tokens.cacheWrite += finite(record.cacheWrite);
  const cost = asRecord(record.cost);
  bucket.cost += cost ? finite(cost.total) : 0;
}

function ensureDay(record: SessionUsageRecord, day: string): UsageDayBucket {
  let bucket = record.days[day];
  if (!bucket) {
    bucket = { ...emptyBucket(), sessions: 1, models: {} };
    record.days[day] = bucket;
  }
  return bucket;
}

function addModelUsage(bucket: UsageDayBucket, model: string, usage: unknown, messages = 0): void {
  let models = bucket.models[model];
  if (!models) {
    models = emptyBucket();
    bucket.models[model] = models;
  }
  models.messages += messages;
  addUsageToBucket(models, usage);
}

export interface ParseSessionUsageOptions {
  path: string;
  id?: string;
  timeZone?: string;
  /** Clock used for entries that carry no timestamp at all. */
  nowMs?: number;
}

/**
 * One `.jsonl` → one record. Corrupt lines and malformed usage objects are
 * skipped (a torn trailing write is normal while pi appends), and the token /
 * cost totals mirror `computeSessionStats`: assistant and tool-result usage
 * plus the usage attached to compaction / branch-summary entries.
 */
export function parseSessionUsage(text: string, options: ParseSessionUsageOptions): SessionUsageRecord {
  const { path, timeZone } = options;
  const lines = text.split(/\r?\n/);
  const record: SessionUsageRecord = {
    path,
    id: options.id ?? "",
    cwd: "",
    created: "",
    modified: "",
    days: {},
  };

  let headerSeen = false;
  let lastMs = options.nowMs ?? Date.now();
  let latestMs = 0;
  let lastModel = "unknown";
  let modified = "";

  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = asRecord(parsed);
    if (!entry) continue;

    if (!headerSeen) {
      if (entry.type !== "session") continue;
      headerSeen = true;
      if (typeof entry.id === "string" && entry.id) record.id = entry.id;
      if (typeof entry.cwd === "string") record.cwd = entry.cwd;
      const headerMs = timestampMs(entry.timestamp);
      if (headerMs !== null) {
        lastMs = headerMs;
        latestMs = Math.max(latestMs, headerMs);
        if (typeof entry.timestamp === "string") record.created = entry.timestamp;
        modified = typeof entry.timestamp === "string" ? entry.timestamp : modified;
      }
      continue;
    }

    const entryMs = entry.type === "message" && asRecord(entry.message)
      ? (timestampMs(asRecord(entry.message)?.timestamp) ?? timestampMs(entry.timestamp))
      : timestampMs(entry.timestamp);
    if (entryMs !== null) {
      lastMs = entryMs;
      latestMs = Math.max(latestMs, entryMs);
      if (typeof entry.timestamp === "string") modified = entry.timestamp;
    }

    if (entry.type === "message") {
      const message = asRecord(entry.message);
      if (!message || typeof message.role !== "string") continue;
      const day = ensureDay(record, dayKeyForTimestamp(lastMs, timeZone));
      day.messages += 1;

      if (message.role === "assistant") {
        const provider = typeof message.provider === "string" ? message.provider : "";
        const model = typeof message.model === "string" ? message.model : "";
        if (provider || model) lastModel = `${provider}/${model}`.replace(/^\/|\/$/g, "") || "unknown";
        addUsageToBucket(day, message.usage);
        addModelUsage(day, lastModel, message.usage, 1);
      } else if (message.role === "toolResult") {
        addUsageToBucket(day, message.usage);
        addModelUsage(day, lastModel, message.usage, 1);
      }
      continue;
    }

    if (entry.type === "compaction" || entry.type === "branch_summary") {
      const day = ensureDay(record, dayKeyForTimestamp(lastMs, timeZone));
      addUsageToBucket(day, entry.usage);
      addModelUsage(day, lastModel, entry.usage);
    }
  }

  if (latestMs > 0) {
    record.modified = new Date(latestMs).toISOString();
    if (!record.created) record.created = record.modified;
  }

  for (const bucket of Object.values(record.days)) {
    updateTokenTotal(bucket.tokens);
    for (const model of Object.values(bucket.models)) updateTokenTotal(model.tokens);
  }

  return record;
}

// ============================================================================
// Cache (untrusted JSON at rest)
// ============================================================================

function coerceTokens(value: unknown): UsageTokens {
  const record = asRecord(value) ?? {};
  return updateTokenTotal({
    input: finite(record.input),
    output: finite(record.output),
    cacheRead: finite(record.cacheRead),
    cacheWrite: finite(record.cacheWrite),
    total: finite(record.total),
  });
}

function coerceBucket(value: unknown): UsageBucket {
  const record = asRecord(value) ?? {};
  return {
    messages: integer(record.messages),
    tokens: coerceTokens(record.tokens),
    cost: finite(record.cost),
  };
}

function coerceDayBucket(value: unknown): UsageDayBucket | null {
  const record = asRecord(value);
  if (!record) return null;
  const bucket: UsageDayBucket = {
    ...coerceBucket(record),
    sessions: Math.max(1, integer(record.sessions)),
    models: {},
  };
  const models = asRecord(record.models);
  if (models) {
    for (const [model, modelBucket] of Object.entries(models)) {
      if (!model) continue;
      bucket.models[model] = coerceBucket(modelBucket);
    }
  }
  return bucket;
}

function coerceRecord(value: unknown, path: string): SessionUsageRecord | null {
  const record = asRecord(value);
  if (!record || record.path !== path) return null;
  const days: Record<string, UsageDayBucket> = {};
  const rawDays = asRecord(record.days);
  if (rawDays) {
    for (const [day, bucket] of Object.entries(rawDays)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const coerced = coerceDayBucket(bucket);
      if (coerced) days[day] = coerced;
    }
  }
  return {
    path,
    id: typeof record.id === "string" ? record.id : "",
    cwd: typeof record.cwd === "string" ? record.cwd : "",
    created: typeof record.created === "string" ? record.created : "",
    modified: typeof record.modified === "string" ? record.modified : "",
    days,
  };
}

/** Parse the cache file defensively: corrupt cache means "cold", never a crash. */
export function parseUsageCache(raw: string | null, timeZone?: string): UsageCacheState {
  const empty: UsageCacheState = { version: USAGE_CACHE_VERSION, timeZone: timeZone ?? "", entries: {} };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  const state = asRecord(parsed);
  if (!state || state.version !== USAGE_CACHE_VERSION) return empty;
  if (timeZone !== undefined && state.timeZone !== timeZone) return empty;
  const entries: Record<string, UsageCacheEntry> = {};
  const rawEntries = asRecord(state.entries);
  if (rawEntries) {
    for (const [path, entry] of Object.entries(rawEntries)) {
      const value = asRecord(entry);
      if (!value) continue;
      const size = typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 ? value.size : null;
      const mtimeMs = typeof value.mtimeMs === "number" && Number.isFinite(value.mtimeMs) ? value.mtimeMs : null;
      if (size === null || mtimeMs === null) continue;
      const record = coerceRecord(value.record, path);
      if (!record) continue;
      entries[path] = { size, mtimeMs, record };
    }
  }
  return {
    version: USAGE_CACHE_VERSION,
    timeZone: typeof state.timeZone === "string" ? state.timeZone : "",
    entries,
  };
}

export function serializeUsageCache(state: UsageCacheState): string {
  return JSON.stringify(state);
}

// ============================================================================
// Aggregation
// ============================================================================

export interface SummarizeUsageOptions {
  range?: UsageRange;
  timeZone?: string;
  now?: Date;
}

function addDayPoint(target: UsageDayPoint, bucket: UsageDayBucket): void {
  target.sessions += bucket.sessions;
  target.messages += bucket.messages;
  target.tokens += bucket.tokens.total;
  target.cost += bucket.cost;
}

export function summarizeUsage(
  records: readonly SessionUsageRecord[],
  options: SummarizeUsageOptions = {},
): UsageStatsSummary {
  const range = options.range ?? "30d";
  const timeZone = isValidTimeZone(options.timeZone) ? options.timeZone : "";
  const now = options.now ?? new Date();
  const today = dayKeyForTimestamp(now.getTime(), timeZone || undefined);

  const allDays = new Set<string>();
  for (const record of records) {
    for (const day of Object.keys(record.days)) allDays.add(day);
  }

  let firstDay = today;
  if (range !== "all") {
    firstDay = addDays(today, range === "7d" ? -6 : -29);
  } else if (allDays.size > 0) {
    firstDay = [...allDays].sort()[0];
  }

  const dayPoints: UsageDayPoint[] = [];
  const dayIndex = new Map<string, UsageDayPoint>();
  for (let day = firstDay; day <= today; day = addDays(day, 1)) {
    const point: UsageDayPoint = { day, sessions: 0, messages: 0, tokens: 0, cost: 0 };
    dayPoints.push(point);
    dayIndex.set(day, point);
  }

  const modelTotals = new Map<string, UsageModelPoint>();
  const tokensByKind: UsageTokens = emptyTokens();
  let sessionCount = 0;
  let messages = 0;
  let tokens = 0;
  let cost = 0;

  for (const record of records) {
    let touched = false;
    for (const [day, bucket] of Object.entries(record.days)) {
      const point = dayIndex.get(day);
      if (!point) continue;
      touched = true;
      addDayPoint(point, bucket);
      messages += bucket.messages;
      tokens += bucket.tokens.total;
      cost += bucket.cost;
      tokensByKind.input += bucket.tokens.input;
      tokensByKind.output += bucket.tokens.output;
      tokensByKind.cacheRead += bucket.tokens.cacheRead;
      tokensByKind.cacheWrite += bucket.tokens.cacheWrite;
      for (const [model, modelBucket] of Object.entries(bucket.models)) {
        let total = modelTotals.get(model);
        if (!total) {
          total = { model, messages: 0, tokens: 0, cost: 0, share: 0 };
          modelTotals.set(model, total);
        }
        total.messages += modelBucket.messages;
        total.tokens += modelBucket.tokens.total;
        total.cost += modelBucket.cost;
      }
    }
    if (touched) sessionCount += 1;
  }

  updateTokenTotal(tokensByKind);
  const models = [...modelTotals.values()]
    .filter((model) => model.tokens > 0 || model.cost > 0 || model.messages > 0)
    .sort((a, b) => b.tokens - a.tokens || b.cost - a.cost || a.model.localeCompare(b.model));
  for (const model of models) model.share = tokens > 0 ? model.tokens / tokens : 0;

  return {
    range,
    timeZone,
    generatedAt: now.toISOString(),
    totals: { sessions: sessionCount, messages, tokens, cost, tokensByKind },
    days: dayPoints,
    models,
    scanned: { files: records.length, parsed: 0, cached: 0, failed: 0, durationMs: 0 },
  };
}

// ============================================================================
// Collection + fingerprint cache
// ============================================================================

async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

export interface CollectUsageStatsOptions extends SummarizeUsageOptions {
  io?: UsageStatsIo;
}

export async function collectUsageStats(
  options: CollectUsageStatsOptions = {},
): Promise<UsageStatsSummary> {
  const io = options.io ?? defaultUsageStatsIo();
  const timeZone = isValidTimeZone(options.timeZone) ? options.timeZone : "";
  const now = options.now ?? new Date();
  const startedAt = Date.now();

  // A cache written under another timezone has the wrong day buckets; the
  // version/timezone pair invalidates it wholesale rather than mixing zones.
  const cache = parseUsageCache(await io.readCache(), timeZone);
  const files = await io.listSessionFiles();
  const entries: Record<string, UsageCacheEntry> = {};
  let parsedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  await runPool(files, 8, async (file) => {
    const fingerprint = await io.statFile(file).catch(() => null);
    if (!fingerprint) {
      failedCount += 1;
      return;
    }
    const cached = cache.entries[file];
    if (cached && cached.size === fingerprint.size && cached.mtimeMs === fingerprint.mtimeMs) {
      entries[file] = cached;
      cachedCount += 1;
      return;
    }
    try {
      const text = await io.readFileText(file);
      const record = parseSessionUsage(text, {
        path: file,
        timeZone: timeZone || undefined,
        nowMs: now.getTime(),
      });
      entries[file] = { ...fingerprint, record };
      parsedCount += 1;
    } catch {
      failedCount += 1;
    }
  });

  const staleDropped = Object.keys(cache.entries).some((path) => !(path in entries));
  if (parsedCount > 0 || staleDropped) {
    try {
      await io.writeCache(serializeUsageCache({
        version: USAGE_CACHE_VERSION,
        timeZone,
        entries,
      }));
    } catch {
      // The cache is an accelerator; a failed write must not fail the request.
    }
  }

  const summary = summarizeUsage(Object.values(entries).map((entry) => entry.record), {
    range: options.range,
    timeZone: timeZone || undefined,
    now,
  });
  summary.scanned = {
    files: files.length,
    parsed: parsedCount,
    cached: cachedCount,
    failed: failedCount,
    durationMs: Date.now() - startedAt,
  };
  return summary;
}

// ============================================================================
// Default IO
// ============================================================================

let agentDirectoryPromise: Promise<string> | null = null;

function getAgentDirectory(): Promise<string> {
  if (!agentDirectoryPromise) {
    agentDirectoryPromise = import("@earendil-works/pi-coding-agent")
      .then((sdk) => sdk.getAgentDir());
  }
  return agentDirectoryPromise;
}

/** Production IO. The SDK is imported lazily so tests never load it. */
export function defaultUsageStatsIo(): UsageStatsIo {
  return {
    async listSessionFiles(): Promise<string[]> {
      const sessionsDir = join(await getAgentDirectory(), "sessions");
      let projectDirs;
      try {
        projectDirs = await readdir(sessionsDir, { withFileTypes: true });
      } catch {
        return [];
      }
      const files: string[] = [];
      for (const projectDir of projectDirs) {
        if (!projectDir.isDirectory() && !projectDir.isSymbolicLink()) continue;
        const projectPath = join(sessionsDir, projectDir.name);
        try {
          for (const name of await readdir(projectPath)) {
            if (name.endsWith(".jsonl")) files.push(join(projectPath, name));
          }
        } catch {
          // Unreadable project dir: skipped, same as the session-list scanner.
        }
      }
      return files;
    },
    async statFile(path: string): Promise<UsageFingerprint | null> {
      try {
        const stats = await stat(path);
        return { size: stats.size, mtimeMs: stats.mtimeMs };
      } catch {
        return null;
      }
    },
    async readFileText(path: string): Promise<string> {
      return readFile(path, "utf8");
    },
    async readCache(): Promise<string | null> {
      const cachePath = join(await getAgentDirectory(), USAGE_CACHE_FILE_NAME);
      try {
        return await readFile(cachePath, "utf8");
      } catch {
        return null;
      }
    },
    async writeCache(content: string): Promise<void> {
      const cachePath = join(await getAgentDirectory(), USAGE_CACHE_FILE_NAME);
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, content, { encoding: "utf8", mode: 0o600 });
    },
  };
}
