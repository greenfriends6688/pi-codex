// fork:proma-06-delegation — 子会话阻塞冒泡语义层单测（纯函数）
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dedupeBubbles,
  shouldBubbleUiRequest,
  toSubagentUiBubble,
  toSubagentUiResponse,
  withoutBubble,
} from "./subagent-ui-bridge.ts";

const selectRequest = {
  type: "extension_ui_request",
  id: "req-1",
  method: "select",
  title: "⚠️ 危险命令",
  options: ["允许一次", "本次会话总是允许", "拒绝"],
};

test("等人回答的请求才冒泡（select/confirm/input/editor/custom）", () => {
  for (const method of ["select", "confirm", "input", "editor", "custom"]) {
    assert.equal(shouldBubbleUiRequest({ type: "extension_ui_request", id: "x", method }), true, method);
  }
});

test("通知性质的不冒泡（否则父会话被刷屏）", () => {
  for (const method of ["notify", "setStatus", "setWidget"]) {
    assert.equal(shouldBubbleUiRequest({ type: "extension_ui_request", id: "x", method }), false, method);
  }
});

test("不是 UI 请求 / 没有 id 的不冒泡", () => {
  assert.equal(shouldBubbleUiRequest({ type: "message_end", id: "x", method: "select" }), false);
  assert.equal(shouldBubbleUiRequest({ type: "extension_ui_request", id: "", method: "select" }), false);
  assert.equal(shouldBubbleUiRequest({ type: "extension_ui_request", method: "select" }), false);
  assert.equal(shouldBubbleUiRequest(null), false);
});

test("整形出来的冒泡事件带上子会话 id 与展示名，原请求原样保留", () => {
  const bubble = toSubagentUiBubble(selectRequest, {
    subagentSessionId: "child-1",
    parentSessionId: "parent-1",
    label: "  general-purpose   探索方案  ",
  });
  assert.equal(bubble?.type, "subagent_ui_request");
  assert.equal(bubble?.subagentSessionId, "child-1");
  assert.equal(bubble?.parentSessionId, "parent-1");
  assert.equal(bubble?.requestId, "req-1");
  assert.equal(bubble?.method, "select");
  assert.equal(bubble?.title, "⚠️ 危险命令");
  assert.equal(bubble?.label, "general-purpose 探索方案", "展示名要压平空白");
  assert.deepEqual(bubble?.request, selectRequest, "原请求要原样带上（客户端复用既有对话框）");
  assert.equal(toSubagentUiBubble({ type: "extension_ui_request", id: "x", method: "notify" }, {
    subagentSessionId: "c", parentSessionId: "p",
  }), null);
});

test("作答回执发去**子会话**（发错到父会话 = 子会话永远挂着）", () => {
  const bubble = toSubagentUiBubble(selectRequest, { subagentSessionId: "child-1", parentSessionId: "parent-1" });
  assert.ok(bubble);
  const answer = toSubagentUiResponse(bubble, { value: "允许一次" });
  assert.equal(answer.sessionId, "child-1");
  assert.deepEqual(answer.command, { type: "extension_ui_response", id: "req-1", value: "允许一次" });
  assert.deepEqual(toSubagentUiResponse(bubble).command, { type: "extension_ui_response", id: "req-1" });
});

test("同一个 requestId 只留一条；答完能摘掉", () => {
  const one = toSubagentUiBubble(selectRequest, { subagentSessionId: "child-1", parentSessionId: "parent-1" });
  const dup = toSubagentUiBubble(selectRequest, { subagentSessionId: "child-1", parentSessionId: "parent-1" });
  const other = toSubagentUiBubble({ ...selectRequest, id: "req-2" }, { subagentSessionId: "child-2", parentSessionId: "parent-1" });
  assert.ok(one && dup && other);
  assert.deepEqual(dedupeBubbles([one, dup, other]).map((b) => b.requestId), ["req-1", "req-2"]);
  assert.deepEqual(withoutBubble([one, other], "req-1").map((b) => b.requestId), ["req-2"]);
});
