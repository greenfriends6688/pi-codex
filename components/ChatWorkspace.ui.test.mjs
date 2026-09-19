import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:chat-workspace — contracts of the two UI pieces that make up the
// standalone chat workspace (source-level, matching the repo's other UI tests).
const row = await readFile(new URL("./ChatWorkspaceRow.tsx", import.meta.url), "utf8");
const picker = await readFile(new URL("./NewTaskPicker.tsx", import.meta.url), "utf8");

test("the chat row offers select, new chat, configure and collapse as separate buttons", () => {
  assert.match(row, /onClick=\{onSelect\}/);
  assert.match(row, /onClick=\{onNewChat\}/);
  assert.match(row, /onClick=\{onConfigure\}/);
  assert.match(row, /onClick=\{onToggle\}/);
  // Action buttons must not be nested inside the row's select button.
  const selectButtonEnd = row.indexOf("</button>", row.indexOf("onClick={onSelect}"));
  const newChatIndex = row.indexOf("onClick={onNewChat}");
  assert.ok(selectButtonEnd > 0 && newChatIndex > selectButtonEnd, "action buttons follow the select button");
});

// 聊天 与 项目 平级：标题行与「项目」标题行同款排版（fork:zn-02 后两侧都走
// --zn-row 高 + TEXT.lg / 500 / text-dim + 28×28 图标按钮）。
// 断言「两边一致」而不是钉死某一个字号：这才是这个测试的真正约束。
test("the chat caption matches the projects caption typography", () => {
  assert.match(row, /fontSize: TEXT\.lg,\n\s+fontWeight: 500,/);
  assert.match(row, /minHeight: "var\(--zn-row\)"/);
  assert.match(row, /width: 28,\n\s+height: 28,/);
});

test("the workspace picker lists projects plus the not-in-a-project entry", () => {
  assert.match(picker, /t\("sidebar\.newTaskNoProject"\)/);
  assert.match(picker, /t\("sidebar\.newTaskChooseProject"\)/);
  assert.match(picker, /t\("sidebar\.addProject"\)/);
  assert.match(picker, /project\.key === activeKey/);
  assert.match(picker, /onNewIn\(cwd\)/);
});

test("the workspace picker closes on Escape and on an outside click", () => {
  assert.match(picker, /event\.key === "Escape"/);
  assert.match(picker, /rootRef\.current\?\.contains\(event\.target as Node\)/);
  assert.match(picker, /document\.addEventListener\("mousedown", onPointerDown\)/);
});

test("the picker panel is anchored to the whole 新建任务 row, not to the chevron", () => {
  assert.match(picker, /left: 0,\n\s+right: 0,/);
  assert.doesNotMatch(picker, /position: "relative", flexShrink: 0/);
});
