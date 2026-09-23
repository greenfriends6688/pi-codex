"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  RAIL_TRANSLUCENT_DEFAULT,
  RAIL_TRANSLUCENT_STORAGE_KEY,
  parseStoredRailTranslucent,
} from "@/lib/rail-prefs";

/**
 * fork:zn-15 — 侧边栏半透明状态（DOM 副作用 + 持久化）。
 *
 * 与 `useUiDensity` / `useBorderDepth` 同形：模块级 store 让所有读者通过
 * `useSyncExternalStore` 看到同一个值，唯一副作用是 `<html>` 上的 data 属性，
 * 唯一持久化是 localStorage。样式规则在 `app/fork-ui.css`。
 */

const listeners = new Set<() => void>();
let translucent: boolean | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStored(): boolean {
  if (typeof window === "undefined") return RAIL_TRANSLUCENT_DEFAULT;
  try {
    return parseStoredRailTranslucent(window.localStorage.getItem(RAIL_TRANSLUCENT_STORAGE_KEY));
  } catch {
    return RAIL_TRANSLUCENT_DEFAULT;
  }
}

function ensureValue(): boolean {
  if (translucent === null) translucent = readStored();
  return translucent;
}

/** 写在 `<html>` 上而不是侧栏元素上：侧栏底色是内联样式，靠选择器覆盖更稳。 */
export function applyRailTranslucent(next: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.railTranslucent = next ? "true" : "false";
}

/** 应用启动时调用一次；服务端无 document 时为 no-op。 */
export function applyStoredRailTranslucent(): void {
  applyRailTranslucent(ensureValue());
}

export function useRailTranslucent() {
  const current = useSyncExternalStore(subscribe, ensureValue, () => RAIL_TRANSLUCENT_DEFAULT);

  const setRailTranslucent = useCallback((value: boolean) => {
    translucent = value === true;
    try {
      window.localStorage.setItem(RAIL_TRANSLUCENT_STORAGE_KEY, translucent ? "1" : "0");
    } catch {
      // 存储不可用时本次会话仍然生效
    }
    applyRailTranslucent(translucent);
    emit();
  }, []);

  return { railTranslucent: current, setRailTranslucent };
}
