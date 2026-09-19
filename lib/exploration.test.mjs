// fork:proma-05-explore — 探索分支语义层单测（纯函数，不碰 DOM）
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveExplorationOrigin,
  explorationDelta,
  labelFromText,
  messageText,
  planBringBack,
} from "./exploration.ts";

const text = (...parts) => parts.map((part) => ({ type: "text", text: part }));
const assistant = (...parts) => ({ role: "assistant", content: text(...parts) });
const user = (value) => ({ role: "user", content: value });

test("messageText 只取文本块，忽略 thinking / toolCall", () => {
  assert.equal(messageText({ role: "assistant", content: [
    { type: "thinking", thinking: "想" },
    { type: "text", text: "答案" },
    { type: "toolCall", name: "read", arguments: {} },
  ] }), "答案");
  assert.equal(messageText(user("字符串内容")), "字符串内容");
  assert.equal(messageText(undefined), "");
  assert.equal(messageText({ role: "assistant", content: [{ type: "image" }] }), "");
});

test("labelFromText 压平空白、超长截断，空文本给空串", () => {
  assert.equal(labelFromText("  第一行\n第二行  "), "第一行 第二行");
  assert.equal(labelFromText(""), "");
  assert.equal(labelFromText("x".repeat(100), 10), "xxxxxxxxx…");
});

test("deriveExplorationOrigin：公共前缀结束处就是 fork 点之前那条", () => {
  const origin = deriveExplorationOrigin({
    parentSessionId: "p1",
    parentEntryIds: ["a", "b", "c", "d"],
    parentMessages: [user("第一条"), user("第二条"), user("第三条"), user("第四条")],
    branchEntryIds: ["a", "b", "x1"],
  });
  assert.deepEqual(origin, {
    parentSessionId: "p1",
    boundaryEntryId: "b",
    sourceEntryId: "c",            // 父会话里紧随边界的那条 = 被 fork 的消息
    sourceLabel: "第三条",
  });
});

test("deriveExplorationOrigin：分支跑出新条目后不再往后匹配", () => {
  const origin = deriveExplorationOrigin({
    parentSessionId: "p1",
    parentEntryIds: ["a", "b", "c"],
    parentMessages: [user("一"), user("二"), user("三")],
    // x1 是分支自己的新条目；即使它后面的 id 又撞上父会话的 id 也不算共有
    branchEntryIds: ["a", "b", "x1", "c"],
  });
  assert.equal(origin?.boundaryEntryId, "b");
});

test("deriveExplorationOrigin：没有共有条目 → null（subagent 会话不能误判成探索）", () => {
  assert.equal(deriveExplorationOrigin({
    parentSessionId: "p1",
    parentEntryIds: ["a", "b"],
    parentMessages: [user("一"), user("二")],
    branchEntryIds: ["z1", "z2"],
  }), null);
});

test("deriveExplorationOrigin：fork 在第一条消息之后 → sourceLabel 为空而不是 undefined", () => {
  const origin = deriveExplorationOrigin({
    parentSessionId: "p1",
    parentEntryIds: ["a"],
    parentMessages: [user("只有一条")],
    branchEntryIds: ["a", "n1"],
  });
  assert.equal(origin?.sourceEntryId, null);
  assert.equal(origin?.sourceLabel, "");
});

test("explorationDelta：只取 fork 点之后的 assistant 文本", () => {
  const delta = explorationDelta({
    branchEntryIds: ["a", "b", "n1", "n2", "n3"],
    branchMessages: [
      user("pre-fork 用户"),
      assistant("pre-fork 结论"),
      user("分支上的提问"),
      assistant("分支结论一", "续行"),
      assistant("分支结论二"),
    ],
    boundaryEntryId: "b",
  });
  assert.equal(delta.text, "分支结论一\n续行\n\n分支结论二");
  assert.equal(delta.assistantMessages, 2);
});

test("explorationDelta：边界之后只有用户消息 → 空结论", () => {
  const delta = explorationDelta({
    branchEntryIds: ["a", "n1"],
    branchMessages: [assistant("pre-fork"), user("刚问出去还没回答")],
    boundaryEntryId: "a",
  });
  assert.equal(delta.text, "");
  assert.equal(delta.assistantMessages, 0);
});

test("planBringBack：追加到已有草稿、带上分支引用；没有结论时返回 null", () => {
  const plan = planBringBack({
    delta: { text: "  分支结论  ", assistantMessages: 1 },
    branch: { id: "branch-1", title: "  探索  分支  " },
    existingText: "我已经写了一半",
  });
  assert.deepEqual(plan, {
    value: "我已经写了一半\n\n分支结论",
    sessionReference: { id: "branch-1", title: "探索 分支" },
  });

  assert.equal(planBringBack({ delta: { text: "   ", assistantMessages: 0 }, branch: { id: "b" } }), null);
  assert.equal(planBringBack({ delta: { text: "结论", assistantMessages: 1 }, branch: { id: "b" } })?.value, "结论");
});
