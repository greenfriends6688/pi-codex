/**
 * fork:dsn-dialog-a11y — 弹层焦点管理的纯逻辑部分（可在 Node 里单测）。
 *
 * 背景（`docs/design-audit-impeccable-2026-09-18.md` A11y-2）：
 * 本项目有若干自绘弹层，其中 `ConfigPanelShell`（modal 模式）与 `ModelsConfig`
 * 已经写了 `role="dialog" aria-modal="true"`，但**没有焦点约束**——
 * 键盘用户 Tab 会走到弹层背后的侧栏/输入框，屏幕阅读器不会播报进入弹层，
 * Esc 也只在焦点恰好落在容器上时才生效。全仓没有任何 focus trap 工具。
 *
 * 这里只放可以在没有 DOM 的情况下验证的判定：
 * 可聚焦候选的过滤规则、Tab 循环的下标计算、关闭键判定。
 * DOM 操作（querySelectorAll / focus / inert）留在 `hooks/useDialogA11y.ts`。
 */

/** 常见可聚焦元素。用于 querySelectorAll 粗筛，再由 isFocusableCandidate 精筛。 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "summary",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

export interface FocusCandidateInfo {
  /** disabled 属性（表单控件）。 */
  disabled?: boolean;
  /** 显式 tabindex；负值表示只能被脚本聚焦。 */
  tabIndex?: number;
  /** hidden 属性或 aria-hidden="true"。 */
  hidden?: boolean;
  /** 计算样式里的 display:none / visibility:hidden（由调用方读，因为这里不碰 DOM）。 */
  invisible?: boolean;
}

/**
 * 是否把该元素纳入 Tab 循环。
 * 与浏览器默认行为的差别：显式 `tabindex="-1"` 的元素会被排除（浏览器也会跳过），
 * 但 `aria-hidden="true"` 的元素**要排除**——浏览器仍会聚焦它，那是 a11y bug 的来源。
 */
export function isFocusableCandidate(info: FocusCandidateInfo): boolean {
  if (info.disabled) return false;
  if (info.hidden) return false;
  if (info.invisible) return false;
  if (typeof info.tabIndex === "number" && info.tabIndex < 0) return false;
  return true;
}

/**
 * Tab / Shift+Tab 在弹层内部循环时的目标下标。
 * `current` 为 -1 表示当前焦点不在任何候选项上（例如刚打开时）。
 */
export function nextFocusIndex(current: number, total: number, shift: boolean): number {
  if (total <= 0) return -1;
  if (current < 0 || current >= total) return shift ? total - 1 : 0;
  return shift ? (current - 1 + total) % total : (current + 1) % total;
}

/** 关闭键：只认 Escape（与原生 `<dialog>` 一致）。 */
export function isDialogCloseKey(key: string): boolean {
  return key === "Escape";
}

/** Tab 前进/后退判定（只认 Tab，不认 Ctrl+Tab 之类的组合）。 */
export function isTabKey(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey;
}
