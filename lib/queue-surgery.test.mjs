import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./queue-surgery.ts");
}

const state = (steering = [], followUp = []) => ({ steering, followUp });

test("删除按下标，而不是按文本匹配第一条", async () => {
  const { applyQueueOperation } = await loadSubject();

  // 两条一模一样的消息：SDK 内部的交付逻辑会 indexOf → 永远删第一条；
  // 逐条操控必须能删掉用户点的那一条（下标 1）。
  const result = applyQueueOperation(state([], ["重复", "重复"]), { type: "remove", kind: "followUp", index: 1, expect: "重复" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.followUp, ["重复"]);
  assert.equal(result.moved, "重复");
});

test("下标越界被拒，并说明范围", async () => {
  const { applyQueueOperation } = await loadSubject();

  const result = applyQueueOperation(state(["a"]), { type: "remove", kind: "steer", index: 3, expect: "a" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "out-of-range");
  assert.match(result.message, /0\.\.0/);
});

test("过期请求被拒：下标还在，但已经不是那条文本", async () => {
  const { applyQueueOperation } = await loadSubject();

  // 用户看到的是「第二条 = B」，但队列已经前移成 [B, C] → 必须拒绝而不是误删 B。
  const result = applyQueueOperation(state(["B", "C"]), { type: "remove", kind: "steer", index: 1, expect: "B" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale");
});

test("不带 expect 时也能删（兼容只传下标的调用）", async () => {
  const { applyQueueOperation } = await loadSubject();

  const result = applyQueueOperation(state(["a", "b"]), { type: "remove", kind: "steer", index: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.steering, ["b"]);
});

test("队列内重排：向后拖、向前拖、拖到末尾都对得上", async () => {
  const { applyQueueOperation } = await loadSubject();

  const base = state([], ["a", "b", "c"]);

  const down = applyQueueOperation(base, { type: "move", kind: "followUp", from: 0, to: 2, expect: "a" });
  assert.equal(down.ok, true);
  assert.deepEqual(down.state.followUp, ["b", "a", "c"]);

  const up = applyQueueOperation(base, { type: "move", kind: "followUp", from: 2, to: 0, expect: "c" });
  assert.equal(up.ok, true);
  assert.deepEqual(up.state.followUp, ["c", "a", "b"]);

  // 拖到列表末尾：to 可以等于长度
  const tail = applyQueueOperation(base, { type: "move", kind: "followUp", from: 0, to: 3, expect: "a" });
  assert.equal(tail.ok, true);
  assert.deepEqual(tail.state.followUp, ["b", "c", "a"]);
});

test("重排不改变条数，也不动另一个队列", async () => {
  const { applyQueueOperation } = await loadSubject();

  const before = state(["s1", "s2"], ["f1", "f2"]);
  const result = applyQueueOperation(before, { type: "move", kind: "steer", from: 0, to: 2, expect: "s1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.steering, ["s2", "s1"]);
  assert.deepEqual(result.state.followUp, ["f1", "f2"]);
  // 原状态不被就地修改（调用方可能还要拿它做两层校验）
  assert.deepEqual(before.steering, ["s1", "s2"]);
});

test("重排的目标下标越界被拒", async () => {
  const { applyQueueOperation } = await loadSubject();

  const result = applyQueueOperation(state([], ["a"]), { type: "move", kind: "followUp", from: 0, to: 5, expect: "a" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "out-of-range");
});

test("立即发送：followUp 提升到 steering 队首", async () => {
  const { applyQueueOperation } = await loadSubject();

  const result = applyQueueOperation(
    state(["已有的引导"], ["晚点再说", "最后一条"]),
    { type: "promote", index: 0, expect: "晚点再说" },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.steering, ["晚点再说", "已有的引导"]);
  assert.deepEqual(result.state.followUp, ["最后一条"]);
});

test("提升同样遵守过期与越界检查", async () => {
  const { applyQueueOperation } = await loadSubject();

  assert.equal(applyQueueOperation(state([], []), { type: "promote", index: 0 }).ok, false);
  const stale = applyQueueOperation(state([], ["x"]), { type: "promote", index: 0, expect: "y" });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "stale");
});

test("sameQueue 用于两层一致性校验", async () => {
  const { sameQueue } = await loadSubject();

  assert.equal(sameQueue(["a", "b"], ["a", "b"]), true);
  assert.equal(sameQueue(["a"], ["a", "b"]), false);
  assert.equal(sameQueue(["a", "b"], ["b", "a"]), false);
  assert.equal(sameQueue([], []), true);
});

test("queueContains 覆盖两个队列", async () => {
  const { queueContains } = await loadSubject();

  assert.equal(queueContains(state(["a"]), "a"), true);
  assert.equal(queueContains(state([], ["b"]), "b"), true);
  assert.equal(queueContains(state(["a"], ["b"]), "c"), false);
});
