"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * fork:zc-11 — 侧栏「用户自定义项目分组 + 项目拖拽排序」的持久化 store。
 *
 * WHY：时间桶（`lib/time-groups.ts`）解决的是「按时间找会话」，项目行本身仍固定按
 * 最近活跃排序；用户想按自己的工作方式把项目归到「客户 A / 内部工具 / 学习」这类
 * 自建分组，并手动调整顺序。和 `lib/session-flags.ts` 的置顶/归档一样，这是**纯展示
 * 层**的偏好：不重命名、不移动、不删除任何 `.jsonl`，只存在 `localStorage`。
 *
 * 三条硬规则（每一条都有单测钉住）：
 * 1. **读回来的数据一律不可信**。`localStorage` 用户可以手改，也可能来自旧版本；
 *    `parseSessionGroups` 丢弃一切形状不对的条目，绝不让 `undefined` 流进渲染层。
 * 2. **未知项目 id 不进渲染**。项目是服务端按会话列表算出来的；存储里的孤立 key
 *    （项目已删除、换了机器）只被忽略，不会被凭空渲染成一行。
 * 3. **有上限**。分组数量、名字长度、排序表长度都有上限，手改出一个 10 万行的 JSON
 *    也不能把侧栏拖垮。
 *
 * 存储形状（一个 key，整体原子读写）：
 *   { order: string[], groups: {id,name,collapsed}[], assignments: Record<项目key, 分组id> }
 */

const STORAGE_KEY = "pi-session-groups";
const CHANGE_EVENT = "pi-session-groups-change";

/** 分组数量上限：超过之后 `createGroup` 直接返回 false（UI 不再提供入口）。 */
export const MAX_SESSION_GROUPS = 50;
/** 分组名长度上限（按字符计，中文名同样按字符）。 */
export const MAX_GROUP_NAME_LENGTH = 60;
/** 项目排序表长度上限；多出来的尾部条目在解析时被丢弃。 */
export const MAX_PROJECT_ORDER_ENTRIES = 500;

export interface SessionGroup {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface SessionGroupsState {
  /** 项目 key 的全局排序；分组视图按这个顺序过滤出组内成员。 */
  order: string[];
  groups: SessionGroup[];
  /** 项目 key → 分组 id；没有键 = 未分组。 */
  assignments: Record<string, string>;
}

/** 服务端快照（`useSyncExternalStore` 要求引用稳定）。 */
const EMPTY: SessionGroupsState = { order: [], groups: [], assignments: {} };

function emptyState(): SessionGroupsState {
  return { order: [], groups: [], assignments: {} };
}

/** 名字清洗：去掉控制字符、折叠首尾空白、截断到上限；清洗后为空则视为非法。 */
export function sanitizeGroupName(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length > MAX_GROUP_NAME_LENGTH ? cleaned.slice(0, MAX_GROUP_NAME_LENGTH) : cleaned;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > 200) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= MAX_PROJECT_ORDER_ENTRIES) break;
  }
  return out;
}

function sanitizeGroups(value: unknown): SessionGroup[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SessionGroup[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id.length > 0 && record.id.length <= 200 ? record.id : "";
    const name = sanitizeGroupName(record.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, collapsed: record.collapsed === true });
    if (out.length >= MAX_SESSION_GROUPS) break;
  }
  return out;
}

function sanitizeAssignments(value: unknown, groupIds: ReadonlySet<string>): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, groupId] of Object.entries(value as Record<string, unknown>)) {
    if (!key || key.length > 200) continue;
    // 指向不存在的分组 = 脏数据（分组被手删了），按未分组处理而不是渲染一个幽灵组。
    if (typeof groupId !== "string" || !groupIds.has(groupId)) continue;
    out[key] = groupId;
    count += 1;
    if (count >= MAX_PROJECT_ORDER_ENTRIES) break;
  }
  return out;
}

/** 解析存储字符串。任何异常/畸形输入都退化为空状态，绝不抛错、绝不放行脏数据。 */
export function parseSessionGroups(raw: string | null): SessionGroupsState {
  if (!raw) return emptyState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return emptyState();
    const record = parsed as Record<string, unknown>;
    const groups = sanitizeGroups(record.groups);
    return {
      order: sanitizeStringList(record.order),
      groups,
      assignments: sanitizeAssignments(record.assignments, new Set(groups.map((group) => group.id))),
    };
  } catch {
    return emptyState();
  }
}

