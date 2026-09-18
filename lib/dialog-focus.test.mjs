import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOCUSABLE_SELECTOR,
  isDialogCloseKey,
  isFocusableCandidate,
  isTabKey,
  nextFocusIndex,
} from "./dialog-focus.ts";

test("Tab 前进/后退都环绕", () => {
  assert.equal(nextFocusIndex(0, 3, false), 1);
  assert.equal(nextFocusIndex(2, 3, false), 0, "最后一个 → 第一个");
  assert.equal(nextFocusIndex(0, 3, true), 2, "第一个 → 最后一个");
  assert.equal(nextFocusIndex(1, 3, true), 0);
});

test("焦点不在候选项上时前进从 0 开始、后退从末尾开始", () => {
  assert.equal(nextFocusIndex(-1, 3, false), 0);
  assert.equal(nextFocusIndex(-1, 3, true), 2);
  assert.equal(nextFocusIndex(9, 3, false), 0);
});

test("没有候选项时返回 -1（调用方据此不拦截 Tab）", () => {
  assert.equal(nextFocusIndex(0, 0, false), -1);
  assert.equal(nextFocusIndex(-1, 0, true), -1);
});

test("disabled 元素不进 Tab 循环", () => {
  assert.equal(isFocusableCandidate({ disabled: true }), false);
  assert.equal(isFocusableCandidate({}), true);
});

test("显式 tabindex=-1 排除，tabindex=0/正数保留", () => {
  assert.equal(isFocusableCandidate({ tabIndex: -1 }), false);
  assert.equal(isFocusableCandidate({ tabIndex: 0 }), true);
  assert.equal(isFocusableCandidate({ tabIndex: 3 }), true);
});

test("aria-hidden / hidden / 不可见一律排除（浏览器仍会聚焦 aria-hidden）", () => {
  assert.equal(isFocusableCandidate({ hidden: true }), false);
  assert.equal(isFocusableCandidate({ invisible: true }), false);
});

test("关闭键只有 Escape", () => {
  assert.equal(isDialogCloseKey("Escape"), true);
  assert.equal(isDialogCloseKey("Esc"), false);
  assert.equal(isDialogCloseKey("Enter"), false);
});

test("Tab 判定排除带修饰键的组合", () => {
  assert.equal(isTabKey({ key: "Tab" }), true);
  assert.equal(isTabKey({ key: "Tab", ctrlKey: true }), false);
  assert.equal(isTabKey({ key: "Tab", metaKey: true }), false);
  assert.equal(isTabKey({ key: "Tab", altKey: true }), false);
  assert.equal(isTabKey({ key: "Enter" }), false);
});

test("选择器覆盖常见可聚焦元素且排除 tabindex=-1", () => {
  for (const piece of ["a[href]", "button:not([disabled])", "input:not([disabled])", "textarea:not([disabled])", "summary"]) {
    assert.ok(FOCUSABLE_SELECTOR.includes(piece), `选择器应包含 ${piece}`);
  }
  assert.ok(FOCUSABLE_SELECTOR.includes("[tabindex]:not([tabindex='-1'])"));
});
