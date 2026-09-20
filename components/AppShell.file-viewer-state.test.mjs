import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function fileContentBlock() {
  const start = source.indexOf("{/* Body: the active viewer");
  // The right-hand slice ends at the first overlay rendered after the workspace
  // shell. It used to anchor on the hand-rolled session context menu; that menu
  // now lives in components/ContextMenu.tsx and renders through a portal, so the
  // anchor moved to the settings panel mount point.
  const end = source.indexOf("\n    {settingsSection && (");
  assert.notEqual(start, -1, "file content comment not found");
  assert.notEqual(end, -1, "end of file content block not found");
  return source.slice(start, end);
}

test("every mounted file tab keeps its own FileViewer instance", () => {
  const block = fileContentBlock();
  // fork:file-tab-keep-alive — 从「只挂载激活的那个」改成「激活过的都常驻、切走只
  // hidden」：滚动位置/搜索/未保存的编辑态都靠这一点保住。
  assert.match(block, /fileTabs\.filter\(\(tab\) => mountedFileTabs\.has\(tab\.id\)\)\.map\(/);
  assert.equal(block.match(/<FileViewer/g)?.length, 1);
  assert.match(block, /hidden=\{!isActive\}/);
  // 关闭后必须真的卸载：剪枝 effect 把不在 fileTabs 里的 id 从集合里去掉。
  assert.match(source, /const next = new Set\(\[\.\.\.current\]\.filter\(\(id\) => open\.has\(id\)\)\)/);
});

test("each viewer restores its own tab state and saves it with a revision", () => {
  const block = fileContentBlock();
  assert.match(block, /key=\{`\$\{tab\.id\}:\$\{tab\.viewerRevision \?\? 0\}`\}/);
  assert.match(block, /initialState=\{tab\.viewerState\}/);
  assert.match(block, /handleFileViewerStateChange\(\s*tab\.id,\s*tab\.viewerRevision \?\? 0,/);
});

test("the editor stays active when it occupies the main region", () => {
  assert.match(source, /const editorVisible = workspaceSwapped \|\| rightPanelOpen;/);
  // 隐藏的 tab 不再看文件变更，也不参与选区提及：只有激活项才吃 editorVisible。
  assert.match(fileContentBlock(), /watchEnabled=\{editorVisible && isActive\}/);
  assert.match(fileContentBlock(), /onMentionLines=\{editorVisible && isActive \? handleFileLineMention : undefined\}/);
});
