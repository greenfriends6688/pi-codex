"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  UI_DENSITY_DEFAULT,
  UI_DENSITY_STORAGE_KEY,
  parseStoredUiDensity,
  uiDensityCssValue,
  type UiDensity,
} from "@/lib/ui-density";

/**
 * fork:ui-22 — interface density state (DOM side effects + persistence).
 *
 * Same shape as `useBorderDepth`: a module-level store so every reader sees the
 * same value through `useSyncExternalStore`, an inline CSS variable on
 * `<html>` as the only side effect, and localStorage as the only persistence.
 * The pure part (steps, factors, parsing) lives in `lib/ui-density.ts`.
 */

const listeners = new Set<() => void>();
let density: UiDensity | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStored(): UiDensity {
  if (typeof window === "undefined") return UI_DENSITY_DEFAULT;
  try {
    return parseStoredUiDensity(window.localStorage.getItem(UI_DENSITY_STORAGE_KEY));
  } catch {
    return UI_DENSITY_DEFAULT;
  }
}

function ensureDensity(): UiDensity {
  if (density === null) density = readStored();
  return density;
}

/**
 * Write the factor. The variable is always set (never removed) so a switch back
 * to "standard" cannot leave the previous multiplier in the cascade.
 */
export function applyUiDensity(next: UiDensity): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--fork-density", uiDensityCssValue(next));
  document.documentElement.dataset.density = next;
}

/** Called once on app start; safe on the server (no-op without a document). */
export function applyStoredUiDensity(): void {
  applyUiDensity(ensureDensity());
}

export function useUiDensity() {
  const current = useSyncExternalStore(subscribe, ensureDensity, () => UI_DENSITY_DEFAULT);

  const setUiDensity = useCallback((value: UiDensity) => {
    density = parseStoredUiDensity(value);
    try {
      window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, density);
    } catch {
      // storage unavailable — the value still applies for this session
    }
    applyUiDensity(density);
    emit();
  }, []);

  return { uiDensity: current, setUiDensity };
}
