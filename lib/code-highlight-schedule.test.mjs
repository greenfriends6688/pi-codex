import assert from "node:assert/strict";
import { test } from "node:test";
import {
  highlightBudgetMs,
  countLines,
  shouldHighlightCode,
  MAX_HIGHLIGHT_CHARS,
  MAX_HIGHLIGHT_LINES,
  MAX_HIGHLIGHT_BUDGET_MS,
  IMMEDIATE_HIGHLIGHT_CHARS,
} from "./code-highlight-schedule.ts";

test("countLines 按换行符计数", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("a"), 1);
  assert.equal(countLines("a\nb"), 2);
  assert.equal(countLines("a\nb\n"), 3);
});

test("便宜块立即上高亮（预算 0）", () => {
  const code = "const a = 1;\nconst b = 2;\n";
  assert.equal(shouldHighlightCode(code), true);
  assert.equal(highlightBudgetMs(code), 0);
});

test("空块与纯空白块不高亮", () => {
  assert.equal(shouldHighlightCode(""), false);
  assert.equal(shouldHighlightCode("   \n\t\n"), false);
});

test("超过字符上限的块不高亮", () => {
  const code = "x".repeat(MAX_HIGHLIGHT_CHARS + 1);
  assert.equal(shouldHighlightCode(code), false);
});

test("超过行数上限的块不高亮", () => {
  const code = Array.from({ length: MAX_HIGHLIGHT_LINES + 1 }, () => "x").join("\n");
  assert.equal(shouldHighlightCode(code), false);
});

test("刚好等于上限仍然高亮（边界闭合）", () => {
  const code = "x".repeat(MAX_HIGHLIGHT_CHARS);
  assert.equal(shouldHighlightCode(code), true);
});

test("预算随长度单调不减，且不超过上限", () => {
  const small = "x".repeat(IMMEDIATE_HIGHLIGHT_CHARS);
  const mid = "x".repeat(Math.round((IMMEDIATE_HIGHLIGHT_CHARS + MAX_HIGHLIGHT_CHARS) / 2));
  const large = "x".repeat(MAX_HIGHLIGHT_CHARS);
  assert.equal(highlightBudgetMs(small), 0);
  assert.ok(highlightBudgetMs(mid) > 0, "中场块应拿到非零预算");
  assert.ok(highlightBudgetMs(large) >= highlightBudgetMs(mid), "更长的块预算不小于中场块");
  assert.ok(highlightBudgetMs(large) <= MAX_HIGHLIGHT_BUDGET_MS, "预算不超过上限");
  assert.equal(highlightBudgetMs(large), MAX_HIGHLIGHT_BUDGET_MS);
});
