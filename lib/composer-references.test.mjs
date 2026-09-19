import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./composer-references.ts");
}

// --- token 抽取 --------------------------------------------------------------

test("每个触发符都在行首或空白后开启 token", async () => {
  const { extractReferenceQuery } = await loadSubject();

  assert.deepEqual(extractReferenceQuery("&"), { kind: "session", start: 0, query: "" });
  assert.deepEqual(extractReferenceQuery("看下 &登录"), { kind: "session", start: 3, query: "登录" });
  assert.deepEqual(extractReferenceQuery("#"), { kind: "mcp", start: 0, query: "" });
  assert.deepEqual(extractReferenceQuery("用 #git"), { kind: "mcp", start: 2, query: "git" });
  assert.deepEqual(extractReferenceQuery("~"), { kind: "todo", start: 0, query: "" });
  assert.deepEqual(extractReferenceQuery("第 ~#3"), { kind: "todo", start: 2, query: "#3" });
});

test("触发符在词中不生效（避免把 a#b、1~2 当引用）", async () => {
  const { extractReferenceQuery } = await loadSubject();

  assert.equal(extractReferenceQuery("a#b"), null);
  assert.equal(extractReferenceQuery("1~2"), null);
  assert.equal(extractReferenceQuery("x&y"), null);
  assert.equal(extractReferenceQuery("issue-42#3"), null);
});

test("token 在空白处关闭", async () => {
  const { extractReferenceQuery } = await loadSubject();

  assert.equal(extractReferenceQuery("&登录 之后"), null);
  assert.equal(extractReferenceQuery("#git "), null);
});

test("`~/` 是家目录路径而不是待办引用", async () => {
  const { extractReferenceQuery } = await loadSubject();

  assert.equal(extractReferenceQuery("~/.pi/agent"), null);
  assert.equal(extractReferenceQuery("cat ~/notes.md"), null);
  // 待办本身仍能命中
  assert.deepEqual(extractReferenceQuery("~#2"), { kind: "todo", start: 0, query: "#2" });
});

test("光标在文本中间时只看光标之前（token 未闭合则不弹菜单）", async () => {
  const { extractReferenceQuery } = await loadSubject();

  // "看 &登录 里的问题" 光标停在 "登录" 之后、空格之前 → 仍是活跃 token
  assert.deepEqual(extractReferenceQuery("看 &登录"), { kind: "session", start: 2, query: "登录" });
  // 光标移到空格之后 → token 关闭
  assert.equal(extractReferenceQuery("看 &登录 "), null);
});

test("同类触发符取离光标最近的那个", async () => {
  const { extractReferenceQuery } = await loadSubject();

  const token = extractReferenceQuery("&第一个 #mid &第二个");
  assert.deepEqual(token, { kind: "session", start: 10, query: "第二个" });
});

test("与文件 @token 互斥：光标所在的那个 token 才生效", async () => {
  const { extractReferenceQuery } = await loadSubject();

  // 两个抽取器都锚定光标：`&` 在文本中间而 `#` 在光标处 → 只会命中 `#`。
  assert.equal(extractReferenceQuery("&会话 @src/Ch"), null);
  assert.deepEqual(extractReferenceQuery("&会话 #gi"), { kind: "mcp", start: 4, query: "gi" });
  assert.deepEqual(extractReferenceQuery("@src/x &sess"), { kind: "session", start: 7, query: "sess" });
  assert.deepEqual(extractReferenceQuery("@src/x ~#2"), { kind: "todo", start: 7, query: "#2" });
});

// --- 会话 -------------------------------------------------------------------

const SESSIONS = [
  { id: "aaaaaaaa-1111", name: "修复登录超时", cwd: "/repo/web" },
  { id: "bbbbbbbb-2222", firstMessage: "帮我写一个 Redis 连接池文档", cwd: "/repo/api" },
  { id: "cccccccc-3333", name: "登录页样式", cwd: "/repo/design" },
  { id: "dddddddd-4444" },
];

