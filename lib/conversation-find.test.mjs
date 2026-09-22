import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./conversation-find.ts");
}

/** Minimal transcript builder so each test states only what it cares about. */
function user(content) {
  return { role: "user", content };
}

function assistant(content) {
  return { role: "assistant", content, model: "test", provider: "test" };
}

function toolResult(toolCallId, content) {
  return { role: "toolResult", toolCallId, content };
}

test("an empty or whitespace-only query matches nothing", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();
  const index = buildSearchIndex([user("hello"), user("   ")]);

  assert.deepEqual(findHits(index, ""), { hits: [], truncated: false });
  assert.deepEqual(findHits(index, "   "), { hits: [], truncated: false });
});

test("matches CJK text without word boundaries", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();
  const index = buildSearchIndex([
    user("请在会话内查找这一段中文"),
    assistant([{ type: "text", text: "查找功能已经实现，可以查找多次。" }]),
  ]);

  const result = findHits(index, "查找");
  assert.equal(result.hits.length, 3);
  assert.deepEqual(
    result.hits.map((hit) => hit.field),
    ["userText", "assistantText", "assistantText"],
  );
  // Offsets point at the character positions inside each segment.
  assert.equal(result.hits[0].start, "请在会话内".length);
  assert.equal(result.hits[0].end, "请在会话内查找".length);
});

test("is case-insensitive by default and case-sensitive on request", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();
  const index = buildSearchIndex([user("Hello world, HELLO again")]);

  assert.equal(findHits(index, "hello").hits.length, 2);
  assert.equal(findHits(index, "HELLO").hits.length, 2);
  assert.equal(findHits(index, "hello", { caseSensitive: true }).hits.length, 0);
  assert.equal(findHits(index, "Hello", { caseSensitive: true }).hits.length, 1);
});

test("counts hits across multiple messages and preserves document order", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();
  const index = buildSearchIndex(
    [
      user("alpha one"),
      assistant([
        { type: "thinking", thinking: "alpha inside thinking" },
        { type: "text", text: "alpha answer" },
        { type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "alpha.txt" } },
      ]),
      toolResult("call-1", [{ type: "text", text: "alpha tool output" }]),
      user("plain message"),
    ],
    ["e1", "e2", "e3", "e4"],
  );

  const result = findHits(index, "alpha");
  assert.equal(result.hits.length, 5);
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.hits.map((hit) => [hit.entryId, hit.field]),
    [
      ["e1", "userText"],
      ["e2", "thinking"],
      ["e2", "assistantText"],
      ["e2", "toolInput"],
      ["e2", "toolResult"],
    ],
  );
});

test("attaches tool results to the entry that owns their tool call", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();
  const index = buildSearchIndex(
    [
      assistant([{ type: "toolCall", toolCallId: "call-1", toolName: "bash", input: { command: "echo unique-token" } }]),
      toolResult("call-1", [{ type: "text", text: "unique-token output" }]),
    ],
    ["assistant-entry", "result-entry"],
  );

  const hits = findHits(index, "unique-token").hits;
  assert.deepEqual(hits.map((hit) => hit.entryId), ["assistant-entry", "assistant-entry"]);
});

test("overlapping occurrences are only counted once", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();

  const aaa = findHits(buildSearchIndex([user("aaa")]), "aa");
  assert.equal(aaa.hits.length, 1);
  assert.equal(aaa.hits[0].start, 0);
  assert.equal(aaa.hits[0].end, 2);

  const abababa = findHits(buildSearchIndex([user("abababa")]), "aba");
  assert.deepEqual(abababa.hits.map((hit) => hit.start), [0, 4]);
});

test("caps the hit list and reports truncation", async () => {
  const { buildSearchIndex, findHits, CONVERSATION_FIND_MAX_HITS } = await loadSubject();
  const index = buildSearchIndex([user("x".repeat(CONVERSATION_FIND_MAX_HITS + 50))]);

  const result = findHits(index, "x");
  assert.equal(result.hits.length, CONVERSATION_FIND_MAX_HITS);
  assert.equal(result.truncated, true);

  const limited = findHits(index, "x", { limit: 3 });
  assert.equal(limited.hits.length, 3);
  assert.equal(limited.truncated, true);

  // Exactly at the cap the result is still marked partial: callers must not
  // silently present a possibly-incomplete list as complete.
  const exact = findHits(buildSearchIndex([user("abcd")]), "a", { limit: 1 });
  assert.equal(exact.hits.length, 1);
  assert.equal(exact.truncated, true);
});

test("clips oversized segments and reports it on the index", async () => {
  const { buildSearchIndex, findHits, CONVERSATION_FIND_MAX_SEGMENT_CHARS } = await loadSubject();
  const tail = "needle-after-the-clip";
  const huge = "y".repeat(CONVERSATION_FIND_MAX_SEGMENT_CHARS) + tail;
  const index = buildSearchIndex([user(huge)]);

  assert.equal(index.truncated, true);
  assert.equal(index.segments[0].text.length, CONVERSATION_FIND_MAX_SEGMENT_CHARS);

  const result = findHits(index, tail);
  assert.equal(result.hits.length, 0);
  assert.equal(result.truncated, true);
});

