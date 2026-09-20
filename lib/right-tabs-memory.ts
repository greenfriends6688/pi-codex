import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";

/**
 * fork:right-tabs-memory — 右栏文件 tab 按工作区分槽记忆。
 *
 * 之前文件 tab 只活在内存里：切到别的工作区再切回来，之前开的一堆文件全没了
 * （终端/浏览器 tab 走的是 sessionStorage，也不分工作区）。这里按工作区 key 存
 * 「文件 tab 列表 + 激活项」，与 `lib/workspace-memory.ts` 的 last-open-session
 * 同一套 key 约定。
 *
 * 只存文件 tab：终端 tab 持有活 PTY、浏览器 tab 有独立恢复路径，都不适合序列化。
 *
 * 读进来的东西**一律逐字段校验**：旧版本写的、手改的、写了一半的 JSON 绝不能以
 * 畸形 tab 进入面板（REF 的 right-tabs-memory 踩过这个坑，这里照抄它的严格度）。
 */

export interface StoredFileTab {
  id: string;
  label: string;
  filePath: string;
  sourceSessionId: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

export interface RightTabsMemory {
  fileTabs: StoredFileTab[];
  activeTabId: string | null;
}

const STORAGE_KEY = "pi-web:right-tabs-by-workspace";
const DISPLAY_MODES: readonly FileViewerDisplayMode[] = ["source", "preview", "diff"];

function isDisplayMode(value: unknown): value is FileViewerDisplayMode {
  return typeof value === "string" && DISPLAY_MODES.includes(value as FileViewerDisplayMode);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeViewerState(value: unknown): FileViewerState | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (!isDisplayMode(raw.displayMode)) return undefined;
  if (typeof raw.wrapLines !== "boolean") return undefined;
  const scrollTop = finiteNumber(raw.scrollTop);
  const scrollLeft = finiteNumber(raw.scrollLeft);
  if (scrollTop === undefined || scrollLeft === undefined) return undefined;
  return { displayMode: raw.displayMode, wrapLines: raw.wrapLines, scrollTop, scrollLeft };
}

function sanitizeFileTab(value: unknown): StoredFileTab | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.filePath !== "string" || raw.filePath.length === 0) return null;
  const viewerState = sanitizeViewerState(raw.viewerState);
  return {
    id: raw.id,
    label: typeof raw.label === "string" && raw.label ? raw.label : raw.filePath,
    filePath: raw.filePath,
    sourceSessionId: typeof raw.sourceSessionId === "string" ? raw.sourceSessionId : null,
    ...(isDisplayMode(raw.initialDisplayMode) ? { initialDisplayMode: raw.initialDisplayMode } : {}),
    ...(viewerState ? { viewerState } : {}),
    ...(finiteNumber(raw.viewerRevision) !== undefined ? { viewerRevision: finiteNumber(raw.viewerRevision) } : {}),
  };
}

/** 结构校验：任何一处不合法就丢弃该项，绝不让畸形数据进面板。 */
export function sanitizeRightTabs(value: unknown): RightTabsMemory | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const fileTabs = Array.isArray(raw.fileTabs)
    ? raw.fileTabs.map(sanitizeFileTab).filter((tab): tab is StoredFileTab => tab !== null)
    : [];
  const activeTabId = typeof raw.activeTabId === "string" && fileTabs.some((tab) => tab.id === raw.activeTabId)
    ? raw.activeTabId
    : fileTabs.at(-1)?.id ?? null;
  return { fileTabs, activeTabId };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(storage: StorageLike): Record<string, unknown> {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function loadRightTabs(
  workspaceKey: string,
  storage: StorageLike | null = getBrowserStorage(),
): RightTabsMemory | null {
  if (!storage || !workspaceKey) return null;
  return sanitizeRightTabs(readAll(storage)[workspaceKey]);
}

export function saveRightTabs(
  workspaceKey: string,
  memory: RightTabsMemory,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !workspaceKey) return;
  const all = readAll(storage);
  if (memory.fileTabs.length === 0) {
    // 空列表就删槽位，别在 localStorage 里留一堆空对象。
    delete all[workspaceKey];
  } else {
    all[workspaceKey] = memory;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 隐私模式 / 配额不足：记忆能力降级，不影响使用。
  }
}
