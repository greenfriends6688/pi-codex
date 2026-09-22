/**
 * lib/session-groups.test.mjs 被测模块见 ./session-groups.ts。
 *
 * 钉住四类边界：
 * 1. localStorage 是用户可编辑的 → 畸形/恶意 JSON 必须被丢弃而不是流进渲染层；
 * 2. 排序尊重存储但对「未知项目」宽容（新项目按原顺序追加，幽灵 key 忽略）；
 * 3. 分组 CRUD / 拖拽移动 / 删除后 ungroup 的行为稳定；
 * 4. 上限：分组数、分组名长度、order 长度。
 */
import assert from "node:assert/strict";
import test from "node:test";

const {
  MAX_GROUP_NAME_LENGTH,
  MAX_PROJECT_ORDER_ENTRIES,
  MAX_SESSION_GROUPS,
  createGroup,
  deleteGroup,
  groupProjects,
  makeGroupId,
  moveProject,
  orderedProjects,
  parseSessionGroups,
  renameGroup,
  sanitizeGroupName,
  setGroupCollapsed,
  toggleGroupCollapsed,
} = await import("./session-groups.ts");

const empty = () => ({ order: [], groups: [], assignments: {} });
const project = (key) => ({ key, root: `/tmp/${key}` });

test("parseSessionGroups tolerates malformed and hostile payloads", () => {
  assert.deepEqual(parseSessionGroups(null), empty());
  assert.deepEqual(parseSessionGroups(""), empty());
  assert.deepEqual(parseSessionGroups("{"), empty());
  assert.deepEqual(parseSessionGroups("[]"), empty());
  assert.deepEqual(parseSessionGroups("null"), empty());
  assert.deepEqual(parseSessionGroups(JSON.stringify("nope")), empty());
  // 条目类型错误 / 空串 / 重复 → 丢弃或去重，绝不能把 undefined 带进渲染层。
  assert.deepEqual(
    parseSessionGroups(JSON.stringify({ order: ["a", 3, null, "a", "", "b"] })).order,
    ["a", "b"],
  );
  assert.deepEqual(
    parseSessionGroups(JSON.stringify({ groups: "nope", assignments: 7 })),
    empty(),
  );
});

test("parseSessionGroups drops malformed groups and dedupes by id", () => {
  const parsed = parseSessionGroups(JSON.stringify({
    groups: [
      { id: "g1", name: "Work", collapsed: true },
      { id: "g1", name: "Duplicate" },
      { id: "", name: "No id" },
      { id: "g2", name: "   " },
      { id: "g3", name: "Personal", collapsed: "yes" },
      { id: 7, name: "Wrong id type" },
      null,
    ],
  }));
  assert.deepEqual(parsed.groups, [
    { id: "g1", name: "Work", collapsed: true },
    { id: "g3", name: "Personal", collapsed: false },
  ]);
});

test("assignments pointing at unknown groups are dropped, not rendered as ghosts", () => {
  const parsed = parseSessionGroups(JSON.stringify({
    groups: [{ id: "g1", name: "Work" }],
    assignments: { a: "g1", b: "missing", c: 5, "": "g1" },
  }));
  assert.deepEqual(parsed.assignments, { a: "g1" });
});

test("storage caps are enforced on read", () => {
  const manyGroups = Array.from({ length: MAX_SESSION_GROUPS + 20 }, (_, index) => ({
    id: `g${index}`,
    name: `Group ${index}`,
  }));
  const manyOrder = Array.from({ length: MAX_PROJECT_ORDER_ENTRIES + 20 }, (_, index) => `p${index}`);
  const parsed = parseSessionGroups(JSON.stringify({ order: manyOrder, groups: manyGroups }));
  assert.equal(parsed.groups.length, MAX_SESSION_GROUPS);
  assert.equal(parsed.order.length, MAX_PROJECT_ORDER_ENTRIES);
});