test("会话候选：标题优先会话名，其次首条消息，最后短 id", async () => {
  const { buildSessionReferenceItems } = await loadSubject();

  const items = buildSessionReferenceItems(SESSIONS);
  assert.deepEqual(items.map((item) => item.title), ["修复登录超时", "帮我写一个 Redis 连接池文档", "登录页样式", "dddddddd-444"]);
});

test("会话候选剔除当前会话与重复 id", async () => {
  const { buildSessionReferenceItems } = await loadSubject();

  const items = buildSessionReferenceItems([...SESSIONS, SESSIONS[0]], { currentSessionId: "bbbbbbbb-2222" });
  assert.equal(items.length, 3);
  assert.ok(!items.some((item) => item.id === "bbbbbbbb-2222"));
  assert.equal(new Set(items.map((item) => item.id)).size, 3);
});

test("会话筛选：命中标题/cwd/id，前缀优先于子串", async () => {
  const { buildSessionReferenceItems, filterSessionReferenceItems } = await loadSubject();
  const items = buildSessionReferenceItems(SESSIONS);

  const byTitle = filterSessionReferenceItems(items, "登录");
  assert.deepEqual(byTitle.map((item) => item.title), ["登录页样式", "修复登录超时"]);

  const byCwd = filterSessionReferenceItems(items, "repo/api");
  assert.deepEqual(byCwd.map((item) => item.id), ["bbbbbbbb-2222"]);

  const byId = filterSessionReferenceItems(items, "cccc");
  assert.deepEqual(byId.map((item) => item.id), ["cccccccc-3333"]);

  assert.deepEqual(filterSessionReferenceItems(items, "不存在的词"), []);
});

test("会话候选转成 SessionReference（进已有 chip 管道）", async () => {
  const { buildSessionReferenceItems, sessionReferenceFromItem } = await loadSubject();
  const [item] = buildSessionReferenceItems(SESSIONS);

  assert.deepEqual(sessionReferenceFromItem(item), {
    id: "aaaaaaaa-1111",
    title: "修复登录超时",
    cwd: "/repo/web",
  });
  // 没有 cwd 的会话不带这个字段（normalizeSessionReference 会剥掉空值）
  const [, , , plain] = buildSessionReferenceItems(SESSIONS);
  assert.deepEqual(sessionReferenceFromItem(plain), { id: "dddddddd-4444", title: "dddddddd-444" });
});

// --- MCP --------------------------------------------------------------------

const MCP = [
  { name: "zeta", scope: "global", disabled: true, kind: "command" },
  { name: "github", scope: "project", kind: "command" },
  { name: "linear", scope: "global", kind: "url" },
  { name: "github" },
];

test("MCP 候选：去重、启用在先、禁用保留并打标", async () => {
  const { buildMcpReferenceItems } = await loadSubject();

  const items = buildMcpReferenceItems(MCP);
  assert.deepEqual(items.map((item) => item.name), ["github", "linear", "zeta"]);
  assert.equal(items.find((item) => item.name === "zeta")?.disabled, true);
  assert.equal(items.find((item) => item.name === "linear")?.transport, "url");
  assert.equal(items.length, 3);
});

test("MCP 筛选按名字与作用域", async () => {
  const { buildMcpReferenceItems, filterMcpReferenceItems } = await loadSubject();
  const items = buildMcpReferenceItems(MCP);

  assert.deepEqual(filterMcpReferenceItems(items, "git").map((item) => item.name), ["github"]);
  assert.deepEqual(filterMcpReferenceItems(items, "lin").map((item) => item.name), ["linear"]);
  assert.deepEqual(filterMcpReferenceItems(items, "zzz"), []);
  // 空查询保持「启用在先」的顺序
  assert.deepEqual(filterMcpReferenceItems(items, "").map((item) => item.name), ["github", "linear", "zeta"]);
});

