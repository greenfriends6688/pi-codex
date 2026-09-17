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

test("only the active file tab mounts a FileViewer", () => {
  const block = fileContentBlock();
  assert.match(block, /activeFileTab\?\.filePath \? \(/);
  assert.doesNotMatch(block, /fileTabs\.map\(/);
  assert.equal(block.match(/<FileViewer/g)?.length, 1);
});

test("the active viewer restores tab state and saves it with a revision", () => {
  const block = fileContentBlock();
  assert.match(block, /key=\{`\$\{activeFileTab\.id\}:\$\{activeFileTab\.viewerRevision \?\? 0\}`\}/);
  assert.match(block, /initialState=\{activeFileTab\.viewerState\}/);
  assert.match(block, /handleFileViewerStateChange\(\s*activeFileTab\.id,\s*activeFileTab\.viewerRevision \?\? 0,/);
});

test("the editor stays active when it occupies the main region", () => {
  assert.match(source, /const editorVisible = workspaceSwapped \|\| rightPanelOpen;/);
  assert.match(fileContentBlock(), /watchEnabled=\{editorVisible\}/);
  assert.match(fileContentBlock(), /onMentionLines=\{editorVisible \? handleFileLineMention : undefined\}/);
});
