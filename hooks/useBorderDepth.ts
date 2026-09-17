"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  BORDER_DEPTH_DEFAULT,
  BORDER_ORIG_VARS,
  BORDER_STEP_OFFSETS,
  borderDepthNeedsOverride,
  borderDepthValue,
  clampBorderDepth,
  parseStoredBorderDepth,
  stepDepth,
} from "@/lib/border-depth";

/**
 * Border-depth slider state.
 *
 * Re-blends the Codex hairline ladder (`--border-faint` / `--border` /
 * `--border-strong`) between "invisible" (0), "theme default" (50) and "maximum
 * contrast" (100). The blend always starts from the `*-orig` snapshots rather
 * than the live values, so dragging can never compound the blend.
 *
 * `borderDepthValue()` is the pure part (see lib/border-depth.ts); this hook owns
 * the DOM side effects and persistence.
 */

const STORAGE_KEY = "pi-border-depth";

const listeners = new Set<() => void>();
let depth: number | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStored(): number {
  if (typeof window === "undefined") return BORDER_DEPTH_DEFAULT;
  try {
    return parseStoredBorderDepth(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return BORDER_DEPTH_DEFAULT;
  }
}

function ensureDepth(): number {
  if (depth === null) depth = readStored();
  return depth;
}

/**
 * Ensure `--border-*-orig` are populated.
 *
 * For a pi CLI theme they are written by `applyPiThemeVars()`. For a pure Codex
 * palette nothing has snapshotted them yet, so read the computed cascade value
 * once and cache it — otherwise the slider has no source colour to blend from.
 */
function ensureBorderOrig(): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const pairs: Array<[string, string]> = [
    ["--border-orig", "--border"],
    ["--border-strong-orig", "--border-strong"],
    ["--border-faint-orig", "--border-faint"],
  ];
  const computed = pairs.some(([orig]) => !el.style.getPropertyValue(orig).trim())
    ? getComputedStyle(el)
    : null;
  for (const [orig, live] of pairs) {
    if (el.style.getPropertyValue(orig).trim()) continue;
    const value = computed?.getPropertyValue(live).trim() ?? "";
    if (value) el.style.setProperty(orig, value);
  }
}

function applyDepth(next: number): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  ensureBorderOrig();

  for (const cssVar of Object.keys(BORDER_STEP_OFFSETS)) {
    const origVar = `${cssVar}-orig`;
    const value = borderDepthValue(origVar, stepDepth(next, cssVar));
    if (value) el.style.setProperty(cssVar, value);
    else el.style.removeProperty(cssVar);
  }
}

/** Remove the inline overrides so the palette's own borders come back. */
function clearDepthOverrides(): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  for (const cssVar of Object.keys(BORDER_STEP_OFFSETS)) el.style.removeProperty(cssVar);
}

/** Re-snapshot the originals (called after a theme change). */
export function resetBorderDepthSnapshot(): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  for (const token of BORDER_ORIG_VARS) el.style.removeProperty(token);
  ensureDepth();
}

export function applyStoredBorderDepth(): void {
  const current = ensureDepth();
  if (borderDepthNeedsOverride(current)) applyDepth(current);
}

export function useBorderDepth() {
  const current = useSyncExternalStore(subscribe, ensureDepth, () => BORDER_DEPTH_DEFAULT);

  const setBorderDepth = useCallback((value: number) => {
    const next = clampBorderDepth(value);
    depth = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // storage unavailable — the value still applies for this session
    }
    applyDepth(next);
    emit();
  }, []);

  return { borderDepth: current, setBorderDepth };
}

/** Non-hook accessor for save handlers outside the settings panel. */
export function getBorderDepth(): number {
  return ensureDepth();
}

export { clearDepthOverrides };
