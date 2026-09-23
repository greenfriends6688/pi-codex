/**
 * fork:ui-project-actions — 项目行的本地偏好：**显示名**与**从列表中移除**。
 *
 * 侧栏的项目列表是从会话的 cwd 推出来的（`lib/recent-projects.ts`），所以「项目」本身
 * 没有可写的配置。Zeno 在 `project-prefs.ts` 里用一张 localStorage 表解决同一问题
 * （`loadProjectAliases` / `hidden`），这里照同样的形状做小一号的版本：
 *
 *   { aliases: { [root]: 显示名 }, hidden: [root, ...] }
 *
 * 键用**项目根路径**（不是 key）：key 是服务端按平台归一化过的，而别名/隐藏是纯前端概念，
 * 跟着路径走更直观，也和「打开文件夹」用的路径一致。
 */

import { useCallback, useSyncExternalStore } from "react";

export const PROJECT_PREFS_STORAGE_KEY = "pi-project-prefs";
const CHANGE_EVENT = "pi-project-prefs-change";

export interface ProjectPrefs {
  aliases: Record<string, string>;
  hidden: string[];
}

const EMPTY: ProjectPrefs = { aliases: {}, hidden: [] };

export function parseProjectPrefs(raw: string | null): ProjectPrefs {
  if (!raw) return { ...EMPTY, aliases: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY, aliases: {} };
    const record = parsed as Record<string, unknown>;
    const aliases: Record<string, string> = {};
    if (record.aliases && typeof record.aliases === "object" && !Array.isArray(record.aliases)) {
      for (const [root, name] of Object.entries(record.aliases as Record<string, unknown>)) {
        if (root && typeof name === "string" && name.trim()) aliases[root] = name.trim();
      }
    }
    const hidden = Array.isArray(record.hidden)
      ? [...new Set(record.hidden.filter((item): item is string => typeof item === "string" && item.length > 0))]
      : [];
    return { aliases, hidden };
  } catch {
    return { ...EMPTY, aliases: {} };
  }
}

/** 项目行的显示名：有别名用别名，否则用目录名。 */
export function projectDisplayName(root: string, prefs: ProjectPrefs): string {
  const alias = prefs.aliases[root];
  if (alias) return alias;
  return root.split(/[/\\]/).filter(Boolean).at(-1) ?? root;
}

/** 过滤掉「从列表中移除」过的项目（当前选中的那个始终保留，否则会看不见自己在哪）。 */
export function filterHiddenProjects<T extends { root: string }>(
  projects: readonly T[],
  prefs: ProjectPrefs,
  keepRoot?: string | null,
): T[] {
  if (prefs.hidden.length === 0) return [...projects];
  const hidden = new Set(prefs.hidden);
  return projects.filter((project) => !hidden.has(project.root) || project.root === keepRoot);
}

let cache: ProjectPrefs | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

function read(): ProjectPrefs {
  if (typeof window === "undefined") return EMPTY;
  try {
    return parseProjectPrefs(window.localStorage.getItem(PROJECT_PREFS_STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function ensure(): ProjectPrefs {
  if (cache === null) cache = read();
  return cache;
}

function write(next: ProjectPrefs): void {
  cache = next;
  try {
    window.localStorage.setItem(PROJECT_PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用：本次会话内仍然生效
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PROJECT_PREFS_STORAGE_KEY) return;
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

export function useProjectPrefs() {
  const prefs = useSyncExternalStore(subscribe, ensure, () => EMPTY);

  const setAlias = useCallback((root: string, name: string) => {
    const current = ensure();
    const aliases = { ...current.aliases };
    const trimmed = name.trim();
    if (trimmed) aliases[root] = trimmed;
    else delete aliases[root];
    write({ ...current, aliases });
  }, []);

  const hideProject = useCallback((root: string) => {
    const current = ensure();
    if (current.hidden.includes(root)) return;
    write({ ...current, hidden: [...current.hidden, root] });
  }, []);

  const restoreProject = useCallback((root: string) => {
    const current = ensure();
    if (!current.hidden.includes(root)) return;
    write({ ...current, hidden: current.hidden.filter((item) => item !== root) });
  }, []);

  return { prefs, setAlias, hideProject, restoreProject };
}
