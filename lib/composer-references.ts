/**
 * fork:gap06-references — 行内引用触发符：`&` 会话 / `#` MCP / `~` 待办。
 *
 * 本仓此前只有 `@` 文件引用（`lib/file-fuzzy.ts` 的 `extractAtQuery` +
 * `components/ChatInput.tsx` 的 `@` 菜单）。B（Proma）有 5 类行内触发符，
 * 这里补上其中三类，把「右键复制会话引用 → 粘贴」那条间接路径变成行内可发现的操作。
 *
 * 三类触发符的落地方式**刻意不同**，因为它们下游能力不同：
 *
 * | 触发符 | 数据源 | 确认后 | 为什么 |
 * | --- | --- | --- | --- |
 * | `&` | `/api/sessions` | 变成 composer chip（`SessionReference`） | 会话引用管道已全线打通（序列化 `lib/composer-context.ts`、chip 回跳、草稿持久化），没有理由再铺一条 |
 * | `#` | `/api/mcp` | 插入行内文本 `#server ` | MCP 只有「服务名」这一级稳定标识，没有 chip 类型；行内文本与 `@path` 同构，且 agent 直接可读 |
 * | `~` | composer 已有的 `todoSummary` prop | 插入行内文本 `~#3 第三步 ` | 本仓 todo 是会话级的，`#id` 正是 todo 工具的选择器（`lib/todo-state.ts` 的 `toggle` 接受 id），文本同时给人看 |
 *
 * 本模块只放**纯函数**：抽取 token、筛选候选、生成插入文本。没有 React、没有 fetch，
 * 所以三个触发符的行为都能用 node:test 直接覆盖，不需要起组件树。
 */

import type { SessionReference } from "./composer-context";

export type ComposerReferenceKind = "session" | "mcp" | "todo";

export const COMPOSER_REFERENCE_TRIGGERS: Record<ComposerReferenceKind, string> = {
  session: "&",
  mcp: "#",
  todo: "~",
};

export interface ComposerReferenceQuery {
  kind: ComposerReferenceKind;
  /** 触发符在 `textBeforeCursor` 中的下标（替换 token 时要从这里切）。 */
  start: number;
  query: string;
}

const TRIGGER_KINDS: Record<string, ComposerReferenceKind | undefined> = {
  "&": "session",
  "#": "mcp",
  "~": "todo",
};

export const REFERENCE_RESULT_LIMIT = 20;

/**
 * 从光标前的文本里抽出当前生效的引用 token。
 *
 * 规则与 `extractAtQuery` 一致：触发符必须在行首或空白之后（避免把 `a#b`、`1~2`
 * 当成引用），查询串不含空白。
 *
 * 一个例外：`~/xxx` 是家目录路径，不是待办引用 —— 本仓的文件树/工具里 `~` 大量
 * 出现在路径位置，不排除它会在每一次输入 home 路径时弹出待办菜单。
 */
export function extractReferenceQuery(textBeforeCursor: string): ComposerReferenceQuery | null {
  const match = /(?:^|\s)([&#~])([^\s]*)$/.exec(textBeforeCursor);
  if (!match) return null;
  const trigger = match[1]!;
  const kind = TRIGGER_KINDS[trigger];
  if (!kind) return null;
  const query = match[2]!;
  if (kind === "todo" && query.startsWith("/")) return null;
  return { kind, start: textBeforeCursor.length - query.length - 1, query };
}

// --- 打分 -------------------------------------------------------------------

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) i += 1;
  }
  return i === needle.length;
}

/**
 * 与 `lib/file-fuzzy.ts` 的 `scoreEntry` 同一把梯子（精确 100 / 前缀 80 /
 * 子串 50 / 子序列 10），这样三个新菜单和 `@` 文件菜单的排序手感一致。
 * 多字段时取最高分：会话能按标题、cwd、id 命中任一。
 */
function scoreFields(fields: Array<string | undefined>, lowerQuery: string): number {
  let best = 0;
  for (const field of fields) {
    if (!field) continue;
    const lower = field.toLowerCase();
    let score = 0;
    if (lower === lowerQuery) score = 100;
    else if (lower.startsWith(lowerQuery)) score = 80;
    else if (lower.includes(lowerQuery)) score = 50;
    else if (isSubsequence(lowerQuery, lower)) score = 10;
    if (score > best) best = score;
  }
  return best;
}