test("createGroup validates the name, the id and the cap", () => {
  let state = empty();
  const created = createGroup(state, "  Work  ", "g1");
  assert.notEqual(created, null);
  state = created;
  assert.deepEqual(state.groups, [{ id: "g1", name: "Work", collapsed: false }]);
  // 重名 id 拒绝
  assert.equal(createGroup(state, "Other", "g1"), null);
  // 空名 / 纯控制字符拒绝
  assert.equal(createGroup(state, "   ", "g2"), null);
  assert.equal(createGroup(state, "\u0000\u0001", "g2"), null);
  // 名字按字符截断
  const long = createGroup(state, "x".repeat(MAX_GROUP_NAME_LENGTH + 30), "g2");
  assert.equal(long.groups[1].name.length, MAX_GROUP_NAME_LENGTH);
  state = long;
  // 到达分组上限
  for (let index = state.groups.length; index < MAX_SESSION_GROUPS; index += 1) {
    state = createGroup(state, `Group ${index}`, `cap${index}`);
    assert.notEqual(state, null);
  }
  assert.equal(state.groups.length, MAX_SESSION_GROUPS);
  assert.equal(createGroup(state, "One too many", "overflow"), null);
});

test("makeGroupId never collides with existing ids", () => {
  const first = makeGroupId();
  const second = makeGroupId([first]);
  assert.notEqual(first, second);
  assert.equal(new Set([first, second]).size, 2);
});

test("sanitizeGroupName strips control characters and trims", () => {
  assert.equal(sanitizeGroupName("  hello  "), "hello");
  assert.equal(sanitizeGroupName("a\tb\nc"), "a b c");
  assert.equal(sanitizeGroupName(5), "");
});

test("renameGroup ignores empty names and leaves state identity when unchanged", () => {
  const state = { ...empty(), groups: [{ id: "g1", name: "Work", collapsed: false }] };
  assert.equal(renameGroup(state, "g1", "  "), state);
  assert.equal(renameGroup(state, "g1", "Work"), state);
  assert.deepEqual(renameGroup(state, "g1", " Work  ").groups, [{ id: "g1", name: "Work", collapsed: false }]);
  assert.deepEqual(renameGroup(state, "g1", "Client A").groups, [{ id: "g1", name: "Client A", collapsed: false }]);
  assert.equal(renameGroup(state, "ghost", "Nope"), state);
});

test("setGroupCollapsed / toggleGroupCollapsed only touch the target", () => {
  const state = {
    ...empty(),
    groups: [
      { id: "g1", name: "Work", collapsed: false },
      { id: "g2", name: "Home", collapsed: false },
    ],
  };
  const collapsed = setGroupCollapsed(state, "g2", true);
  assert.deepEqual(collapsed.groups.map((group) => group.collapsed), [false, true]);
  assert.equal(setGroupCollapsed(state, "g2", false), state);
  assert.equal(setGroupCollapsed(state, "ghost", true), state);
  assert.deepEqual(toggleGroupCollapsed(state, "g1").groups.map((group) => group.collapsed), [true, false]);
  assert.equal(toggleGroupCollapsed(state, "ghost"), state);
});

const projects = [project("a"), project("b"), project("c"), project("d")];

test("orderedProjects respects stored order, ignores ghosts and appends new projects", () => {
  const state = { ...empty(), order: ["ghost", "c", "a"] };
  assert.deepEqual(orderedProjects(projects, state).map((item) => item.key), ["c", "a", "b", "d"]);
  // 空存储 = 原顺序原样返回（新数组，不别名）
  const untouched = orderedProjects(projects, empty());
  assert.deepEqual(untouched.map((item) => item.key), ["a", "b", "c", "d"]);
  assert.notEqual(untouched, projects);
});