/**
 * 把项目按存储的顺序排好。
 *
 * - 存储里认识的 key 按存储顺序在前；
 * - 存储里没有的新项目（新会话带来的项目）保持调用方顺序追加在后面；
 * - 存储在中间插入的未知 key（已删除项目）被忽略，不占位。
 */
export function orderedProjects<T extends { key: string }>(
  projects: readonly T[],
  state: SessionGroupsState,
): T[] {
  const rank = new Map<string, number>();
  for (let index = 0; index < state.order.length; index += 1) {
    const key = state.order[index];
    if (!rank.has(key)) rank.set(key, index);
  }
  return projects
    .map((project, index) => ({ project, index, rank: rank.get(project.key) }))
    .sort((a, b) => {
      if (a.rank === undefined && b.rank === undefined) return a.index - b.index;
      if (a.rank === undefined) return 1;
      if (b.rank === undefined) return -1;
      return a.rank - b.rank;
    })
    .map((entry) => entry.project);
}

export interface ProjectGroupSection<T> {
  /** `null` = 未分组尾部区。 */
  group: SessionGroup | null;
  projects: T[];
}

/**
 * 渲染用的扁平分区表：分组按定义顺序在前（空组也保留，作为拖拽落点），
 * 未分组项目在最后。项目在组内的相对顺序来自全局 `order`。
 */
export function groupProjects<T extends { key: string }>(
  projects: readonly T[],
  state: SessionGroupsState,
): ProjectGroupSection<T>[] {
  const ordered = orderedProjects(projects, state);
  const knownGroupIds = new Set(state.groups.map((group) => group.id));
  const sections: ProjectGroupSection<T>[] = state.groups.map((group) => ({
    group,
    projects: ordered.filter((project) => state.assignments[project.key] === group.id),
  }));
  const ungrouped = ordered.filter((project) => !knownGroupIds.has(state.assignments[project.key]));
  if (ungrouped.length > 0 || sections.length === 0) {
    sections.push({ group: null, projects: ungrouped });
  }
  return sections;
}

