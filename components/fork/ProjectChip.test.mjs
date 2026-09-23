import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ProjectChip, buildTargetItems, resolveActiveTarget } = await jiti.import("./ProjectChip.tsx");
const { ContextMenuProvider } = await jiti.import("@/components/ContextMenu");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

/** Labels pass straight through so assertions read as i18n keys. */
const t = (key) => key;

const projects = [
  { key: "k-pi", root: "/Users/me/pi-web", name: "pi-web" },
  { key: "k-bid", root: "/Users/me/招标改", name: "招标改" },
];

function targets(overrides = {}) {
  const calls = [];
  const value = {
    projects,
    chatPath: "/Users/me/pi-web-chat",
    activeCwd: "/Users/me/pi-web",
    onPickProject: (project) => calls.push({ kind: "project", project }),
    onPickChat: () => calls.push({ kind: "chat" }),
    onOpenFolder: () => calls.push({ kind: "folder" }),
    onNewBlank: () => calls.push({ kind: "blank" }),
    ...overrides,
  };
  return { value, calls };
}

function labels(entries) {
  return entries.map((entry) => (entry.type === "separator" ? "—" : entry.label));
}

test("resolveActiveTarget matches a project, the chat workspace, or neither", () => {
  assert.equal(resolveActiveTarget({ projects, chatPath: "/Users/me/pi-web-chat", activeCwd: "/Users/me/pi-web" }).activeProject?.key, "k-pi");
  assert.equal(resolveActiveTarget({ projects, chatPath: "/Users/me/pi-web-chat", activeCwd: "/Users/me/pi-web-chat" }).activeChat, true);
  const unknown = resolveActiveTarget({ projects, chatPath: "/Users/me/pi-web-chat", activeCwd: "/tmp/fresh" });
  assert.equal(unknown.activeProject, null);
  assert.equal(unknown.activeChat, false);
});

test("the active project stays in place with a check mark instead of being hoisted", () => {
  const { value } = targets();
  const entries = buildTargetItems(value, resolveActiveTarget(value), t);

  // fork:ui-projectchip-fix — 原来把当前项抽到顶上（不可点），用户点完就看不到「选了哪个」。
  // 现在所有项目留在原位，当前项打勾并禁用，其它项照常可切。
  const projectRows = entries.filter((entry) => entry.type !== "separator" && ["pi-web", "招标改"].includes(entry.label));
  assert.deepEqual(projectRows.map((entry) => entry.label), ["pi-web", "招标改"]);
  assert.equal(projectRows[0].checked, true);
  assert.equal(projectRows[0].disabled, true);
  assert.equal(projectRows[1].checked, undefined);
  assert.equal(typeof projectRows[1].onSelect, "function");
  assert.equal(projectRows[1].title, "/Users/me/招标改");
  // 标题只出现一次（不重复成动作）。
  assert.equal(labels(entries).filter((label) => label === "pi-web").length, 1);
});

test("menu offers open folder / not in a project, and no blank-project entry", () => {
  const { value, calls } = targets();
  const entries = buildTargetItems(value, resolveActiveTarget(value), t);

  assert.ok(labels(entries).includes("home.openFolder"));
  assert.ok(labels(entries).includes("sidebar.newTaskNoProject"));
  assert.ok(entries.some((entry) => entry.type === "separator"));
  // fork:ui-projectchip-fix — 「新建空白项目」已按用户要求移除。
  assert.ok(!labels(entries).includes("home.newBlankProject"));

  for (const entry of entries) {
    if (entry.type === "separator") continue;
    if (entry.label === "home.openFolder") entry.onSelect();
  }
  assert.deepEqual(calls.map((call) => call.kind), ["folder"]);
});

test("chat workspace row disappears once it is the active target", () => {
  const { value } = targets({ activeCwd: "/Users/me/pi-web-chat" });
  const entries = buildTargetItems(value, resolveActiveTarget(value), t);

  const chatRows = entries.filter((entry) => entry.type !== "separator" && entry.label === "sidebar.newTaskNoProject");
  assert.equal(chatRows.length, 1);
  assert.equal(chatRows[0].checked, true);
});

test("chat workspace row is disabled while its path is unknown", () => {
  const { value } = targets({ chatPath: null, activeCwd: "/Users/me/pi-web" });
  const entries = buildTargetItems(value, resolveActiveTarget(value), t);

  const row = entries.find((entry) => entry.type !== "separator" && entry.label === "sidebar.newTaskNoProject");
  assert.equal(row.disabled, true);
});

test("chip renders the active workspace name", () => {
  const { value } = targets();
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ContextMenuProvider, null, React.createElement(ProjectChip, { targets: value })),
    ),
  );

  assert.match(html, /pi-web/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /title="\/Users\/me\/pi-web"/);
});

test("chip falls back to the folder name for an unlisted target", () => {
  const { value } = targets({ activeCwd: "/tmp/fresh-folder" });
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ContextMenuProvider, null, React.createElement(ProjectChip, { targets: value })),
    ),
  );

  assert.match(html, /fresh-folder/);
});
