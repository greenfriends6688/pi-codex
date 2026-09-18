/**
 * lib/perf-monitor.test.mjs 对应的被测模块见 ./perf-monitor.ts。
 * 中文注释：性能探测单测——Node 里无 window，必须安全降级；
 * 用临时 fake window 验证 ?perf=1 激活路径，用完即删。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { initPerfMonitor, getPerfSnapshot, resetPerfSnapshot } = await jiti.import("./perf-monitor.ts");

function setFakeSearch(search) {
  globalThis.window = { location: { search } };
}

function clearFakeWindow() {
  delete globalThis.window;
  initPerfMonitor(); // 把模块状态复位回未激活
}

test("无 window 时安全降级：init 返回 noop，快照全零且不抛异常", () => {
  assert.equal(typeof globalThis.window, "undefined");
  const cleanup = initPerfMonitor();
  assert.equal(typeof cleanup, "function");
  cleanup(); // noop 可安全调用
  const snapshot = getPerfSnapshot();
  assert.deepEqual(snapshot, { active: false, longTasks: 0, totalBlockedMs: 0, maxTaskMs: 0 });
});

test("不带 ?perf=1 时不激活", () => {
  try {
    setFakeSearch("?foo=bar");
    const cleanup = initPerfMonitor();
    assert.equal(getPerfSnapshot().active, false);
    cleanup();
  } finally {
    clearFakeWindow();
  }
});

test("?perf=1 时激活，快照字段合法", () => {
  try {
    setFakeSearch("?perf=1");
    const cleanup = initPerfMonitor();
    const snapshot = getPerfSnapshot();
    assert.equal(snapshot.active, true);
    assert.equal(snapshot.longTasks, 0);
    assert.equal(snapshot.totalBlockedMs, 0);
    assert.equal(snapshot.maxTaskMs, 0);
    // 内存字段只能是“缺席”或“合法数字”，不能是 NaN/负数。
    if (snapshot.memoryUsedMB !== undefined) {
      assert.ok(Number.isFinite(snapshot.memoryUsedMB) && snapshot.memoryUsedMB >= 0);
    }
    resetPerfSnapshot();
    assert.equal(getPerfSnapshot().longTasks, 0);
    assert.equal(typeof cleanup, "function");
    cleanup();
  } finally {
    clearFakeWindow();
  }
});

test("init 幂等：重复调用不叠加", () => {
  try {
    setFakeSearch("?perf=1");
    initPerfMonitor();
    initPerfMonitor();
    assert.equal(getPerfSnapshot().active, true);
  } finally {
    clearFakeWindow();
  }
  assert.equal(getPerfSnapshot().active, false);
});
