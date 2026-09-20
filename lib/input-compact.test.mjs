import assert from "node:assert/strict";
import test from "node:test";

import {
  scrollRemaining,
  nextInputCompactState,
  COMPACT_COLLAPSE_TRIGGER,
  COMPACT_RESTORE_TRIGGER,
} from "./input-compact.ts";

test("scrollRemaining reports the raw distance below the viewport", () => {
  assert.equal(scrollRemaining({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 }), 0);
  assert.equal(scrollRemaining({ scrollHeight: 1000, scrollTop: 891, clientHeight: 100 }), 9);
  // 内容短于容器 → 负值（永远不会因为内容不满而塌陷）。
  assert.equal(scrollRemaining({ scrollHeight: 100, scrollTop: 0, clientHeight: 200 }), -100);
});

test("reaching the bottom restores only while actively scrolling down", () => {
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: 0, direction: "down", userIntent: true }), false);
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: 5, direction: "down", userIntent: false }), false);
  // 恰好等于恢复阈值也算到底。
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: COMPACT_RESTORE_TRIGGER, direction: "down", userIntent: true }), false);
});

test("an upward or directionless scroll at the bottom never restores", () => {
  // 塌陷让阅读区变大，浏览器把视口夹回底部；ResizeObserver 又用 "none" 复算 ——
  // 这些都不能展开输入框，否则每次离开底部都会闪烁/振荡。
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: 0, direction: "up", userIntent: true }), true);
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: 0, direction: "none", userIntent: true }), true);
});

test("just above the restore trigger is not the bottom anymore", () => {
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: COMPACT_RESTORE_TRIGGER + 1, direction: "up", userIntent: true }), true);
});

test("collapsing requires a real upward user scroll far above the bottom", () => {
  const far = COMPACT_COLLAPSE_TRIGGER + 1;
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "up", userIntent: true }), true);
  // 离底太近：塌陷会把视口拉回底部。
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: 40, direction: "up", userIntent: true }), false);
  // 程序化滚动绝不能触发塌陷。
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "up", userIntent: false }), false);
  // 方向不对 / 没方向也绝不能触发。
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "down", userIntent: true }), false);
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "none", userIntent: true }), false);
});

test("collapse-induced clamp does not oscillate the state", () => {
  // 收起后浏览器向下夹回底部（delta 为负 → direction "up"），随后 ResizeObserver
  // 以 "none" 复算：两步都必须维持「已收起」，否则会来回翻转。
  let state = nextInputCompactState(false, { kind: "scroll", remaining: 400, direction: "up", userIntent: true });
  assert.equal(state, true);
  state = nextInputCompactState(state, { kind: "scroll", remaining: 0, direction: "up", userIntent: false });
  assert.equal(state, true);
  state = nextInputCompactState(state, { kind: "scroll", remaining: 0, direction: "none", userIntent: false });
  assert.equal(state, true);
  // 用户真正向下滚回底部附近才恢复。
  state = nextInputCompactState(state, { kind: "scroll", remaining: 0, direction: "down", userIntent: true });
  assert.equal(state, false);
});

test("staying above the bottom keeps the state", () => {
  const far = COMPACT_COLLAPSE_TRIGGER + 50;
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: far, direction: "up", userIntent: true }), true);
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "up", userIntent: true }), true);
});

test("focus always expands", () => {
  assert.equal(nextInputCompactState(true, { kind: "focus" }), false);
  assert.equal(nextInputCompactState(false, { kind: "focus" }), false);
});