// --- 待办 -------------------------------------------------------------------

const TODOS = [
  { id: 1, text: "第一步：读代码", done: true },
  { id: 2, text: "第二步：改渲染", done: false },
  { id: 3, text: "第三步：补测试", done: false },
];

test("待办候选：未完成在前", async () => {
  const { buildTodoReferenceItems, filterTodoReferenceItems } = await loadSubject();

  const items = filterTodoReferenceItems(buildTodoReferenceItems(TODOS), "");
  assert.deepEqual(items.map((item) => item.id), [2, 3, 1]);
});

test("待办筛选支持 `#id` 与文字两种写法", async () => {
  const { buildTodoReferenceItems, filterTodoReferenceItems } = await loadSubject();
  const items = buildTodoReferenceItems(TODOS);

  assert.deepEqual(filterTodoReferenceItems(items, "#3").map((item) => item.id), [3]);
  assert.deepEqual(filterTodoReferenceItems(items, "3").map((item) => item.id), [3]);
  assert.deepEqual(filterTodoReferenceItems(items, "测试").map((item) => item.id), [3]);
  assert.deepEqual(filterTodoReferenceItems(items, "第二步").map((item) => item.id), [2]);
  assert.deepEqual(filterTodoReferenceItems(items, "不存在"), []);
});

test("待办筛选按 id 前缀匹配（~#1 不应命中 #11 之外的歧义）", async () => {
  const { buildTodoReferenceItems, filterTodoReferenceItems } = await loadSubject();
  const items = buildTodoReferenceItems([{ id: 1, text: "a", done: false }, { id: 11, text: "b", done: false }]);

  assert.deepEqual(filterTodoReferenceItems(items, "#1").map((item) => item.id), [1, 11]);
  assert.deepEqual(filterTodoReferenceItems(items, "#11").map((item) => item.id), [11]);
});

// --- 插入文本 ---------------------------------------------------------------

test("MCP 插入文本是 `#server `（闭合 token）", async () => {
  const { buildReferenceInsertText } = await loadSubject();

  const insertion = buildReferenceInsertText({ kind: "mcp", name: "github", disabled: false });
  assert.deepEqual(insertion, { text: "#github ", cursorOffset: 8 });
});

test("待办插入文本带 id 与文字，多行条目压成一行", async () => {
  const { buildReferenceInsertText } = await loadSubject();

  assert.deepEqual(
    buildReferenceInsertText({ kind: "todo", id: 3, text: "第三步：补测试", done: false }),
    { text: "~#3 第三步：补测试 ", cursorOffset: 12 },
  );
  assert.deepEqual(
    buildReferenceInsertText({ kind: "todo", id: 7, text: "多行\n条目  带空格", done: false }),
    { text: "~#7 多行 条目 带空格 ", cursorOffset: 14 },
  );
  assert.deepEqual(
    buildReferenceInsertText({ kind: "todo", id: 9, text: "   ", done: false }),
    { text: "~#9 ", cursorOffset: 4 },
  );
});

test("替换 token 只吃掉触发符到光标之间的内容", async () => {
  const { replaceReferenceToken, buildReferenceInsertText } = await loadSubject();

  const value = "看下 #git 的配置";
  // token 起点在 "#"（下标 3），光标在 "git" 之后（下标 7）
  const result = replaceReferenceToken(value, 3, 7, buildReferenceInsertText({ kind: "mcp", name: "github", disabled: false }));
  assert.equal(result.value, "看下 #github  的配置");
  assert.equal(result.cursor, 11);
});

test("行尾未闭合的 token 也能被替换", async () => {
  const { replaceReferenceToken, buildReferenceInsertText } = await loadSubject();

  const value = "帮我看看 &登录";
  const result = replaceReferenceToken(value, 5, value.length, buildReferenceInsertText({ kind: "todo", id: 2, text: "第二步", done: false }));
  assert.equal(result.value, "帮我看看 ~#2 第二步 ");
});
