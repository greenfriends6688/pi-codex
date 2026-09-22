/**
 * fork:zc-06 — 右栏 tab 概览里「最近关闭」的纯逻辑 + 存储适配。
 *
 * 这个模块只做两件事：**决定什么值得记**，和**把不可信存储读成可信结构**。
 *
 * 为什么只记一部分 tab：文件 tab 与 `git-graph` 单例的快照就是「一个路径」，
 * 重开等于再调一次打开文件，一定成功。终端与浏览器 tab 各自带着一个活着的
 * 会话 / 页面（`lib/terminal-manager.ts` 的 PTY、浏览器 tab 的 url 与历史），
 * 快照恢复不回来 —— 记进去只会换来一个点了没反应的条目，所以入口就拒掉。
 *
 * localStorage 是用户可改的，读回来的一律按不可信处理：形状不对的条目丢弃，
 * 而不是让它们带着 `undefined` 流进 `handleOpenFile`。
 */

export interface RestorableTab {
  id: string;
  label: string;
  filePath: string;
  /** 只有 `git-graph` 是该模块认得的非文件 tab；文件 tab 不带 kind。 */
  kind?: "git-graph";
}

/** 概览里最多列多少条历史 —— 再多就不会有人往下找了。 */
export const RECENT_CLOSED_LIMIT = 10;

export const RECENT_CLOSED_STORAGE_KEY = "pi-web:recent-closed-tabs";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 能否从快照重开。文件 tab（无 kind）与 git-graph 可以；
 * 终端 / 浏览器 / 会话分支 tab 不行（见文件头注释）。
 */
export function isRestorableTab(tab: { id: string; filePath?: string; kind?: string }): boolean {
  if (!tab.filePath) return false;
  return tab.kind === undefined || tab.kind === "git-graph";
}

/**
 * 记录一个刚关闭的 tab。同一个 id 只保留最新一条（关掉再关掉不该出现两条），
 * 新条目排在最前，超出上限的从尾部丢弃。
 */
export function recordClosedTab(
  list: readonly RestorableTab[],
  tab: { id: string; label: string; filePath?: string; kind?: string },
): RestorableTab[] {
  if (!isRestorableTab(tab) || !tab.filePath) return [...list];
  const entry: RestorableTab = {
    id: tab.id,
    label: tab.label,
    filePath: tab.filePath,
    ...(tab.kind === "git-graph" ? { kind: "git-graph" as const } : {}),
  };
  const deduped = list.filter((item) => item.id !== entry.id);
  return [entry, ...deduped].slice(0, RECENT_CLOSED_LIMIT);
}

/** 从历史里移除一条（例如它已经被重新打开了）。 */
export function forgetClosedTab(list: readonly RestorableTab[], id: string): RestorableTab[] {
  return list.filter((item) => item.id !== id);
}

/**
 * 把存储里的任意值收敛成合法历史：非数组、形状不对的条目、重复 id 一律丢弃。
 */
export function parseRecentClosedTabs(raw: unknown): RestorableTab[] {
  if (!Array.isArray(raw)) return [];
  const out: RestorableTab[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const candidate = item as Partial<RestorableTab>;
    if (typeof candidate.id !== "string" || !candidate.id) continue;
    if (typeof candidate.filePath !== "string" || !candidate.filePath) continue;
    if (typeof candidate.label !== "string") continue;
    if (candidate.kind !== undefined && candidate.kind !== "git-graph") continue;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push({
      id: candidate.id,
      label: candidate.label,
      filePath: candidate.filePath,
      ...(candidate.kind === "git-graph" ? { kind: "git-graph" as const } : {}),
    });
    if (out.length >= RECENT_CLOSED_LIMIT) break;
  }
  return out;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 读取历史；无存储、无值或 JSON 坏了都返回空数组。 */
export function loadRecentClosedTabs(storage: StorageLike | null = getBrowserStorage()): RestorableTab[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_CLOSED_STORAGE_KEY);
    if (!raw) return [];
    return parseRecentClosedTabs(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** 写入历史；存储不可用时静默跳过（隐私模式下 localStorage 会抛）。 */
export function saveRecentClosedTabs(
  list: readonly RestorableTab[],
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(RECENT_CLOSED_STORAGE_KEY, JSON.stringify(list.slice(0, RECENT_CLOSED_LIMIT)));
  } catch {
    /* 存储是可选能力，写不进去不影响本次会话 */
  }
}