test("builds snippets with collapsed whitespace and ellipses", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();
  const index = buildSearchIndex([user("0123456789 needle\t0123456789")]);

  const hit = findHits(index, "needle").hits[0];
  assert.equal(hit.snippet, "0123456789 needle 0123456789");

  const long = findHits(buildSearchIndex([user(`${"x".repeat(40)} needle`)]), "needle").hits[0];
  assert.equal(long.snippet, `…${"x".repeat(31)} needle`);
  const suffix = findHits(buildSearchIndex([user(`needle${"y".repeat(40)}`)]), "needle").hits[0];
  assert.equal(suffix.snippet, `needle${"y".repeat(32)}…`);
});

test("nextHitIndex wraps around in both directions", async () => {
  const { nextHitIndex } = await loadSubject();

  assert.equal(nextHitIndex(0, 3, 1), 1);
  assert.equal(nextHitIndex(1, 3, 1), 2);
  assert.equal(nextHitIndex(2, 3, 1), 0);

  assert.equal(nextHitIndex(0, 3, -1), 2);
  assert.equal(nextHitIndex(2, 3, -1), 1);
  assert.equal(nextHitIndex(1, 3, -1), 0);

  // Out-of-range start: next begins at zero, previous begins at the last hit.
  assert.equal(nextHitIndex(-1, 3, 1), 0);
  assert.equal(nextHitIndex(-1, 3, -1), 2);
  assert.equal(nextHitIndex(99, 3, 1), 0);

  // A single hit wraps onto itself instead of escaping the range.
  assert.equal(nextHitIndex(0, 1, 1), 0);
  assert.equal(nextHitIndex(0, 1, -1), 0);

  // No hits at all.
  assert.equal(nextHitIndex(0, 0, 1), -1);
  assert.equal(nextHitIndex(-1, 0, -1), -1);
});

test("hit keys stay stable when an older page is prepended", async () => {
  const { buildSearchIndex, findHits, conversationFindHitKey } = await loadSubject();
  const newer = assistant([{ type: "text", text: "target hit" }]);

  const before = findHits(buildSearchIndex([newer], ["e-new"]), "target");
  const after = findHits(
    buildSearchIndex([user("older target message"), newer], ["e-old", "e-new"]),
    "target",
  );

  const key = conversationFindHitKey(before.hits[0]);
  assert.equal(after.hits.findIndex((hit) => conversationFindHitKey(hit) === key), 1);
  assert.equal(conversationFindHitKey(null), null);
});

// ---------------------------------------------------------------------------
// fork:zc-02 — blockIndex 的契约。
//
// 这是「跳到命中时能不能展开到那个块」的唯一依据：ChatWindow 用
// `messages[entryId].content[blockIndex]` 取出块并交给既有的 reveal 通路。
// 之前没有这几条断言，于是 toolResult 用了结果消息自己的 partIndex，
// 取到的块与命中无关 —— 表现是工具结果类命中永远不会高亮、也不会展开。
// ---------------------------------------------------------------------------

test("a hit carries the block index of its own block", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();
  const index = buildSearchIndex([
    assistant([
      { type: "text", text: "前言" },
      { type: "thinking", thinking: "推理里出现 needles" },
      { type: "text", text: "结论里也出现 needles" },
    ]),
  ]);

  const hits = findHits(index, "needles").hits;
  assert.deepEqual(
    hits.map((hit) => [hit.field, hit.blockIndex]),
    [["thinking", 1], ["assistantText", 2]],
    "每个命中指向它自己所在的块",
  );
});

test("a tool-result hit points at the toolCall block that owns it", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();
  const index = buildSearchIndex(
    [
      assistant([
        { type: "text", text: "先跑两个命令" },
        { type: "toolCall", toolCallId: "call-a", toolName: "bash", input: { command: "ls" } },
        { type: "toolCall", toolCallId: "call-b", toolName: "bash", input: { command: "pwd" } },
      ]),
      toolResult("call-a", "第一个结果 needles"),
      // 结果正文是多段时，每一段仍属于**同一个** toolCall 块。
      toolResult("call-b", [
        { type: "text", text: "第一段" },
        { type: "text", text: "第二段 needles" },
      ]),
    ],
    ["e0", "e1", "e2"],
  );

  const hits = findHits(index, "needles").hits.filter((hit) => hit.field === "toolResult");
  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((hit) => [hit.entryId, hit.blockIndex]),
    [["e0", 1], ["e0", 2]],
    "两个结果分别指回 e0 里第 1 / 第 2 个 toolCall 块，而不是结果消息自己的 part 下标",
  );
});

test("a tool-result hit without an owning call degrades to block 0 on its own entry", async () => {
  const { buildSearchIndex, findHits } = await loadSubject();
  const index = buildSearchIndex([toolResult(undefined, "孤儿结果 needles")], ["e9"]);

  const [hit] = findHits(index, "needles").hits;
  assert.equal(hit.entryId, "e9", "找不到 owner 时留在自己的 entry 上");
  assert.equal(hit.blockIndex, 0, "退化成第 0 块，而不是 undefined/NaN");
});
