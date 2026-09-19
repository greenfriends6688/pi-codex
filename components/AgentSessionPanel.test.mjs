import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");

test("keeps the main session first and makes every agent session selectable", () => {
  const mainRow = source.indexOf("session={rootSession}");
  const subagentRows = source.indexOf("visibleSubagents.map");
  assert.ok(mainRow > 0);
  assert.ok(subagentRows > mainRow);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(rootSession\)\}/);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(session\)\}/);
  assert.match(source, /aria-selected=\{selected\}/);
});

test("sorts running subagents first and enables search only for larger families", () => {
  assert.match(source, /if \(aRunning !== bRunning\) return aRunning \? -1 : 1/);
  assert.match(source, /subagents\.length > 8/);
  assert.match(source, /relation\?\.description, relation\?\.profile, session\.name, session\.firstMessage/);
  assert.match(source, /maxHeight: "min\(58dvh, 480px\)"/);
});

test("renders as a compact left-positioned dropdown without a centered inner width", () => {
  assert.match(source, /borderLeft: "1px solid var\(--border\)"/);
  assert.match(source, /borderRadius: "0 0 var\(--radius-md\) var\(--radius-md\)"/);
  assert.doesNotMatch(source, /maxWidth: 680/);
});

test("shows persisted completion states while live running state takes precedence", () => {
  // fork:proma-06-delegation — 状态不再就地算：
  // 「不在跑 + 持久化是活状态」必须变成 interrupted（重启后不再假装在跑），
  // 这条不变式在 lib/subagent-status.ts 里实现，这里只钉「组件确实走它 + 不再自己判」。
  assert.match(source, /const status: SubagentSessionStatus = effectiveSubagentStatus\(relation\?\.status, \{ running \}\)/);
  assert.doesNotMatch(source, /running \? "running" : relation\?\.status/);
  assert.match(source, /t\(`agentSwitcher\.status\.\$\{status\}`\)/);
  assert.match(source, /status === "failed"/);
  assert.match(source, /status === "aborted" \|\| status === "interrupted"/);
});
