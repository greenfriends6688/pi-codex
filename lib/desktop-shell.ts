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

/**
 * Height of the strip the macOS traffic lights need at the top of the window.
 *
 * The lights sit at `{x: 14, y: 16}` and are ~62×14px, so the app's own bars must
 * start below them — otherwise the sidebar's brand text is drawn underneath the close
 * button. Every top-level panel header adds this inset in the desktop shell, so all
 * three columns keep their headers aligned.
 */
export function desktopTitleBarInset(platform: string | undefined = getDesktopBridge()?.platform): number {
  return platform === "darwin" ? 28 : 0;
}
