// fork:zc-03 — usage aggregation, fingerprint cache, timezone bucketing.
// Everything runs against an in-memory IO: no ~/.pi/ reads or writes.
import assert from "node:assert/strict";
import test from "node:test";

const {
  USAGE_CACHE_VERSION,
  collectUsageStats,
  dayKeyForTimestamp,
  parseSessionUsage,
  parseUsageCache,
  serializeUsageCache,
  summarizeUsage,
} = await import("./usage-stats.ts");

function sessionLine(id, cwd, timestamp) {
  return JSON.stringify({ type: "session", version: 3, id, cwd, timestamp });
}

function userLine(timestamp, text = "hi") {
  return JSON.stringify({
    type: "message",
    id: `u${Math.random().toString(16).slice(2)}`,
    parentId: null,
    timestamp,
    message: { role: "user", content: text },
  });
}

function assistantLine(timestamp, provider, model, usage) {
  return JSON.stringify({
    type: "message",
    id: `a${Math.random().toString(16).slice(2)}`,
    parentId: null,
    timestamp,
    message: { role: "assistant", provider, model, content: [{ type: "text", text: "ok" }], usage },
  });
}

function toolResultLine(timestamp, usage) {
  return JSON.stringify({
    type: "message",
    id: `t${Math.random().toString(16).slice(2)}`,
    parentId: null,
    timestamp,
    message: { role: "toolResult", toolCallId: "call-1", content: [], usage },
  });
}

function usage(input, output, cacheRead, cacheWrite, cost) {
  return { input, output, cacheRead, cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } };
}

function createMemoryIo(initialFiles) {
  const files = new Map(initialFiles);
  let cache = null;
  let reads = 0;
  let writes = 0;
  return {
    files,
    counts: () => ({ reads, writes }),
    io: {
      async listSessionFiles() {
        return [...files.keys()];
      },
      async statFile(path) {
        const file = files.get(path);
        return file ? { size: file.text.length, mtimeMs: file.mtimeMs } : null;
      },
      async readFileText(path) {
        reads += 1;
        const file = files.get(path);
        if (!file) throw new Error("missing");
        return file.text;
      },
      async readCache() {
        return cache;
      },
      async writeCache(content) {
        writes += 1;
        cache = content;
      },
    },
    getCache: () => cache,
  };
}

const NOW = new Date("2026-09-21T12:00:00.000Z");

test("aggregates sessions, messages, tokens, cost, models and days", async () => {
  const s1 = [
    sessionLine("s1", "/work/a", "2026-09-20T10:00:00.000Z"),
    userLine("2026-09-20T10:00:10.000Z"),
    assistantLine("2026-09-20T10:01:00.000Z", "p", "model-a", usage(100, 50, 10, 5, 0.5)),
    toolResultLine("2026-09-20T10:02:00.000Z", usage(20, 0, 0, 0, 0.1)),
  ].join("\n");
  const s2 = [
    sessionLine("s2", "/work/b", "2026-09-21T01:00:00.000Z"),
    assistantLine("2026-09-21T01:01:00.000Z", "q", "model-b", usage(200, 100, 0, 0, 1)),
  ].join("\n");

  const memory = createMemoryIo([
    ["/sessions/a/one.jsonl", { text: s1, mtimeMs: 1000 }],
    ["/sessions/b/two.jsonl", { text: s2, mtimeMs: 2000 }],
  ]);

  const summary = await collectUsageStats({ io: memory.io, range: "all", timeZone: "UTC", now: NOW });
  assert.equal(summary.totals.sessions, 2);
  assert.equal(summary.totals.messages, 4);
  assert.equal(summary.totals.tokens, 485); // 100+50+10+5+20 + 200+100
  assert.equal(summary.totals.cost, 1.6);
  assert.deepEqual(summary.totals.tokensByKind, { input: 320, output: 150, cacheRead: 10, cacheWrite: 5, total: 485 });

  const day20 = summary.days.find((day) => day.day === "2026-09-20");
  const day21 = summary.days.find((day) => day.day === "2026-09-21");
  assert.deepEqual(day20, { day: "2026-09-20", sessions: 1, messages: 3, tokens: 185, cost: 0.6 });
  assert.deepEqual(day21, { day: "2026-09-21", sessions: 1, messages: 1, tokens: 300, cost: 1 });

  const byModel = Object.fromEntries(summary.models.map((model) => [model.model, model]));
  assert.equal(byModel["p/model-a"].tokens, 185);
  assert.equal(byModel["p/model-a"].messages, 2);
  assert.equal(byModel["q/model-b"].tokens, 300);
  assert.equal(Math.round(byModel["p/model-a"].share * 1000) / 1000, 0.381);
  assert.equal(summary.scanned.parsed, 2);
  assert.equal(summary.scanned.cached, 0);
});