test("groupProjects puts groups first (empty groups stay as drop targets) and ungrouped last", () => {
  const state = {
    order: ["d", "b", "a", "c"],
    groups: [
      { id: "g1", name: "One", collapsed: false },
      { id: "g2", name: "Two", collapsed: false },
      { id: "g3", name: "Empty", collapsed: false },
    ],
    assignments: { b: "g1", a: "g1", c: "g2" },
  };
  const sections = groupProjects(projects, state);
  assert.deepEqual(sections.map((section) => section.group?.id ?? null), ["g1", "g2", "g3", null]);
  assert.deepEqual(sections[0].projects.map((item) => item.key), ["b", "a"]);
  assert.deepEqual(sections[1].projects.map((item) => item.key), ["c"]);
  assert.deepEqual(sections[2].projects, []);
  assert.deepEqual(sections[3].projects.map((item) => item.key), ["d"]);
});

test("groupProjects with no groups renders one ungrouped section", () => {
  const sections = groupProjects(projects, empty());
  assert.equal(sections.length, 1);
  assert.equal(sections[0].group, null);
  assert.deepEqual(sections[0].projects.map((item) => item.key), ["a", "b", "c", "d"]);
});

test("moveProject reorders and regroups in one atomic step", () => {
  const state = {
    order: ["a", "b", "c", "d"],
    groups: [{ id: "g1", name: "One", collapsed: false }],
    assignments: {},
  };
  // 把 d 移到 b 之前并加入 g1
  const moved = moveProject(state, { projectKey: "d", beforeKey: "b", groupId: "g1" });
  assert.deepEqual(moved.order, ["a", "d", "b", "c"]);
  assert.deepEqual(moved.assignments, { d: "g1" });
  // 未知 beforeKey → 追加，不丢操作
  const appended = moveProject(state, { projectKey: "c", beforeKey: "ghost" });
  assert.deepEqual(appended.order, ["a", "b", "d", "c"]);
  // groupId undefined → 归属不变
  assert.deepEqual(moveProject(moved, { projectKey: "d" }).assignments, { d: "g1" });
  // groupId null → 移出分组
  assert.deepEqual(moveProject(moved, { projectKey: "d", groupId: null }).assignments, {});
  // 不存在的分组 → 归属按未提供处理（不写幽灵 id）
  assert.deepEqual(moveProject(moved, { projectKey: "a", groupId: "ghost" }).assignments, { d: "g1" });
  // 拖到自己身上是 no-op 顺序
  assert.deepEqual(moveProject(state, { projectKey: "a", beforeKey: "a" }).order, ["b", "c", "d", "a"]);
  assert.equal(moveProject(state, { projectKey: "" }), state);
});

test("deleteGroup ungroups its members and keeps other assignments", () => {
  const state = {
    order: ["a", "b"],
    groups: [
      { id: "g1", name: "One", collapsed: false },
      { id: "g2", name: "Two", collapsed: false },
    ],
    assignments: { a: "g1", b: "g2" },
  };
  const deleted = deleteGroup(state, "g1");
  assert.deepEqual(deleted.groups.map((group) => group.id), ["g2"]);
  assert.deepEqual(deleted.assignments, { b: "g2" });
  assert.equal(deleteGroup(state, "ghost"), state);
});

test("storage cap also protects a hostile hand-written assignment table", () => {
  const assignments = Object.fromEntries(
    Array.from({ length: MAX_PROJECT_ORDER_ENTRIES + 5 }, (_, index) => [`p${index}`, "g1"]),
  );
  const parsed = parseSessionGroups(JSON.stringify({
    groups: [{ id: "g1", name: "One" }],
    assignments,
  }));
  assert.equal(Object.keys(parsed.assignments).length, MAX_PROJECT_ORDER_ENTRIES);
});

test("moveProject caps the order table without dropping the moved key", () => {
  const state = {
    order: Array.from({ length: MAX_PROJECT_ORDER_ENTRIES }, (_, index) => `existing${index}`),
    groups: [],
    assignments: {},
  };
  const moved = moveProject(state, { projectKey: "fresh" });
  assert.equal(moved.order.length, MAX_PROJECT_ORDER_ENTRIES);
  assert.equal(moved.order.at(-1), "fresh");
});
