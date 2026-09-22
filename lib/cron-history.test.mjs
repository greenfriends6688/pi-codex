import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

/*
 * fork:zc-14 — the run-history pure layer.
 *
 * Every timestamp is derived from an injected clock, so these tests never race a
 * real run: pass a fixed clock, assert the record, done.
 */

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  CRON_HISTORY_KEEP,
  appendRunRecord,
  deleteRunRecord,
  filterRunHistory,
  finishRunRecord,
  historyForTask,
  parseRunHistory,
  runDurationMs,
  skipRunRecord,
  startRunRecord,
  summarizeRunOutput,
  updateRunRecord,
} = await jiti.import("@/lib/cron-history");
const { CRON_HISTORY_LIMIT } = await jiti.import("@/lib/cron-schedule");
const { listCronTasks, readCronFile, invalidateCronCache } = await jiti.import("@/lib/cron-store");

const clockAt = (iso) => () => new Date(iso);
const record = (overrides = {}) => ({ at: "2026-09-21T09:00:00.000Z", status: "ok", ...overrides });

test("start → finish keeps the id and derives the duration from the injected clock", () => {
  const started = startRunRecord(
    { id: "run-1", trigger: "schedule", attempt: 1 },
    clockAt("2026-09-21T09:00:00.000Z"),
  );
  assert.deepEqual(started, {
    id: "run-1",
    at: "2026-09-21T09:00:00.000Z",
    status: "running",
    trigger: "schedule",
    attempt: 1,
  });

  const finished = finishRunRecord(
    started,
    { status: "ok", outputExcerpt: "all green", sessionId: "session-1", exitCode: 0 },
    clockAt("2026-09-21T09:00:42.000Z"),
  );
  assert.equal(finished.id, "run-1");
  assert.equal(finished.at, "2026-09-21T09:00:00.000Z");
  assert.equal(finished.finishedAt, "2026-09-21T09:00:42.000Z");
  assert.equal(finished.status, "ok");
  assert.equal(finished.sessionId, "session-1");
  assert.equal(finished.outputExcerpt, "all green");
  assert.equal(runDurationMs(finished), 42_000);
});

test("appending prepends and trims to the bounded ring", () => {
  assert.equal(CRON_HISTORY_KEEP, CRON_HISTORY_LIMIT);

  let history = [];
  for (let index = 0; index < CRON_HISTORY_KEEP + 7; index += 1) {
    history = appendRunRecord(history, record({ at: new Date(2026, 0, 1, 0, index).toISOString(), status: "ok" }));
  }
  assert.equal(history.length, CRON_HISTORY_KEEP, "older runs fall off the end");
  assert.equal(Date.parse(history[0].at), Date.parse(new Date(2026, 0, 1, 0, CRON_HISTORY_KEEP + 6).toISOString()), "newest first");
  assert.ok(history.every((entry, index) => index === 0 || Date.parse(history[index - 1].at) >= Date.parse(entry.at)));

  // A short explicit ring still trims.
  let tiny = [];
  for (let index = 0; index < 5; index += 1) tiny = appendRunRecord(tiny, record({ at: `2026-09-2${index}T00:00:00.000Z` }), 3);
  assert.equal(tiny.length, 3);
});

test("finishing a run replaces its start entry instead of appending a second one", () => {
  const started = startRunRecord({ id: "run-1" }, clockAt("2026-09-21T09:00:00.000Z"));
  let history = appendRunRecord([], record({ id: "run-0", at: "2026-09-20T09:00:00.000Z" }));
  history = appendRunRecord(history, started);

  const finished = finishRunRecord(started, { status: "error", error: "boom" }, clockAt("2026-09-21T09:01:00.000Z"));
  history = updateRunRecord(history, finished);

  assert.equal(history.length, 2, "no duplicate row");
  assert.equal(history[0].id, "run-1");
  assert.equal(history[0].status, "error");
  assert.equal(history[1].id, "run-0", "finishing does not reorder the log");
});

test("updating an unknown id falls back to a normal append", () => {
  const history = updateRunRecord([], record({ id: "run-9" }));
  assert.equal(history.length, 1);
  assert.equal(history[0].id, "run-9");
});

test("deleteRunRecord removes exactly the matching row", () => {
  const history = [record({ id: "a" }), record({ id: "b" }), record({ id: "c" })];
  assert.deepEqual(deleteRunRecord(history, "b").map((entry) => entry.id), ["a", "c"]);
  assert.equal(deleteRunRecord(history, "missing").length, 3);
});