test("cache hit skips re-parsing until the fingerprint changes", async () => {
  const text = [
    sessionLine("s1", "/work/a", "2026-09-20T10:00:00.000Z"),
    assistantLine("2026-09-20T10:01:00.000Z", "p", "model-a", usage(10, 5, 0, 0, 0.1)),
  ].join("\n");
  const memory = createMemoryIo([
    ["/sessions/a/one.jsonl", { text, mtimeMs: 1000 }],
  ]);

  await collectUsageStats({ io: memory.io, range: "all", timeZone: "UTC", now: NOW });
  assert.equal(memory.counts().reads, 1);

  const second = await collectUsageStats({ io: memory.io, range: "all", timeZone: "UTC", now: NOW });
  assert.equal(memory.counts().reads, 1, "unchanged file must not be read again");
  assert.equal(second.scanned.cached, 1);
  assert.equal(second.scanned.parsed, 0);
  assert.equal(second.totals.tokens, 15);

  // Same size, new mtime: the append-only session file changed, re-parse it.
  memory.files.get("/sessions/a/one.jsonl").mtimeMs = 2000;
  const third = await collectUsageStats({ io: memory.io, range: "all", timeZone: "UTC", now: NOW });
  assert.equal(memory.counts().reads, 2);
  assert.equal(third.scanned.parsed, 1);
  assert.equal(third.scanned.cached, 0);
});

test("a different timezone invalidates the persisted cache", async () => {
  const text = [
    sessionLine("s1", "/work/a", "2026-09-20T16:30:00.000Z"),
    assistantLine("2026-09-20T16:30:00.000Z", "p", "model-a", usage(10, 0, 0, 0, 0)),
  ].join("\n");
  const memory = createMemoryIo([["/sessions/a/one.jsonl", { text, mtimeMs: 1000 }]]);

  const utc = await collectUsageStats({ io: memory.io, range: "all", timeZone: "UTC", now: NOW });
  assert.equal(utc.days.find((day) => day.tokens > 0)?.day, "2026-09-20");

  const shanghai = await collectUsageStats({ io: memory.io, range: "all", timeZone: "Asia/Shanghai", now: NOW });
  assert.equal(memory.counts().reads, 2, "timezone change forces a re-parse");
  assert.equal(shanghai.days.find((day) => day.tokens > 0)?.day, "2026-09-21");
});

test("day keys respect timezone boundaries", () => {
  const instant = Date.parse("2026-09-20T16:30:00.000Z");
  assert.equal(dayKeyForTimestamp(instant, "UTC"), "2026-09-20");
  assert.equal(dayKeyForTimestamp(instant, "Asia/Shanghai"), "2026-09-21");
  assert.equal(dayKeyForTimestamp(instant, "America/New_York"), "2026-09-20");
  assert.equal(dayKeyForTimestamp(Date.parse("2026-09-20T23:59:59.000Z"), "UTC"), "2026-09-20");
  assert.equal(dayKeyForTimestamp(Date.parse("2026-09-21T00:00:00.000Z"), "UTC"), "2026-09-21");
});

