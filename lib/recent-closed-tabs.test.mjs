import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  RECENT_CLOSED_LIMIT,
  RECENT_CLOSED_STORAGE_KEY,
  forgetClosedTab,
  isRestorableTab,
  loadRecentClosedTabs,
  parseRecentClosedTabs,
  recordClosedTab,
  saveRecentClosedTabs,
} = await jiti.import("@/lib/recent-closed-tabs");

const fileTab = (id, filePath = `/tmp/${id}.ts`, label = id) => ({ id, label, filePath });

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, value); },
    dump: () => Object.fromEntries(data),
  };
}

test("only snapshot-rebuildable tabs are restorable", () => {
  assert.equal(isRestorableTab({ id: "file:/a.ts", filePath: "/a.ts" }), true);
  assert.equal(isRestorableTab({ id: "git-graph", filePath: "", kind: "git-graph" }), false,
    "git-graph 的 filePath 是空串，不是可重开的路径");
  assert.equal(isRestorableTab({ id: "git-graph", filePath: "git", kind: "git-graph" }), true);
  assert.equal(isRestorableTab({ id: "terminal:1", filePath: "/tmp", kind: "terminal" }), false);
  assert.equal(isRestorableTab({ id: "browser:1", filePath: "https://x", kind: "browser" }), false);
  assert.equal(isRestorableTab({ id: "branch:s1", filePath: "s1", kind: "session" }), false);
  assert.equal(isRestorableTab({ id: "file:/a.ts" }), false, "没有路径就无从重开");
});

test("a closed tab is recorded newest-first with its id preserved", () => {
  let list = recordClosedTab([], fileTab("file:/a.ts", "/a.ts", "a.ts"));
  list = recordClosedTab(list, fileTab("file:/b.ts", "/b.ts", "b.ts"));
  assert.deepEqual(list.map((item) => item.id), ["file:/b.ts", "file:/a.ts"]);
  assert.equal(list[0].label, "b.ts");
});

test("non-restorable tabs never enter the history", () => {
  const list = recordClosedTab([], { id: "terminal:1", label: "sh", filePath: "/tmp", kind: "terminal" });
  assert.deepEqual(list, []);
});

test("closing the same tab twice keeps one entry, at the front", () => {
  let list = recordClosedTab([], fileTab("file:/a.ts"));
  list = recordClosedTab(list, fileTab("file:/b.ts"));
  list = recordClosedTab(list, fileTab("file:/a.ts", "/a.ts", "renamed.ts"));
  assert.deepEqual(list.map((item) => item.id), ["file:/a.ts", "file:/b.ts"]);
  assert.equal(list[0].label, "renamed.ts", "最新的快照覆盖旧的");
});

test("history is capped from the tail", () => {
  let list = [];
  for (let index = 0; index < RECENT_CLOSED_LIMIT + 5; index += 1) {
    list = recordClosedTab(list, fileTab(`file:/f${index}.ts`));
  }
  assert.equal(list.length, RECENT_CLOSED_LIMIT);
  assert.equal(list[0].id, `file:/f${RECENT_CLOSED_LIMIT + 4}.ts`);
  assert.equal(list.at(-1).id, "file:/f5.ts", "最早的几条被挤掉了");
});

test("recording does not mutate the input list", () => {
  const original = [fileTab("file:/a.ts")];
  const next = recordClosedTab(original, fileTab("file:/b.ts"));
  assert.equal(original.length, 1);
  assert.notEqual(next, original);
});

test("forgetClosedTab removes exactly one id", () => {
  const list = [fileTab("file:/a.ts"), fileTab("file:/b.ts")];
  assert.deepEqual(forgetClosedTab(list, "file:/a.ts").map((item) => item.id), ["file:/b.ts"]);
  assert.deepEqual(forgetClosedTab(list, "file:/missing.ts").map((item) => item.id), ["file:/a.ts", "file:/b.ts"]);
});

test("malformed storage payloads are dropped, not trusted", () => {
  assert.deepEqual(parseRecentClosedTabs(null), []);
  assert.deepEqual(parseRecentClosedTabs({}), []);
  assert.deepEqual(parseRecentClosedTabs("nope"), []);
  assert.deepEqual(
    parseRecentClosedTabs([
      null,
      42,
      "x",
      { id: "missing-path", label: "x" },
      { id: "missing-label", filePath: "/a.ts" },
      { id: "", label: "x", filePath: "/a.ts" },
      { id: "file:/a.ts", label: "a.ts", filePath: "" },
      { id: "terminal:1", label: "sh", filePath: "/tmp", kind: "terminal" },
      { id: "file:/ok.ts", label: "ok.ts", filePath: "/ok.ts" },
    ]),
    [{ id: "file:/ok.ts", label: "ok.ts", filePath: "/ok.ts" }],
  );
});

test("duplicate ids in storage collapse to the first occurrence", () => {
  const parsed = parseRecentClosedTabs([
    { id: "file:/a.ts", label: "first.ts", filePath: "/a.ts" },
    { id: "file:/a.ts", label: "second.ts", filePath: "/a.ts" },
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].label, "first.ts");
});

test("storage round-trips and survives a broken value", () => {
  const storage = memoryStorage();
  saveRecentClosedTabs([fileTab("file:/a.ts")], storage);
  assert.deepEqual(loadRecentClosedTabs(storage).map((item) => item.id), ["file:/a.ts"]);

  const broken = memoryStorage({ [RECENT_CLOSED_STORAGE_KEY]: "{" });
  assert.deepEqual(loadRecentClosedTabs(broken), [], "坏 JSON 不抛，退化成空历史");
  assert.deepEqual(loadRecentClosedTabs(null), [], "没有存储就没有历史");
  assert.doesNotThrow(() => saveRecentClosedTabs([fileTab("file:/a.ts")], null));
});

test("a storage that throws on write is not fatal", () => {
  const throwing = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
  };
  assert.doesNotThrow(() => saveRecentClosedTabs([fileTab("file:/a.ts")], throwing));
});

test("git-graph round-trips with its kind intact", () => {
  const storage = memoryStorage();
  saveRecentClosedTabs(recordClosedTab([], { id: "git-graph", label: "Git", filePath: "git", kind: "git-graph" }), storage);
  const [restored] = loadRecentClosedTabs(storage);
  assert.equal(restored.kind, "git-graph");
  assert.equal(restored.filePath, "git");
});
