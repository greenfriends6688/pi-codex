import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  appendCronHistory,
  deleteCronTask,
  invalidateCronCache,
  listCronTasks,
  normalizeSchedule,
  normalizeTask,
  readCronFile,
  upsertCronTask,
} = await jiti.import("@/lib/cron-store");
const { CRON_HISTORY_LIMIT } = await jiti.import("@/lib/cron-schedule");

function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-cron-"));
  const file = join(dir, "pi-web-cron.json");
  try {
    run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const baseTask = {
  name: "nightly",
  prompt: "check deps",
  cwd: "/repo",
  schedule: { kind: "daily", times: ["09:00"] },
  enabled: true,
  runCount: 0,
};

test("schedule shapes are validated on the way in", () => {
  assert.deepEqual(normalizeSchedule({ kind: "daily", times: ["09:00", "9:00"] }), { kind: "daily", times: ["09:00"] });
  assert.deepEqual(normalizeSchedule({ kind: "weekly", times: ["09:00"], weekdays: [5, 1, 1] }), { kind: "weekly", times: ["09:00"], weekdays: [1, 5] });
  assert.equal(normalizeSchedule({ kind: "daily", times: [] }), null);
  assert.equal(normalizeSchedule({ kind: "once", times: ["09:00"], date: "2026-13-01" }), null);
  assert.equal(normalizeSchedule({ kind: "cron", times: [], expression: "* * * *" }), null);
  assert.equal(normalizeSchedule({ kind: "weekly", times: ["09:00"], weekdays: [] }), null);
  // Timezone only survives when the runtime knows it; windows are de-duplicated away.
  assert.equal(normalizeSchedule({ kind: "daily", times: ["09:00"], timezone: "Mars/Base" }).timezone, undefined);
  assert.equal(normalizeSchedule({ kind: "daily", times: ["09:00"], idleWindow: { start: "09:00", end: "09:00" } }).idleWindow, undefined);
});

test("a task without a cwd means the default working directory", () => {
  const task = normalizeTask({ ...baseTask, cwd: "" });
  assert.equal(task.cwd, "", "empty cwd is kept so the runner can fall back");
  assert.equal(normalizeTask({ ...baseTask, prompt: "  " }), null);
  assert.equal(normalizeTask({ ...baseTask, model: { provider: "x" } }).model, undefined, "half a model override is dropped");
  assert.deepEqual(normalizeTask({ ...baseTask, model: { provider: "x", modelId: "y" }, thinking: "high" }).model, { provider: "x", modelId: "y" });
});

test("the run log keeps the newest runs and stays bounded", () => withStore((file) => {
  const task = normalizeTask({ ...baseTask });
  upsertCronTask(task, file);
  invalidateCronCache();

  for (let i = 0; i < CRON_HISTORY_LIMIT + 5; i += 1) {
    appendCronHistory(task.id, { at: new Date(2026, 0, 1, i).toISOString(), status: i % 2 === 0 ? "ok" : "error", sessionId: `s${i}` }, file);
  }

  const stored = listCronTasks(new Date(), file)[0];
  assert.equal(stored.history.length, CRON_HISTORY_LIMIT, "older runs fall off the end");
  assert.equal(stored.history[0].sessionId, `s${CRON_HISTORY_LIMIT + 4}`, "newest first");
  assert.equal(stored.history[0].status, (CRON_HISTORY_LIMIT + 4) % 2 === 0 ? "ok" : "error", "the stored status matches the run that was appended");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).version, 1);
}));

test("appending to an unknown task is a no-op", () => withStore((file) => {
  appendCronHistory("missing", { at: new Date().toISOString(), status: "ok" }, file);
  assert.equal(readCronFile(file).tasks.length, 0);
}));

test("delete removes exactly one task", () => withStore((file) => {
  const a = normalizeTask({ ...baseTask, name: "a" });
  const b = normalizeTask({ ...baseTask, name: "b" });
  upsertCronTask(a, file);
  upsertCronTask(b, file);
  invalidateCronCache();

  assert.equal(deleteCronTask(a.id, file), true);
  assert.equal(deleteCronTask(a.id, file), false);
  assert.deepEqual(readCronFile(file).tasks.map((task) => task.name), ["b"]);
}));
