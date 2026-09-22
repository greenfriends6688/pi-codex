// fork:zc-04 — rewritten around the central table in `lib/shortcuts.ts`.
"use client";

import { useEffect } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useShortcutBindings } from "@/hooks/useShortcutBindings";
import {
  isShortcutEventNoise,
  isShortcutRecordingActive,
  matchesAnyShortcutBinding,
  type ShortcutKeyboardEvent,
} from "@/lib/shortcuts";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Toggle wiring
// ---------------------------------------------------------------------------

/*
 * fork:zc-04 — sidebar / right-panel toggles are dispatched by clicking the
 * canonical toggle buttons AppShell already renders. Why not callbacks passed
 * into this hook: AppShell.tsx is owned by another pending patch and this
 * PR must not touch it. The buttons are the single source of the toggle action
 * (they already respect the mobile rules — closing the sidebar, clearing the
 * toolbar popover — that calling `setState` from here would duplicate and
 * eventually drift from). If AppShell later passes real callbacks, delete the
 * selectors and call them instead.
 */
// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when the "new session" binding is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
  /**
   * fork:zc-04 — 面板/主题开关直接调 AppShell 的句柄。
   *
   * 早先这里是用 CSS 选择器去找顶栏按钮再 `.click()`（当时 AppShell 归另一个补丁所有）。
   * 那是症状级做法：类名一改就静默失效，而且把「谁是单一真相」藏进了 DOM 结构里。
   * 现在 AppShell 直接传它自己的 handleSidebarToggle / handleRightPanelToggle，
   * 移动端规则（关侧栏、收工具条弹层）仍由那几个句柄统一负责，不在这里重复。
   */
  onToggleSidebar?: () => void;
  onToggleRightPanel?: () => void;
}

/**
 * Global keyboard dispatcher.
 *
 * Every key it owns comes from the central table in `lib/shortcuts.ts`, so the
 * settings page can list, rebind, conflict-check and reset them. The kernel
 * already filters IME composition (`keyCode 229`, `Process`, `Dead`) and
 * long-press `repeat`; this hook adds the context rules:
 *
 *   - while the settings recorder owns the keyboard, nothing is dispatched
 *     (otherwise recording a chord would also run the command it is bound to);
 *   - Esc inside <textarea>/<input> stays with ChatInput (its slash/@ menus
 *     and stop behaviour need the local menu state);
 *   - toggles go through the canonical AppShell buttons (see above).
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd, onToggleSidebar, onToggleRightPanel } = options;
  const { effective } = useShortcutBindings();
  const { theme, setThemePreference } = useTheme();

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (isShortcutRecordingActive()) return;
      if (isShortcutEventNoise(event as ShortcutKeyboardEvent)) return;
      if (event.isComposing) return;

      // ---- stopAgent (default Esc) ----
      if (matchesAnyShortcutBinding(event, effective.stopAgent ?? [])) {
        if (!globalAbortHandler) return;
        const tag = (event.target as HTMLElement | null)?.tagName;
        // Let textarea/input handle Esc internally (ChatInput menus / stop).
        if (tag === "TEXTAREA" || tag === "INPUT") return;
        event.preventDefault();
        globalAbortHandler();
        return;
      }

      // ---- newSession (default Ctrl+Alt+N) ----
      if (matchesAnyShortcutBinding(event, effective.newSession ?? [])) {
        if (!activeCwd || !onNewSession) return;
        event.preventDefault();
        onNewSession(activeCwd);
        return;
      }

      // ---- toggleSidebar / toggleRightPanel ----
      if (matchesAnyShortcutBinding(event, effective.toggleSidebar ?? [])) {
        if (!onToggleSidebar) return;
        event.preventDefault();
        onToggleSidebar();
        return;
      }
      if (matchesAnyShortcutBinding(event, effective.toggleRightPanel ?? [])) {
        if (!onToggleRightPanel) return;
        event.preventDefault();
        onToggleRightPanel();
        return;
      }

      // ---- toggleTheme ----
      if (matchesAnyShortcutBinding(event, effective.toggleTheme ?? [])) {
        event.preventDefault();
        setThemePreference(theme === "dark" ? "light" : "dark");
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, effective, onNewSession, onToggleRightPanel, onToggleSidebar, setThemePreference, theme]);
}
