/**
 * fork:zn-20 — 侧栏「项目 / 聊天」两个分栏的选择。
 *
 * 单独一个模块而不是塞进 SessionSidebar：`useState(() => ...)` 的初值会在
 * 每次挂载时读一次 localStorage，读写逻辑放在纯函数里就能不起组件直接测。
 */

export const SIDEBAR_PANE_STORAGE_KEY = "pi-sidebar-pane";

export const SIDEBAR_PANE_VALUES = ["projects", "chat"] as const;
export type SidebarPane = (typeof SIDEBAR_PANE_VALUES)[number];

/** 项目在前：用户的要求，也是 Zeno 侧栏里「项目 → 对话」的顺序。 */
export const SIDEBAR_PANE_DEFAULT: SidebarPane = "projects";

export function parseSidebarPane(raw: string | null): SidebarPane {
  return SIDEBAR_PANE_VALUES.includes(raw as SidebarPane)
    ? (raw as SidebarPane)
    : SIDEBAR_PANE_DEFAULT;
}

export function readStoredSidebarPane(): SidebarPane {
  if (typeof window === "undefined") return SIDEBAR_PANE_DEFAULT;
  try {
    return parseSidebarPane(window.localStorage.getItem(SIDEBAR_PANE_STORAGE_KEY));
  } catch {
    return SIDEBAR_PANE_DEFAULT;
  }
}

export function writeStoredSidebarPane(pane: SidebarPane): void {
  try {
    window.localStorage.setItem(SIDEBAR_PANE_STORAGE_KEY, pane);
  } catch {
    // 存储不可用时本次会话仍然生效
  }
}
