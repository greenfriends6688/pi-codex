// fork:ui-project-actions — 项目本地偏好（显示名 / 从列表中移除）的测试。
import assert from "node:assert/strict";
import test from "node:test";

const {
  filterHiddenProjects,
  parseProjectPrefs,
  projectDisplayName,
} = await import("./project-prefs.ts");

test("parseProjectPrefs tolerates malformed storage and trims aliases", () => {
  assert.deepEqual(parseProjectPrefs(null), { aliases: {}, hidden: [] });
  assert.deepEqual(parseProjectPrefs("{"), { aliases: {}, hidden: [] });
  assert.deepEqual(parseProjectPrefs("[]"), { aliases: {}, hidden: [] });
  assert.deepEqual(parseProjectPrefs(JSON.stringify({
    aliases: { "/a": "  Aliased  ", "/b": "   ", "/c": 7 },
    hidden: ["/x", "/x", 3, ""],
  })), { aliases: { "/a": "Aliased" }, hidden: ["/x"] });
});

test("projectDisplayName prefers the alias and falls back to the folder name", () => {
  const prefs = { aliases: { "/Users/me/work/api": "后端" }, hidden: [] };
  assert.equal(projectDisplayName("/Users/me/work/api", prefs), "后端");
  assert.equal(projectDisplayName("/Users/me/work/web", prefs), "web");
  // Windows separators work the same way.
  assert.equal(projectDisplayName("C:\\repo\\docs", prefs), "docs");
});

test("filterHiddenProjects drops hidden roots but keeps the selected one", () => {
  const prefs = { aliases: {}, hidden: ["/a", "/b"] };
  const projects = [{ root: "/a" }, { root: "/b" }, { root: "/c" }];
  assert.deepEqual(filterHiddenProjects(projects, prefs).map((p) => p.root), ["/c"]);
  // The selected project stays visible, otherwise removing it hides where you are.
  assert.deepEqual(filterHiddenProjects(projects, prefs, "/a").map((p) => p.root), ["/a", "/c"]);
  // No hidden entries → a copy, never the same array (callers memoize on identity).
  const untouched = filterHiddenProjects(projects, { aliases: {}, hidden: [] });
  assert.deepEqual(untouched.map((p) => p.root), ["/a", "/b", "/c"]);
  assert.notEqual(untouched, projects);
});
