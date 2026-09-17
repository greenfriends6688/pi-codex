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

test("active project is checked once and never repeated as a switch action", () => {
  const { value } = targets();
  const entries = buildTargetItems(value, resolveActiveTarget(value), t);

  const checked = entries.filter((entry) => entry.type !== "separator" && entry.checked);
  assert.equal(checked.length, 1);
  assert.equal(checked[0].label, "pi-web");
  assert.equal(checked[0].onSelect, undefined);

  // The other project stays selectable, with the full path as its title.
  const other = entries.find((entry) => entry.type !== "separator" && entry.label === "招标改");
  assert.equal(other.title, "/Users/me/招标改");
  assert.equal(labels(entries).filter((label) => label === "pi-web").length, 1);
});

test("menu offers open folder / new blank project / not in a project", () => {
  const { value, calls } = targets();
  const entries = buildTargetItems(value, resolveActiveTarget(value), t);

  assert.ok(labels(entries).includes("home.openFolder"));
  assert.ok(labels(entries).includes("home.newBlankProject"));
  assert.ok(labels(entries).includes("sidebar.newTaskNoProject"));
  assert.ok(entries.some((entry) => entry.type === "separator"));

  for (const entry of entries) {
    if (entry.type === "separator") continue;
    if (entry.label === "home.openFolder") entry.onSelect();
    if (entry.label === "home.newBlankProject") entry.onSelect();
  }
  assert.deepEqual(calls.map((call) => call.kind), ["folder", "blank"]);
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