/** 生成不会与已有 id 冲突的新分组 id（不依赖 crypto，jsdom/SSR 都能用）。 */
let groupIdCounter = 0;
export function makeGroupId(existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  for (;;) {
    groupIdCounter += 1;
    const id = `g${Date.now().toString(36)}${groupIdCounter.toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

/** 新建分组。名字非法或已达上限时返回 `null`（调用方据此不写存储）。 */
export function createGroup(
  state: SessionGroupsState,
  name: string,
  id: string = makeGroupId(state.groups.map((group) => group.id)),
): SessionGroupsState | null {
  const cleanName = sanitizeGroupName(name);
  if (!cleanName || !id || state.groups.length >= MAX_SESSION_GROUPS) return null;
  if (state.groups.some((group) => group.id === id)) return null;
  return { ...state, groups: [...state.groups, { id, name: cleanName, collapsed: false }] };
}

/** 重命名；名字清洗后为空时原样返回（不把空名写进存储）。 */
export function renameGroup(state: SessionGroupsState, id: string, name: string): SessionGroupsState {
  const cleanName = sanitizeGroupName(name);
  if (!cleanName) return state;
  let changed = false;
  const groups = state.groups.map((group) => {
    if (group.id !== id || group.name === cleanName) return group;
    changed = true;
    return { ...group, name: cleanName };
  });
  return changed ? { ...state, groups } : state;
}

/** 删除分组：组内项目回到未分组，assignments 里指向它的键一并清掉。 */
export function deleteGroup(state: SessionGroupsState, id: string): SessionGroupsState {
  if (!state.groups.some((group) => group.id === id)) return state;
  const assignments: Record<string, string> = {};
  for (const [key, groupId] of Object.entries(state.assignments)) {
    if (groupId !== id) assignments[key] = groupId;
  }
  return { ...state, groups: state.groups.filter((group) => group.id !== id), assignments };
}

export function setGroupCollapsed(state: SessionGroupsState, id: string, collapsed: boolean): SessionGroupsState {
  let changed = false;
  const groups = state.groups.map((group) => {
    if (group.id !== id || group.collapsed === collapsed) return group;
    changed = true;
    return { ...group, collapsed };
  });
  return changed ? { ...state, groups } : state;
}

export function toggleGroupCollapsed(state: SessionGroupsState, id: string): SessionGroupsState {
  const group = state.groups.find((item) => item.id === id);
  return group ? setGroupCollapsed(state, id, !group.collapsed) : state;
}

export interface ProjectMove {
  projectKey: string;
  /** 插到该 key 之前；`null`/缺省 = 追加到排序表末尾。 */
  beforeKey?: string | null;
  /** `undefined` = 不改归属；`null` = 移出分组；字符串 = 移入该分组（不存在则忽略）。 */
  groupId?: string | null;
}

/**
 * 拖拽落点的唯一入口：重排 + （可选）改组。
 *
 * `order` 是全局扁平顺序，分组视图再用 assignments 过滤；因此把 A 拖到另一个组的 B
 * 之前就等于「A 移入 B 的组，且排在其前」。未知的 `beforeKey`（目标在本次渲染里
 * 不存在）按追加处理，不丢移动。
 */
export function moveProject(state: SessionGroupsState, move: ProjectMove): SessionGroupsState {
  const { projectKey } = move;
  if (!projectKey) return state;

  // 先腾出一个槽位再插入：即使排序表已经到上限，本次被拖动的 key 也不会被截掉。
  const order = state.order
    .filter((key) => key !== projectKey)
    .slice(0, MAX_PROJECT_ORDER_ENTRIES - 1);
  if (move.beforeKey && move.beforeKey !== projectKey) {
    const index = order.indexOf(move.beforeKey);
    if (index === -1) order.push(projectKey);
    else order.splice(index, 0, projectKey);
  } else {
    order.push(projectKey);
  }

  const assignments = { ...state.assignments };
  if (move.groupId === null) delete assignments[projectKey];
  else if (typeof move.groupId === "string" && state.groups.some((group) => group.id === move.groupId)) {
    assignments[projectKey] = move.groupId;
  }

  return {
    order,
    groups: state.groups,
    assignments,
  };
}

/* -------------------------------------------------------------------------- */
/* localStorage store（与 lib/session-flags.ts 同一模式）                       */
/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();
let cache: SessionGroupsState | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function read(): SessionGroupsState {
  if (typeof window === "undefined") return emptyState();
  try {
    return parseSessionGroups(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

function ensure(): SessionGroupsState {
  if (cache === null) cache = read();
  return cache;
}

function write(next: SessionGroupsState): void {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用（隐私模式/配额）时，本次会话内的排序与分组仍然生效。
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  emit();
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cache = null;
    emit();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export interface SessionGroupsStore {
  state: SessionGroupsState;
  /** 返回 false 表示名字非法或已达分组上限。 */
  createGroup: (name: string) => boolean;
  renameGroup: (id: string, name: string) => void;
  deleteGroup: (id: string) => void;
  toggleGroupCollapsed: (id: string) => void;
  setGroupCollapsed: (id: string, collapsed: boolean) => void;
  moveProject: (move: ProjectMove) => void;
  assignProject: (projectKey: string, groupId: string | null) => void;
}

/** React 订阅入口：所有写操作都会让同文档与跨标签页的订阅者同步重渲。 */
export function useSessionGroups(): SessionGroupsStore {
  const state = useSyncExternalStore(subscribe, ensure, () => EMPTY);

  const create = useCallback((name: string): boolean => {
    const current = ensure();
    const next = createGroup(current, name, makeGroupId(current.groups.map((group) => group.id)));
    if (!next) return false;
    write(next);
    return true;
  }, []);

  const rename = useCallback((id: string, name: string) => {
    const next = renameGroup(ensure(), id, name);
    if (next !== ensure()) write(next);
  }, []);

  const remove = useCallback((id: string) => {
    const next = deleteGroup(ensure(), id);
    if (next !== ensure()) write(next);
  }, []);

  const toggle = useCallback((id: string) => {
    const next = toggleGroupCollapsed(ensure(), id);
    if (next !== ensure()) write(next);
  }, []);

  const setCollapsed = useCallback((id: string, collapsed: boolean) => {
    const next = setGroupCollapsed(ensure(), id, collapsed);
    if (next !== ensure()) write(next);
  }, []);

  const move = useCallback((projectMove: ProjectMove) => {
    const next = moveProject(ensure(), projectMove);
    if (next !== ensure()) write(next);
  }, []);

  const assign = useCallback((projectKey: string, groupId: string | null) => {
    const next = moveProject(ensure(), { projectKey, groupId });
    if (next !== ensure()) write(next);
  }, []);

  return { state, createGroup: create, renameGroup: rename, deleteGroup: remove, toggleGroupCollapsed: toggle, setGroupCollapsed: setCollapsed, moveProject: move, assignProject: assign };
}
