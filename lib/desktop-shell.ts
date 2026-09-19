"use client";

/**
 * fork:desktop-shell — the optional bridge to the Electron shell.
 *
 * The web app must stay a web app: everything here is additive and guarded, so the
 * browser build behaves exactly as before. What the packaged app gains:
 *
 *   - native notifications (they work while the window is hidden, which is precisely
 *     when the app notifies);
 *   - a Dock badge for unread conversations;
 *   - keep-awake while an agent run is in flight;
 *   - the drag region that makes a hidden-title-bar window movable.
 *
 * The bridge is injected by `electron/preload.js` via contextBridge, so its absence is
 * the single reliable "am I in the desktop shell" test.
 */

export type DesktopAction =
  | { kind: "notification-clicked"; url: string }
  | { kind: "theme-changed"; dark: boolean }
  | { kind: "open-session"; sessionId: string };

export interface DesktopBridge {
  version: number;
  platform: string;
  notify(payload: { title?: string; body?: string; tag?: string; url?: string; silent?: boolean }): Promise<boolean>;
  setBadge(text: string | null): void;
  setKeepAwake(active: boolean): void;
  openExternal(url: string): void;
  revealPath(target: string): void;
  /**
   * fork:gap07-attachments — 拖入文件的真实磁盘路径。
   *
   * 浏览器拿不到 `File` 的路径（安全限制），桌面外壳可以（`webUtils.getPathForFile`）。
   * 只有拿到路径，超过上传上限的文件才能「就地引用」而不是被跳过。
   */
  filePathFor?(file: File): string | null;
  onAction(callback: (action: DesktopAction) => void): () => void;
}

declare global {
  interface Window {
    piWebDesktop?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.piWebDesktop ?? null;
}

export function isDesktopShell(): boolean {
  return getDesktopBridge() !== null;
}

/**
 * fork:gap07-attachments — 拿拖入文件的本地路径；浏览器里恒返回 `null`。
 *
 * 桥不可用、旧版外壳没有这个方法、或 Electron 拒绝这个 File（例如它来自
 * `new File([...])` 而不是真实拖拽）时，都会安静地退到 `null` —— 调用方据此走上传，
 * 而不是抛错。
 */
export function desktopFilePathFor(file: File | null | undefined): string | null {
  if (!file) return null;
  const bridge = getDesktopBridge();
  if (!bridge?.filePathFor) return null;
  try {
    const path = bridge.filePathFor(file);
    return typeof path === "string" && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Leading inset the app's top bar must leave for the macOS traffic lights when the
 * title bar is hidden. The web layout already reserves one icon button; the window
 * controls need ~64px more.
 */
export function desktopTrafficLightInset(platform: string | undefined = getDesktopBridge()?.platform): number {
  return platform === "darwin" ? 64 : 0;
}

/**
 * Marks `<html>` so CSS can add the drag region. Called once from AppShell's mount
 * effect; harmless in the browser (no bridge → no attribute).
 */
export function markDesktopShell(): void {
  if (typeof document === "undefined") return;
  const bridge = getDesktopBridge();
  if (!bridge) return;
  document.documentElement.dataset.desktopShell = "true";
  document.documentElement.dataset.desktopPlatform = bridge.platform;
}

/** Dock badge helper that tolerates the browser (badges are macOS-only anyway). */
export function setDesktopBadge(count: number): void {
  getDesktopBridge()?.setBadge(count > 0 ? String(count) : null);
}

/** Hold the display awake for the duration of a run. */
export function setDesktopKeepAwake(active: boolean): void {
  getDesktopBridge()?.setKeepAwake(active);
}
