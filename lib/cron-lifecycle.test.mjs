import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRunResult,
  isRunLimitReached,
  isTaskExhausted,
  resolveRunTimeoutMs,
  resolveSessionMode,
  sessionDayKey,
  shouldNotifyRun,
  shouldReuseSession,
  DEFAULT_RUN_TIMEOUT_MS,
  MAX_CONSECUTIVE_FAILURES,
  SESSION_REUSE_CONTEXT_LIMIT,
} from "./cron-lifecycle.ts";

test("sessionMode 默认是 new", () => {
  assert.equal(resolveSessionMode({}), "new");
  assert.equal(resolveSessionMode({ sessionMode: "daily" }), "daily");
});

test("daily 只在同一天复用，跨天不复用", () => {
  const now = new Date("2026-09-18T10:00:00Z");
  const today = sessionDayKey(now, "UTC");
  assert.equal(shouldReuseSession("daily", now, { reusableSessionId: "s1", reusableSessionDayKey: today }, "UTC").reuse, true);
  assert.equal(shouldReuseSession("daily", now, { reusableSessionId: "s1", reusableSessionDayKey: "2026-09-17" }, "UTC").reuse, false);
});

test("reuse 模式一直复用，但毕业与上下文已满都不复用", () => {
  const now = new Date("2026-09-18T10:00:00Z");
  assert.equal(shouldReuseSession("reuse", now, { reusableSessionId: "s1" }).reuse, true);
  const graduated = shouldReuseSession("reuse", now, { reusableSessionId: "s1", graduated: true });
  assert.equal(graduated.reuse, false);
  assert.equal(graduated.reason, "graduated");
  const full = shouldReuseSession("reuse", now, { reusableSessionId: "s1", contextRatio: SESSION_REUSE_CONTEXT_LIMIT });
  assert.equal(full.reuse, false);
  assert.equal(full.reason, "context-full");
});

test("new 模式与没有上一个会话时都不复用", () => {
  const now = new Date("2026-09-18T10:00:00Z");
  assert.equal(shouldReuseSession("new", now, { reusableSessionId: "s1" }).reuse, false);
  assert.equal(shouldReuseSession("reuse", now, {}).reuse, false);
});

test("sessionDayKey 按时区计算自然日", () => {
  const instant = new Date("2026-09-18T23:30:00Z");
  assert.equal(sessionDayKey(instant, "UTC"), "2026-09-18");
  assert.equal(sessionDayKey(instant, "Asia/Shanghai"), "2026-09-19");
});

test("maxRuns 上限：未设置永不到达，设置后按 >= 判定", () => {
  assert.equal(isRunLimitReached({ runCount: 99 }), false);
  assert.equal(isRunLimitReached({ maxRuns: 3, runCount: 2 }), false);
  assert.equal(isRunLimitReached({ maxRuns: 3, runCount: 3 }), true);
});

test("已标记完成的任务视为 exhausted（不再调度）", () => {
  assert.equal(isTaskExhausted({ runCount: 1, completedAt: "2026-09-18T00:00:00Z" }), true);
  assert.equal(isTaskExhausted({ runCount: 1 }), false);
});

test("成功运行：计数 +1、失败计数清零", () => {
  const outcome = applyRunResult({ runCount: 4 }, { status: "ok", previousFailures: 3 });
  assert.equal(outcome.runCount, 5);
  assert.equal(outcome.lastStatus, "ok");
  assert.equal(outcome.consecutiveFailures, 0);
  assert.equal(outcome.paused, false);
  assert.equal(outcome.completed, false);
});

test("达到 maxRuns 的成功运行会停用并标完成", () => {
  const outcome = applyRunResult({ runCount: 2, maxRuns: 3 }, { status: "ok", previousFailures: 0 });
  assert.equal(outcome.completed, true);
  assert.equal(outcome.enabled, false);
  assert.ok(outcome.completedAt, "应写入完成时间");
});

test("连续失败到第 5 次才自动暂停", () => {
  const fourth = applyRunResult({ runCount: 0 }, { status: "error", error: "boom", previousFailures: MAX_CONSECUTIVE_FAILURES - 2 });
  assert.equal(fourth.consecutiveFailures, MAX_CONSECUTIVE_FAILURES - 1);
  assert.equal(fourth.paused, false);
  assert.equal(fourth.enabled, undefined, "未到阈值不应改 enabled");

  const fifth = applyRunResult({ runCount: 0 }, { status: "error", error: "boom", previousFailures: MAX_CONSECUTIVE_FAILURES - 1 });
  assert.equal(fifth.consecutiveFailures, MAX_CONSECUTIVE_FAILURES);
  assert.equal(fifth.paused, true);
  assert.equal(fifth.enabled, false);
  assert.match(String(fifth.pausedReason), /自动暂停/);
});

test("失败后再次成功会清零失败计数（不会累积到暂停）", () => {
  const ok = applyRunResult({ runCount: 1 }, { status: "ok", previousFailures: 4 });
  assert.equal(ok.consecutiveFailures, 0);
  assert.equal(ok.paused, false);
});

test("超时上限：任务自定义优先，否则用默认 2 小时", () => {
  assert.equal(resolveRunTimeoutMs({}), DEFAULT_RUN_TIMEOUT_MS);
  assert.equal(resolveRunTimeoutMs({ timeoutMs: 60_000 }), 60_000);
  assert.equal(resolveRunTimeoutMs({ timeoutMs: 0 }), DEFAULT_RUN_TIMEOUT_MS);
});

test("通知策略：默认只在失败时通知", () => {
  assert.equal(shouldNotifyRun({}, "error"), true);
  assert.equal(shouldNotifyRun({}, "ok"), false);
});

test("通知策略四档各自生效", () => {
  assert.equal(shouldNotifyRun({ notify: "never" }, "ok"), false);
  assert.equal(shouldNotifyRun({ notify: "never" }, "error"), false);
  assert.equal(shouldNotifyRun({ notify: "always" }, "ok"), true);
  assert.equal(shouldNotifyRun({ notify: "always" }, "error"), true);
  assert.equal(shouldNotifyRun({ notify: "success" }, "ok"), true);
  assert.equal(shouldNotifyRun({ notify: "success" }, "error"), false);
  assert.equal(shouldNotifyRun({ notify: "error" }, "error"), true);
});
