/**
 * lib/time-group-state.test.mjs 对应的被测模块见 ./time-group-state.ts。
 * 中文注释：钉住折叠状态默认值（earlier 折叠）、持久化 key 与脏数据兜底。
 */
import assert from "node:assert/strict";
import test from "node:test";

const STORAGE_KEY = "pi-collapsed-time-groups";
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
  },
};

const { loadCollapsedTimeGroups, saveCollapsedTimeGroups } = await import("./time-group-state.ts");

test("only earlier starts collapsed", () => {
  storage.clear();
  assert.deepEqual(loadCollapsedTimeGroups(), {
    pinned: false,
    today: false,
    yesterday: false,
    week: false,
    month: false,
    earlier: true,
  });
});

test("persists collapse state under the agreed storage key", () => {
  storage.clear();
  const next = { ...loadCollapsedTimeGroups(), earlier: false, today: true };
  saveCollapsedTimeGroups(next);
  assert.ok(storage.has(STORAGE_KEY), "uses pi-collapsed-time-groups");
  assert.deepEqual(loadCollapsedTimeGroups(), next);
});

test("malformed and partial payloads fall back to defaults per bucket", () => {
  storage.set(STORAGE_KEY, "not json");
  assert.equal(loadCollapsedTimeGroups().earlier, true);

  storage.set(STORAGE_KEY, JSON.stringify({ today: true, earlier: "yes" }));
  const partial = loadCollapsedTimeGroups();
  assert.equal(partial.today, true);
  assert.equal(partial.earlier, true, "non-boolean value keeps the default");
  assert.equal(partial.week, false);
});
