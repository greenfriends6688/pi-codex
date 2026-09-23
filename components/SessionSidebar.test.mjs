import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { getSessionListIndices, SESSION_LIST_ITEM_HEIGHT } = await jiti.import("./SessionSidebar.tsx");

const windowCount = (viewportHeight) => Math.ceil((viewportHeight || 600) / SESSION_LIST_ITEM_HEIGHT) + 16;

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("scrolling keeps the focused session and the viewport mounted without expanding the whole window", () => {
  for (const [scrollTop, focusedIndex] of [[0, 1999], [10000, 0]]) {
    const indices = getSessionListIndices(2000, scrollTop, 335, focusedIndex);
    const firstVisible = Math.floor(scrollTop / SESSION_LIST_ITEM_HEIGHT);
    const lastVisible = Math.ceil((scrollTop + 335) / SESSION_LIST_ITEM_HEIGHT) - 1;
    for (let index = firstVisible; index <= lastVisible; index++) assert.ok(indices.includes(index));
    assert.ok(indices.includes(focusedIndex));
    assert.equal(indices.length, windowCount(335) + 1);
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
  assert.equal(getSessionListIndices(2000, 0, 335, 3).length, windowCount(335));
  const blurred = getSessionListIndices(2000, 10000, 335);
  assert.equal(blurred.length, windowCount(335));
  assert.ok(!blurred.includes(0));
});

test("session windows stay valid after a project shrinks and before the viewport is measured", () => {
  assert.deepEqual(getSessionListIndices(5, 80000, 335, 1999), [0, 1, 2, 3, 4]);
  assert.deepEqual(getSessionListIndices(0, 80000, 335, 1999), []);
  assert.equal(getSessionListIndices(2000, 0, 0).length, windowCount(0));
});

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(allSessions\)/);
});

test("subagent completion stays silent and never becomes unread", () => {
  assert.match(source, /completionNotificationSuppressedSessionIds\?: string\[\]/);
  assert.match(
    source,
    /completedWithNotifications = completedInBackground\.filter\([\s\S]*?!previousSuppressedCompletionSessionIdsRef\.current\.has\(id\)[\s\S]*?!knownSubagentIds\.has\(id\)/,
  );
  assert.match(source, /completedWithNotifications\.forEach\(\(id\) => next\.add\(id\)\)/);
  assert.match(source, /if \(completedWithNotifications\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(
    source,
    /filter\(\(session\) => session\.relation\?\.kind !== "subagent"\)[\s\S]*?unreadEligibleIds\.has\(id\)/,
  );
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("formats session timestamps with the active locale", () => {
  assert.match(source, /import \{ formatRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(sessionItemSource, /const \{ locale, t \} = useI18n\(\)/);
  assert.match(sessionItemSource, /formatRelativeTime\(session\.modified, locale\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("lifecycle refreshes bypass the cache while cross-window polling reuses it", () => {
  assert.match(source, /function sessionListUrl\(summary: boolean, force: boolean\)/);
  assert.match(source, /if \(summary\) return "\/api\/sessions\?summary=1"/);
  assert.match(source, /if \(force\) return "\/api\/sessions\?force=1"/);
  assert.match(source, /cache: "no-store"/);
  // First paint uses the cheap summary listing, then hydrates after a delay.
  assert.match(source, /loadSessions\(true, false, true\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?void loadSessions\(false, true\)/);
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef|title=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{showHover && !session\.transient \? \(/);
});

test("hides subagent rows and aggregates their state into the main session row", () => {
  // The session list feeds through the client-side pin/archive flags before it is
  // grouped into families, so a pinned row sorts first and an archived row drops out.
  assert.match(source, /const sessionFamilies = listSessionFamilies\(applySessionFlags\(filteredSessions, sessionFlags\)\)/);
  assert.match(source, /familySessions\.some\(\(session\) => session\.id === selectedSessionId\)/);
  assert.match(source, /familySessions\.some\(\(session\) => runningSessionIds\.has\(session\.id\)\)/);
  assert.doesNotMatch(source, /function SessionTreeItem/);
});

test("keeps configuration out of the sidebar — entry points live in the AppShell footer", () => {
  assert.match(source, /label=\{t\("sidebar\.newTask"\)\}/);
  assert.doesNotMatch(source, /section="(?:models|skills|plugins|settings)"/);
  assert.doesNotMatch(source, /onOpenSettings/);
});

test("renders projects as primary rows with the selected project's tasks nested below", () => {
  assert.match(source, /\{visibleProjects\.map\(\(project\) => \{/);
  assert.match(source, /<ProjectRow/);
  // The fork renders the selected project's tasks through an explicit branch
  // (the upstream inline `isSelectedProject && (` form was restructured).
  assert.match(source, /if \(project\.key === selectedProject\?\.key\) \{[\s\S]*?ref=\{sessionListRef\}/);
  assert.match(source, /t\("sidebar\.addProject"\)/);
  assert.doesNotMatch(source, /showMoreProjects/);
  assert.doesNotMatch(source, /showFewerProjects/);
  assert.doesNotMatch(source, /PROJECTS_COLLAPSED_LIMIT/);
});

// fork:chat-workspace / fork:zn-13
test("keeps a standalone chat section beside the projects", () => {
  assert.match(source, /<ChatWorkspaceRow/);
  // fork:ui-project-actions — 「新建任务」右侧的项目下拉已移除（用户要求）；项目相关动作
  // 现在挂在每个项目行的「⋯」上，「添加项目」在项目列表底部一行。
  assert.doesNotMatch(source, /<NewTaskPicker/);
  assert.match(source, /filterHiddenProjects\(/);
  assert.match(source, /projectDisplayName\(project\.root, projectPrefs\)/);
  // fork:ui-project-actions — 项目列表再经本地偏好（别名 / 从列表移除）过滤。
  assert.match(source, /filterHiddenProjects\(\s*withoutChatProject\(projectChoices, chatProjectKey\),/);
  assert.match(source, /fetch\("\/api\/chat-workspace"/);
  // 聊天 与 项目 平级（侧栏 tab 分 pane）：项目分区在前，聊天分区排在项目行之后。
  assert.ok(
    source.indexOf("<ChatWorkspaceRow") > source.indexOf('{t("sidebar.projects")}'),
    "the chat section renders after the projects caption",
  );
  assert.ok(
    source.indexOf('{sidebarPane === "chat" && chatProject && (() => {') > source.indexOf("{visibleProjects.map((project) => {"),
    "the chat section renders below the project rows",
  );
  // The default workspace is resolved at click time — never the "" / "/" render value.
  assert.match(source, /const resolveDefaultCwd = useCallback\(async \(\): Promise<string \| null> => \{/);
  assert.match(source, /if \(selectedCwd\) return selectedCwd;/);
  assert.doesNotMatch(source, /selectedCwd \|\| homeDir \|\| "\/"/);
  assert.doesNotMatch(source, /chatWorkspace\?\.cwd \|\| homeDir \|\| "\/"/);
});