test("filter by status, trigger and session, and pick one task's history", () => {
  const history = [
    record({ id: "1", status: "ok", trigger: "schedule", sessionId: "s1" }),
    record({ id: "2", status: "error", trigger: "retry", sessionId: "s1" }),
    record({ id: "3", status: "skipped", trigger: "schedule" }),
    record({ id: "4", status: "ok", trigger: "manual", sessionId: "s2" }),
  ];
  assert.deepEqual(filterRunHistory(history, { status: "ok" }).map((entry) => entry.id), ["1", "4"]);
  assert.deepEqual(filterRunHistory(history, { status: ["error", "skipped"] }).map((entry) => entry.id), ["2", "3"]);
  assert.deepEqual(filterRunHistory(history, { trigger: "schedule" }).map((entry) => entry.id), ["1", "3"]);
  assert.deepEqual(filterRunHistory(history, { sessionId: "s1" }).map((entry) => entry.id), ["1", "2"]);

  const tasks = [{ id: "t1", history: [record({ id: "a" })] }, { id: "t2", history: [record({ id: "b" })] }];
  assert.deepEqual(historyForTask(tasks, "t2").map((entry) => entry.id), ["b"]);
  assert.deepEqual(historyForTask(tasks, "missing"), []);
});

test("skip records carry the reason and a finish time", () => {
  const skipped = skipRunRecord(
    { id: "run-2", at: new Date("2026-09-21T08:00:00.000Z"), trigger: "schedule" },
    "computer_asleep_or_app_not_running",
    clockAt("2026-09-21T12:00:00.000Z"),
  );
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.at, "2026-09-21T08:00:00.000Z");
  assert.equal(skipped.finishedAt, "2026-09-21T12:00:00.000Z");
  assert.equal(skipped.skipReason, "computer_asleep_or_app_not_running");
  assert.equal(runDurationMs(skipped), 4 * 60 * 60 * 1000);
});

test("the tolerant parser accepts legacy rows, drops garbage and sorts newest first", () => {
  const parsed = parseRunHistory([
    { at: "2026-09-20T09:00:00.000Z", status: "ok", sessionId: "s1" },
    { at: "2026-09-21T09:00:00.000Z", status: "error", error: "boom", unexpected: "ignored" },
    null,
    42,
    "not a record",
    { status: "ok" }, // no `at`
    { at: "2026-09-22T09:00:00.000Z", status: "garbage" }, // unknown status → error
    { at: "2026-09-23T09:00:00.000Z", status: "skipped", skipReason: "claim_expired" },
  ]);
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed.map((entry) => entry.at), [
    "2026-09-23T09:00:00.000Z",
    "2026-09-22T09:00:00.000Z",
    "2026-09-21T09:00:00.000Z",
    "2026-09-20T09:00:00.000Z",
  ]);
  assert.equal(parsed[0].skipReason, "claim_expired");
  assert.equal(parsed[1].status, "error");
  assert.equal(parsed[2].error, "boom");
  assert.equal("unexpected" in parsed[2], false);

  assert.deepEqual(parseRunHistory(undefined), []);
  assert.deepEqual(parseRunHistory({ nope: true }), []);
  assert.deepEqual(parseRunHistory([{ startedAt: "2026-09-25T09:00:00.000Z", status: "ok" }]).map((entry) => entry.at), ["2026-09-25T09:00:00.000Z"]);
});

test("output excerpts are trimmed, bounded and empty-safe", () => {
  assert.equal(summarizeRunOutput("  hello\nworld  "), "hello\nworld");
  assert.equal(summarizeRunOutput(""), undefined);
  assert.equal(summarizeRunOutput(undefined), undefined);
  const long = "x".repeat(1000);
  const excerpt = summarizeRunOutput(long, 100);
  assert.equal(excerpt.length, 100);
  assert.ok(excerpt.endsWith("…"));
});

test("a corrupt history file does not take the task list down", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-cron-history-"));
  const file = join(dir, "pi-web-cron.json");
  try {
    writeFileSync(file, JSON.stringify({
      version: 1,
      tasks: [{
        id: "t1",
        name: "corrupt",
        prompt: "go",
        cwd: "",
        schedule: { kind: "daily", times: ["09:00"] },
        enabled: true,
        createdAt: "2026-09-21T09:00:00.000Z",
        runCount: 0,
        history: { not: "an array" },
      }, {
        id: "t2",
        name: "partly corrupt",
        prompt: "go",
        cwd: "",
        schedule: { kind: "daily", times: ["09:00"] },
        enabled: true,
        createdAt: "2026-09-21T09:00:00.000Z",
        runCount: 0,
        history: [null, 7, { at: 5 }, { at: "2026-09-22T09:00:00.000Z", status: "ok" }],
      }],
    }));
    invalidateCronCache();
    const tasks = listCronTasks(new Date("2026-09-23T00:00:00.000Z"), file);
    assert.equal(tasks.length, 2, "both tasks survive a corrupt history field");
    const corrupt = readCronFile(file).tasks.find((task) => task.id === "t1");
    const partial = readCronFile(file).tasks.find((task) => task.id === "t2");
    assert.equal(corrupt.history, undefined, "a non-array history is dropped, not thrown");
    assert.deepEqual(partial.history.map((entry) => entry.at), ["2026-09-22T09:00:00.000Z"]);
  } finally {
    invalidateCronCache();
    rmSync(dir, { recursive: true, force: true });
  }
});
