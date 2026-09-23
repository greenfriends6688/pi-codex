"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  UI_FONT_SIZE_DEFAULT,
  UI_FONT_SIZE_STORAGE_KEY,
  UI_FONT_STORAGE_KEY,
  parseStoredUiFontSize,
  parseStoredUiFontStack,
} from "@/lib/ui-font";

/**
 * fork:zn-18 — 界面字体 / 界面字号（DOM 副作用 + 持久化），
 * 与 `useUiDensity` / `useRailTranslucent` 同形。
 *
 * 字体栈写在内联的 `--font-ui-base` 上（不是 CSS 属性选择器）：选项是运行时
 * 枚举出来的任意族名，不可能预先在 CSS 里列出来。
 */

const listeners = new Set<() => void>();
let state: { stack: string; size: number } | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStored(): { stack: string; size: number } {
  if (typeof window === "undefined") return { stack: "", size: UI_FONT_SIZE_DEFAULT };
  try {
    return {
      stack: parseStoredUiFontStack(window.localStorage.getItem(UI_FONT_STORAGE_KEY)),
      size: parseStoredUiFontSize(window.localStorage.getItem(UI_FONT_SIZE_STORAGE_KEY)),
    };
  } catch {
    return { stack: "", size: UI_FONT_SIZE_DEFAULT };
  }
}

function ensureState(): { stack: string; size: number } {
  if (state === null) state = readStored();
  return state;
}

export function applyUiFont(next: { stack: string; size: number }): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // 空栈 = 系统默认：移除内联值，回到 globals.css 的字体栈。
  if (next.stack) root.style.setProperty("--font-ui-base", next.stack);
  else root.style.removeProperty("--font-ui-base");
  root.style.setProperty("--ui-font-size", `${next.size}px`);
}

export function applyStoredUiFont(): void {
  applyUiFont(ensureState());
}

export function useUiFont() {
  const current = useSyncExternalStore(subscribe, ensureState, () => ({
    stack: "",
    size: UI_FONT_SIZE_DEFAULT,
  }));

  const commit = useCallback((next: { stack: string; size: number }) => {
    state = next;
    try {
      window.localStorage.setItem(UI_FONT_STORAGE_KEY, next.stack || "system");
      window.localStorage.setItem(UI_FONT_SIZE_STORAGE_KEY, String(next.size));
    } catch {
      // 存储不可用时本次会话仍然生效
    }
    applyUiFont(next);
    emit();
  }, []);

  return {
    fontStack: current.stack,
    fontSize: current.size,
    setFontStack: useCallback(
      (stack: string) => commit({ stack, size: ensureState().size }),
      [commit],
    ),
    setFontSize: useCallback(
      (size: number) => commit({ stack: ensureState().stack, size }),
      [commit],
    ),
  };
}
