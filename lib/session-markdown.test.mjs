import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { MARKDOWN_TOOL_RESULT_MAX_CHARS, sessionToMarkdown } = await jiti.import("@/lib/session-markdown");

const header = { type: "session", version: 3, id: "abc123", timestamp: "2026-09-17T00:00:00.000Z", cwd: "/repo" };
const entry = (id, parentId, message) => ({ type: "message", id, parentId, timestamp: "2026-09-17T00:00:01.000Z", message });

/*
 * fork:ui-18 — the point of this export is a *document*, not a dump: tool calls
 * collapse to one line, results are clipped, thinking is dropped.
 */
test("documents user and assistant text with tool calls as one-liners", () => {
  const md = sessionToMarkdown(header, [
    entry("m1", null, { role: "user", content: "帮我加个测试" }),
    entry("m2", "m1", { role: "assistant", content: [
      { type: "thinking", thinking: "should not appear" },
      { type: "text", text: "先看一下现有测试。" },
      { type: "toolCall", id: "c1", name: "bash", arguments: { command: "npm test -- --reporter=dot" } },
    ] }),
    entry("m3", "m2", { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "42 passing" }] }),
  ]);

  assert.match(md, /^# Session abc123/);
  assert.match(md, /- \*\*cwd\*\*: `\/repo`/);
  assert.match(md, /## User\n\n帮我加个测试/);
  assert.match(md, /## Assistant\n\n先看一下现有测试。\n\n- `bash` — npm test -- --reporter=dot/);
  assert.match(md, /<summary>bash result<\/summary>/);
  assert.match(md, /42 passing/);
  assert.doesNotMatch(md, /should not appear/, "thinking is not part of the conversation");
});

test("long tool results are clipped, and empty sections are skipped", () => {
  const long = "x".repeat(MARKDOWN_TOOL_RESULT_MAX_CHARS + 500);
  const md = sessionToMarkdown(header, [
    entry("m1", null, { role: "assistant", content: [{ type: "thinking", thinking: "only thinking" }] }),
    entry("m2", "m1", { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: long }] }),
  ]);
  assert.doesNotMatch(md, /## Assistant/, "a message with only thinking produces no section");
  assert.ok(md.includes("x".repeat(MARKDOWN_TOOL_RESULT_MAX_CHARS) + "…"), "the result is clipped with an ellipsis");
  assert.ok(!md.includes("x".repeat(MARKDOWN_TOOL_RESULT_MAX_CHARS + 1)), "nothing beyond the cap survives");
});

test("non-message entries and a missing header are tolerated", () => {
  const md = sessionToMarkdown(null, [
    { type: "model_change", id: "x", parentId: null, timestamp: "t", provider: "p", modelId: "m" },
    entry("m1", null, { role: "user", content: [{ type: "text", text: "hi" }] }),
  ]);
  assert.match(md, /^# Session\n/);
  assert.match(md, /## User\n\nhi/);
});