test("corrupt lines and malformed usage do not crash the parser", () => {
  const text = [
    sessionLine("s1", "/work/a", "2026-09-20T10:00:00.000Z"),
    "this is not json",
    JSON.stringify({ type: "message", message: { role: "assistant" } }),
    JSON.stringify({ type: "message", timestamp: "2026-09-20T10:01:00.000Z", message: { role: "assistant", provider: "p", model: "m", usage: { input: "lots", cost: null } } }),
    assistantLine("2026-09-20T10:02:00.000Z", "p", "m", usage(7, 3, 0, 0, 0.25)),
  ].join("\n");

  const record = parseSessionUsage(text, { path: "/x.jsonl", timeZone: "UTC", nowMs: NOW.getTime() });
  assert.equal(record.id, "s1");
  assert.deepEqual(record.days["2026-09-20"].tokens, { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, total: 10 });
  assert.equal(record.days["2026-09-20"].messages, 3);
  assert.equal(record.days["2026-09-20"].cost, 0.25);
});

test("empty sessions directory yields zeroed totals and a zeroed range", async () => {
  const memory = createMemoryIo([]);
  const summary = await collectUsageStats({ io: memory.io, range: "7d", timeZone: "UTC", now: NOW });
  assert.equal(summary.totals.sessions, 0);
  assert.equal(summary.totals.tokens, 0);
  assert.equal(summary.days.length, 7);
  assert.equal(summary.models.length, 0);
  assert.equal(memory.counts().writes, 0, "empty scan must not write a cache file");
});

test("summarizeUsage filters days outside the requested range", () => {
  const record = {
    path: "/x.jsonl",
    id: "s1",
    cwd: "/work",
    created: "2026-09-01T00:00:00.000Z",
    modified: "2026-09-21T00:00:00.000Z",
    days: {
      "2026-08-01": { messages: 1, tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 }, cost: 1, sessions: 1, models: {} },
      "2026-09-21": { messages: 2, tokens: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, total: 2 }, cost: 2, sessions: 1, models: { "p/m": { messages: 2, tokens: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, total: 2 }, cost: 2 } } },
    },
  };
  const week = summarizeUsage([record], { range: "7d", timeZone: "UTC", now: NOW });
  assert.equal(week.totals.sessions, 1);
  assert.equal(week.totals.tokens, 2);
  assert.equal(week.days.length, 7);

  const all = summarizeUsage([record], { range: "all", timeZone: "UTC", now: NOW });
  assert.equal(all.totals.sessions, 1);
  assert.equal(all.totals.tokens, 3);
  assert.equal(all.totals.cost, 3);
});

test("cache JSON is validated before use", () => {
  assert.deepEqual(parseUsageCache("not json"), { version: USAGE_CACHE_VERSION, timeZone: "", entries: {} });
  assert.deepEqual(parseUsageCache(JSON.stringify({ version: 99, entries: {} })), {
    version: USAGE_CACHE_VERSION,
    timeZone: "",
    entries: {},
  });

  const state = {
    version: USAGE_CACHE_VERSION,
    timeZone: "UTC",
    entries: {
      "/x.jsonl": { size: 10, mtimeMs: 5, record: { path: "/x.jsonl", id: "s", cwd: "", created: "", modified: "", days: {} } },
      "/bad.jsonl": { size: "nope", mtimeMs: 5, record: { path: "/bad.jsonl", days: {} } },
    },
  };
  const parsed = parseUsageCache(serializeUsageCache(state), "UTC");
  assert.deepEqual(Object.keys(parsed.entries), ["/x.jsonl"]);
  // Wrong timezone means the whole cache is treated as cold.
  assert.equal(Object.keys(parseUsageCache(serializeUsageCache(state), "Asia/Shanghai").entries).length, 0);
});
