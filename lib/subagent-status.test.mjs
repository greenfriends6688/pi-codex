// fork:proma-06-delegation — 子会话有效状态单测（纯函数）
import { test } from "node:test";
import assert from "node:assert/strict";

import { effectiveSubagentStatus, isInterruptedSubagent, subagentStatusLabelKey } from "./subagent-status.ts";

test("真的在跑时就是 running，不管持久化写了什么", () => {
  assert.equal(effectiveSubagentStatus("completed", { running: true }), "running");
  assert.equal(effectiveSubagentStatus(undefined, { running: true }), "running");
});

test("持久化是活状态但已经不在跑 → interrupted（不是 completed）", () => {
  for (const persisted of ["starting", "queued", "running"]) {
    assert.equal(effectiveSubagentStatus(persisted, { running: false }), "interrupted");
    assert.equal(isInterruptedSubagent(persisted, { running: false }), true);
  }
});

test("终态照原样透传，不被打成 interrupted", () => {
  for (const persisted of ["completed", "failed", "aborted"]) {
    assert.equal(effectiveSubagentStatus(persisted, { running: false }), persisted);
    assert.equal(isInterruptedSubagent(persisted, { running: false }), false);
  }
  // 已经写着 interrupted 的会话：状态透传，而且它确实算中断
  assert.equal(effectiveSubagentStatus("interrupted", { running: false }), "interrupted");
  assert.equal(isInterruptedSubagent("interrupted", { running: false }), true);
});

test("没有状态信息（老会话）→ completed 兜底", () => {
  assert.equal(effectiveSubagentStatus(undefined, { running: false }), "completed");
  assert.equal(effectiveSubagentStatus(null, { running: false }), "completed");
});

test("标签 key 只有一个来源", () => {
  assert.equal(subagentStatusLabelKey("interrupted"), "agentSwitcher.status.interrupted");
});
