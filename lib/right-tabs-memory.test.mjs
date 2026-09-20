import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { sanitizeRightTabs, loadRightTabs, saveRightTabs } = await jiti.import("./right-tabs-memory.ts");

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
  };
}

const tab = (overrides = {}) => ({
  id: "file:/tmp/a.ts",
  label: "a.ts",
  filePath: "/tmp/a.ts",
  sourceSessionId: null,
  viewerState: { displayMode: "source", wrapLines: true, scrollTop: 120, scrollLeft: 0 },
  ...overrides,
});

test("drops malformed tabs instead of letting them reach the panel", () => {
  const sanitized = sanitizeRightTabs({
    fileTabs: [
      tab(),
      { id: "file:broken" },
      { id: "file:no-path", filePath: "" },
      "not-an-object",
      tab({ id: "file:/tmp/b.ts", filePath: "/tmp/b.ts", viewerState: { displayMode: "nope" } }),
    ],
    activeTabId: "file:/tmp/a.ts",
  });
  assert.equal(sanitized.fileTabs.length, 2);
  assert.deepEqual(sanitized.fileTabs.map((entry) => entry.id), ["file:/tmp/a.ts", "file:/tmp/b.ts"]);
  // 非法 viewerState 被丢弃，但 tab 本身保留（文件还能看，只是回到默认视图状态）。
  assert.equal(sanitized.fileTabs[1].viewerState, undefined);
  assert.equal(sanitized.activeTabId, "file:/tmp/a.ts");
});

test("falls back to the last tab when the remembered active tab is gone", () => {
  const sanitized = sanitizeRightTabs({ fileTabs: [tab()], activeTabId: "file:/tmp/missing.ts" });
  assert.equal(sanitized.activeTabId, "file:/tmp/a.ts");
});

test("rejects non-object payloads and empty storage", () => {
  assert.equal(sanitizeRightTabs(null), null);
  assert.equal(sanitizeRightTabs([1, 2]), null);
  assert.equal(sanitizeRightTabs("nope"), null);
  assert.equal(loadRightTabs("/repo", memoryStorage()), null);
});

test("keeps one slot per workspace and deletes it when the last tab closes", () => {
  const storage = memoryStorage();
  saveRightTabs("/repo-a", { fileTabs: [tab()], activeTabId: "file:/tmp/a.ts" }, storage);
  saveRightTabs("/repo-b", { fileTabs: [tab({ id: "file:/tmp/c.ts", filePath: "/tmp/c.ts" })], activeTabId: "file:/tmp/c.ts" }, storage);

  assert.equal(loadRightTabs("/repo-a", storage).fileTabs.length, 1);
  assert.equal(loadRightTabs("/repo-b", storage).fileTabs[0].filePath, "/tmp/c.ts");

  saveRightTabs("/repo-a", { fileTabs: [], activeTabId: null }, storage);
  assert.equal(loadRightTabs("/repo-a", storage), null);
  assert.equal(loadRightTabs("/repo-b", storage).fileTabs.length, 1);
});

test("survives a hand-edited, half-written payload", () => {
  const storage = memoryStorage({ "pi-web:right-tabs-by-workspace": "{not json" });
  assert.equal(loadRightTabs("/repo", storage), null);
  storage.setItem("pi-web:right-tabs-by-workspace", JSON.stringify({ "/repo": { fileTabs: "oops" } }));
  const sanitized = loadRightTabs("/repo", storage);
  assert.deepEqual(sanitized, { fileTabs: [], activeTabId: null });
});