function rank<T>(items: T[], lowerQuery: string, fields: (item: T) => Array<string | undefined>, limit: number): T[] {
  if (!lowerQuery) return items.slice(0, limit);
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const score = scoreFields(fields(item), lowerQuery);
    if (score > 0) scored.push({ item, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.item);
}

// --- 会话 -------------------------------------------------------------------

export interface ReferenceSessionSource {
  id: string;
  name?: string;
  firstMessage?: string;
  cwd?: string;
}

export interface ReferenceSessionItem {
  kind: "session";
  id: string;
  title: string;
  cwd?: string;
}

/** 标题优先用会话名，其次首条消息；两者都没有时退到短 id。 */
export function sessionItemTitle(session: ReferenceSessionSource): string {
  const name = session.name?.replace(/\s+/g, " ").trim();
  if (name) return name;
  const first = session.firstMessage?.replace(/\s+/g, " ").trim();
  if (first) return first.length > 80 ? `${first.slice(0, 79)}…` : first;
  return session.id.slice(0, 12);
}

/**
 * 会话候选列表。`currentSessionId` 从候选里剔除：引用当前会话没有意义，
 * 而且序列化块会让模型去「检索自己」。
 */
export function buildSessionReferenceItems(
  sessions: readonly ReferenceSessionSource[],
  options: { currentSessionId?: string | null } = {},
): ReferenceSessionItem[] {
  const seen = new Set<string>();
  const items: ReferenceSessionItem[] = [];
  for (const session of sessions) {
    if (!session?.id || seen.has(session.id)) continue;
    if (options.currentSessionId && session.id === options.currentSessionId) continue;
    seen.add(session.id);
    items.push({
      kind: "session",
      id: session.id,
      title: sessionItemTitle(session),
      ...(session.cwd ? { cwd: session.cwd } : {}),
    });
  }
  return items;
}

export function filterSessionReferenceItems(
  items: readonly ReferenceSessionItem[],
  query: string,
  limit: number = REFERENCE_RESULT_LIMIT,
): ReferenceSessionItem[] {
  return rank([...items], query.toLowerCase(), (item) => [item.title, item.cwd, item.id], limit);
}

/** 确认一条会话引用后进入已有 chip 管道（`addSessionReference`）。 */
export function sessionReferenceFromItem(item: ReferenceSessionItem): SessionReference {
  return { id: item.id, title: item.title, ...(item.cwd ? { cwd: item.cwd } : {}) };
}

// --- MCP --------------------------------------------------------------------

export interface ReferenceMcpSource {
  name: string;
  scope?: string;
  disabled?: boolean;
  kind?: string;
}

export interface ReferenceMcpItem {
  kind: "mcp";
  name: string;
  scope?: string;
  transport?: string;
  disabled: boolean;
}

/**
 * 禁用的服务**保留**在候选里并打标：用户常常先在设置里配好、临时禁用，
 * 从菜单里彻底消失会让人以为配置丢了。启用项排在前面。
 */
export function buildMcpReferenceItems(servers: readonly ReferenceMcpSource[]): ReferenceMcpItem[] {
  const seen = new Set<string>();
  const items: ReferenceMcpItem[] = [];
  for (const server of servers) {
    if (!server?.name || seen.has(server.name)) continue;
    seen.add(server.name);
    items.push({
      kind: "mcp",
      name: server.name,
      ...(server.scope ? { scope: server.scope } : {}),
      ...(server.kind ? { transport: server.kind } : {}),
      disabled: server.disabled === true,
    });
  }
  items.sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.name.localeCompare(b.name));
  return items;
}

export function filterMcpReferenceItems(
  items: readonly ReferenceMcpItem[],
  query: string,
  limit: number = REFERENCE_RESULT_LIMIT,
): ReferenceMcpItem[] {
  return rank([...items], query.toLowerCase(), (item) => [item.name, item.scope], limit);
}

// --- 待办 -------------------------------------------------------------------

export interface ReferenceTodoSource {
  id: number;
  text: string;
  done: boolean;
}

export interface ReferenceTodoItem {
  kind: "todo";
  id: number;
  text: string;
  done: boolean;
}

/** 菜单要渲染的候选合集（三类行的渲染差异都在 `components/ComposerReferenceMenu.tsx`）。 */
export type ComposerReferenceItem = ReferenceSessionItem | ReferenceMcpItem | ReferenceTodoItem;

export function buildTodoReferenceItems(todos: readonly ReferenceTodoSource[]): ReferenceTodoItem[] {
  return todos.map((todo) => ({ kind: "todo" as const, id: todo.id, text: todo.text, done: todo.done }));
}

/**
 * 待办查询支持两种写法：`~#3`（id，正是 token 自身的形式）与 `~第三步`（文字）。
 * 未完成项排在前面 —— 引用一条已经勾掉的待办，绝大多数时候是误操作。
 */
export function filterTodoReferenceItems(
  items: readonly ReferenceTodoItem[],
  query: string,
  limit: number = REFERENCE_RESULT_LIMIT,
): ReferenceTodoItem[] {
  const trimmed = query.replace(/^#/, "");
  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done) || a.id - b.id);
  if (!trimmed) return sorted.slice(0, limit);

  const numeric = /^\d+$/.test(trimmed);
  const matches = sorted.filter((item) => (
    numeric
      ? String(item.id).startsWith(trimmed)
      : scoreFields([item.text], trimmed.toLowerCase()) > 0
  ));
  return matches.slice(0, limit);
}

// --- 插入文本 ---------------------------------------------------------------

export interface ReferenceInsertion {
  /** 替换 token 的文本（含闭合空格）。 */
  text: string;
  /** 插入后光标相对 `text` 起点的偏移。 */
  cursorOffset: number;
}

export type ReferenceInsertableItem = ReferenceMcpItem | ReferenceTodoItem;

/**
 * 确认 MCP / 待办候选时写回 composer 的文本。
 *
 * 会话返回 `null`：它不是文本引用，而是 chip（见 `sessionReferenceFromItem`）。
 * 与 `buildAtInsertText` 一样以空格闭合 token —— 菜单随之关闭。
 */
export function buildReferenceInsertText(item: ReferenceInsertableItem): ReferenceInsertion {
  if (item.kind === "mcp") {
    const text = `#${item.name} `;
    return { text, cursorOffset: text.length };
  }
  // 待办的文本里可能带换行（模型写清单时常有多行条目），压成一行再插入。
  const label = item.text.replace(/\s+/g, " ").trim();
  const text = label ? `~#${item.id} ${label} ` : `~#${item.id} `;
  return { text, cursorOffset: text.length };
}

/** 用插入文本替换 text 中 `[tokenStart, cursor)` 之间的内容。 */
export function replaceReferenceToken(
  text: string,
  tokenStart: number,
  cursor: number,
  insertion: ReferenceInsertion,
): { value: string; cursor: number } {
  const before = text.slice(0, tokenStart);
  const after = text.slice(cursor);
  return {
    value: before + insertion.text + after,
    cursor: before.length + insertion.cursorOffset,
  };
}
