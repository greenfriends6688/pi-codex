// fork:zc-07 — 词级行内 diff 的纯函数测试。
// 覆盖：纯插入 / 纯删除 / 空行 / 全角中文按字匹配 / 超长行回退（守护闸而非计时）/
// 区间渲染与合并。
import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./diff-intraline.ts");
}

test("marks only the inserted token on the right side", async () => {
  const { diffIntraline } = await loadSubject();
  const pair = diffIntraline("const value = old;", "const value = new;");
  assert.deepEqual(pair, {
    left: [{ start: 14, end: 17 }],
    right: [{ start: 14, end: 17 }],
  });
});

test("pure insertion leaves the left side unchanged", async () => {
  const { diffIntraline } = await loadSubject();
  const pair = diffIntraline("hello world", "hello brave world");
  assert.deepEqual(pair, {
    left: [],
    // 公共后缀按标准的不重叠裁剪：右侧中段是 "brave "（单词后那个空格也变了）。
    right: [{ start: 6, end: 12 }],
  });
});

test("pure deletion leaves the right side unchanged", async () => {
  const { diffIntraline } = await loadSubject();
  const pair = diffIntraline("hello brave world", "hello world");
  assert.deepEqual(pair, {
    left: [{ start: 6, end: 12 }],
    right: [],
  });
});

test("identical lines and empty lines produce no spans", async () => {
  const { diffIntraline, buildIntralineSegments } = await loadSubject();
  assert.deepEqual(diffIntraline("same", "same"), { left: [], right: [] });

  const insertingIntoEmpty = diffIntraline("", "added");
  assert.deepEqual(insertingIntoEmpty, { left: [], right: [{ start: 0, end: 5 }] });
  const removingToEmpty = diffIntraline("removed", "");
  assert.deepEqual(removingToEmpty, { left: [{ start: 0, end: 7 }], right: [] });
  assert.deepEqual(buildIntralineSegments("", null), [{ text: "", changed: true }]);
});

test("matches full-width CJK per character instead of per word", async () => {
  const { diffIntraline, buildIntralineSegments } = await loadSubject();
  // "提交前/提交后" share three characters; only the fourth differs.
  const pair = diffIntraline("提交前的状态", "提交后的状态");
  assert.deepEqual(pair, {
    left: [{ start: 2, end: 3 }],
    right: [{ start: 2, end: 3 }],
  });
  assert.deepEqual(buildIntralineSegments("提交前的状态", pair.left), [
    { text: "提交", changed: false },
    { text: "前", changed: true },
    { text: "的状态", changed: false },
  ]);

  // A fully rewritten CJK line still reports both sides (no whitespace tokens).
  const rewritten = diffIntraline("一二三四", "五六七八");
  assert.deepEqual(rewritten, {
    left: [{ start: 0, end: 4 }],
    right: [{ start: 0, end: 4 }],
  });
});

test("falls back to whole-line highlighting when the changed middle exceeds MAX_LEN", async () => {
  const { diffIntraline, buildIntralineSegments, MAX_INTRALINE_LINE_LENGTH } = await loadSubject();
  assert.equal(MAX_INTRALINE_LINE_LENGTH, 500);

  const longLeft = "x".repeat(MAX_INTRALINE_LINE_LENGTH + 1);
  const longRight = "y".repeat(MAX_INTRALINE_LINE_LENGTH + 1);
  assert.equal(diffIntraline(longLeft, longRight), null);

  // The guard is decided by the trimmed middle, not the raw line: a long line
  // with a tiny local change stays under the limit and still gets word spans.
  const mostlyShared = diffIntraline(`${longLeft}A`, `${longLeft}B`);
  assert.deepEqual(mostlyShared, {
    left: [{ start: longLeft.length, end: longLeft.length + 1 }],
    right: [{ start: longLeft.length, end: longLeft.length + 1 }],
  });

  // The fallback signal is what the renderer turns into a whole-line mark.
  assert.deepEqual(buildIntralineSegments("whole line", null), [{ text: "whole line", changed: true }]);
});

test("returns null immediately for very large inputs instead of timing the machine", async () => {
  const { diffIntraline, MAX_INTRALINE_LINE_LENGTH } = await loadSubject();
  // 200k chars on each side: without the guard this would allocate a
  // 40-billion-cell LCS table. The assertion is the sentinel, not wall time.
  const hugeLeft = "a".repeat(200_000);
  const hugeRight = "b".repeat(200_000);
  assert.ok(hugeLeft.length > MAX_INTRALINE_LINE_LENGTH * 100);
  assert.equal(diffIntraline(hugeLeft, hugeRight), null);
});

test("segments clamp, merge and preserve surrogate pairs", async () => {
  const { buildIntralineSegments } = await loadSubject();
  assert.deepEqual(buildIntralineSegments("abcdef", [
    { start: 1, end: 3 },
    { start: 3, end: 4 },
    { start: 20, end: 30 },
  ]), [
    { text: "a", changed: false },
    { text: "bcd", changed: true },
    { text: "ef", changed: false },
  ]);

  // 😀 is two UTF-16 units; spans computed by diffIntraline must not split it.
  const { diffIntraline } = await loadSubject();
  const pair = diffIntraline("a😀b", "a😀c");
  assert.deepEqual(pair?.right, [{ start: 3, end: 4 }]);
  assert.deepEqual(buildIntralineSegments("a😀c", pair.right), [
    { text: "a😀", changed: false },
    { text: "c", changed: true },
  ]);
});
