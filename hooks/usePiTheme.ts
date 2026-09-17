"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ResolvedTheme, ThemeSetInfo, ThemeVariant } from "@/lib/pi-theme";
import { BORDER_ORIG_VARS } from "@/lib/border-depth";
import { applyStoredBorderDepth, clearDepthOverrides, resetBorderDepthSnapshot } from "@/hooks/useBorderDepth";
import {
  PI_THEME_ATTR,
  PI_THEME_CACHE_KEY,
  PI_THEME_CSS_VARS,
  PI_THEME_CWD_KEY,
  PI_THEME_NAME_KEY,
} from "@/lib/pi-theme-client";

/**
 * pi CLI theme state (layering engine).
 *
 * The six Codex palettes stay owned by `hooks/useTheme.ts` via `data-theme`. This
 * store layers an optional pi CLI theme on top by writing **inline** custom
 * properties onto `<html>`, which win over the palette block by specificity.
 *
 * Invariants that matter:
 *  1. `clearPiThemeVars()` removes *every* token in `PI_THEME_CSS_VARS`. Skipping
 *     one leaves a stale inline colour behind after switching back to a Codex
 *     palette — the classic layering bug.
 *  2. The resolved CSS is cached in `localStorage` under `name::mode` so the
 *     pre-paint bootstrap can re-apply it synchronously (no flash of the Codex
 *     palette on reload). The server round-trip only happens on a cache miss.
 *  3. `.dark` is kept in sync with the pi theme's own polarity, because
 *     `color-scheme` and Tailwind's `dark:` variants read that class.
 */

export const PI_THEME_CHANGED_EVENT = "pi-pi-theme-changed";

interface PiThemeState {
  /** Active pi theme set name, or "" when the Codex palettes are in charge. */
  name: string;
  /** Polarity of the active pi theme (irrelevant when name is empty). */
  isDark: boolean;
}

const SERVER_SNAPSHOT: PiThemeState = { name: "", isDark: true };

const listeners = new Set<() => void>();
let state: PiThemeState | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

// --- Inline CSS variables ---------------------------------------------------

function applyPiThemeVars(vars: Record<string, string>): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  for (const token of PI_THEME_CSS_VARS) {
    const value = vars[token];
    if (value) el.style.setProperty(token, value);
    else el.style.removeProperty(token);
  }
  // Snapshot the fresh values for the border-depth slider. Without this the
  // slider would blend from the previous theme's border colour.
  snapshotBorderOrig();
  // The theme just replaced the live hairlines, so the slider's blend has to be
  // re-applied on top of them — otherwise the border depth silently reverts to
  // the theme default every time a theme is (re)applied.
  applyStoredBorderDepth();
}

export function clearPiThemeVars(): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  for (const token of PI_THEME_CSS_VARS) el.style.removeProperty(token);
  for (const token of BORDER_ORIG_VARS) el.style.removeProperty(token);
  // Remove the depth blend before re-snapshotting, otherwise the stale inline
  // `--border*` values would become the new "original" for the Codex palette.
  clearDepthOverrides();
  resetBorderDepthSnapshot();
  applyStoredBorderDepth();
}

function snapshotBorderOrig(): void {
  const el = document.documentElement;
  el.style.setProperty("--border-orig", el.style.getPropertyValue("--border").trim());
  el.style.setProperty("--border-strong-orig", el.style.getPropertyValue("--border-strong").trim());
  el.style.setProperty("--border-faint-orig", el.style.getPropertyValue("--border-faint").trim());
}

// --- Resolution + cache -----------------------------------------------------

/** Theme sets live in `~/.pi/themes`, but also in `<cwd>/.pi/themes` — the server
 *  needs the cwd to pick the right one, and a project-local theme must not be
 *  answered with the bundled theme of the same name. */
let activeCwd: string | null = readStoredCwd();

function readStoredCwd(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PI_THEME_CWD_KEY) || null;
  } catch {
    return null;
  }
}

/** `undefined` means "the caller has no opinion" and keeps the remembered cwd. */
function rememberCwd(cwd?: string | null): void {
  if (cwd === undefined) return;
  activeCwd = cwd || null;
  try {
    if (activeCwd) window.localStorage.setItem(PI_THEME_CWD_KEY, activeCwd);
    else window.localStorage.removeItem(PI_THEME_CWD_KEY);
  } catch {
    // best-effort
  }
}

function resolvedMode(): ThemeVariant {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function readCache(): Record<string, Record<string, string>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PI_THEME_CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, Record<string, string>>;
  } catch {
    return {};
  }
}

function writeCache(key: string, vars: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    const cache = readCache();
    cache[key] = vars;
    const keys = Object.keys(cache);
    // Keep the cache bounded — themes are small but this is user-tier storage.
    for (const stale of keys.slice(0, Math.max(0, keys.length - 24))) delete cache[stale];
    window.localStorage.setItem(PI_THEME_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // best-effort
  }
}

/** Synchronously peel a cached resolution so the first paint has no flash. */
function readCachedVars(key: string): Record<string, string> | null {
  return readCache()[key] ?? null;
}

const inflight = new Map<string, Promise<ResolvedTheme | null>>();

async function fetchTheme(name: string, mode: ThemeVariant): Promise<ResolvedTheme | null> {
  const key = activeCwd ? `${activeCwd}::${name}::${mode}` : `${name}::${mode}`;
  const cached = readCachedVars(key);
  if (cached) return { name, isDark: mode === "dark", cssVars: cached };

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const query = new URLSearchParams({ mode });
      if (activeCwd) query.set("cwd", activeCwd);
      const response = await fetch(
        `/api/themes/${encodeURIComponent(name)}?${query.toString()}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as ResolvedTheme;
      if (!data || typeof data.cssVars !== "object") return null;
      writeCache(key, data.cssVars);
      // The pre-paint bootstrap cannot know the cwd, so the applied variant is
      // also kept under the plain name::mode key it looks up.
      writeCache(`${name}::${mode}`, data.cssVars);
      return data;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

// --- State ------------------------------------------------------------------

function readStoredName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PI_THEME_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function ensureState(): PiThemeState {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  if (state) return state;
  const name = readStoredName();
  state = { name, isDark: name ? resolvedMode() === "dark" : true };
  return state;
}

/** Apply a theme's variables and sync the `.dark` class + state. */
function commit(name: string, isDark: boolean, vars: Record<string, string> | null): void {
  const el = typeof document !== "undefined" ? document.documentElement : null;
  if (el) {
    if (name) {
      el.setAttribute(PI_THEME_ATTR, name);
      if (vars) applyPiThemeVars(vars);
      el.classList.toggle("dark", isDark);
    } else {
      el.removeAttribute(PI_THEME_ATTR);
      clearPiThemeVars();
      // The Codex palette owns `.dark`; re-apply it from `data-theme`.
      const codex = el.dataset.theme ?? "";
      el.classList.toggle("dark", codex === "dark" || codex === "pine");
    }
  }
  state = { name, isDark };
  try {
    if (name) window.localStorage.setItem(PI_THEME_NAME_KEY, name);
    else window.localStorage.removeItem(PI_THEME_NAME_KEY);
  } catch {
    // best-effort
  }
  emit();
}

// --- Bootstrap (pre-paint) --------------------------------------------------
// The inline script lives in lib/pi-theme-client.ts (a non-client module) because
// app/layout.tsx is a server component and cannot pull a string out of a client
// boundary module.

// --- Hook -------------------------------------------------------------------

/** Re-resolve the active pi theme for a new light/dark mode.
 *
 * Module-level so `hooks/useTheme.ts` can call it when the Codex mode flips
 * without having to reach into React context. */
export async function refreshPiThemeForMode(isDark: boolean): Promise<void> {
  const current = ensureState();
  if (!current.name) return;
  const mode: ThemeVariant = isDark ? "dark" : "light";
  const resolved = await fetchTheme(current.name, mode);
  if (!resolved) {
    // The theme has no usable variant for this mode — fall back to the Codex
    // palette rather than leaving a half-applied overlay behind.
    commit("", true, null);
    return;
  }
  commit(current.name, resolved.isDark, resolved.cssVars);
}

export function usePiTheme() {
  const snapshot = useSyncExternalStore(subscribe, ensureState, () => SERVER_SNAPSHOT);

  const setPiTheme = useCallback(async (name: string, cwd?: string | null) => {
    rememberCwd(cwd);
    if (!name) {
      commit("", true, null);
      return;
    }
    const mode = resolvedMode();
    // Paint from cache immediately, then confirm with the server.
    const cached = readCachedVars(activeCwd ? `${activeCwd}::${name}::${mode}` : `${name}::${mode}`);
    if (cached) {
      commit(name, mode === "dark", cached);
      return;
    }
    const resolved = await fetchTheme(name, mode);
    if (!resolved) {
      // Leave the current theme untouched rather than half-applying one.
      return;
    }
    commit(name, resolved.isDark, resolved.cssVars);
  }, []);

  return {
    /** Active pi theme set name, or "" when the Codex palettes are in charge. */
    piThemeName: snapshot.name,
    setPiTheme,
    refreshForMode: refreshPiThemeForMode,
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Non-hook accessor for callers outside React (settings save handlers, tests). */
export function getPiThemeState(): PiThemeState {
  return ensureState();
}

/** Fetch the available theme sets for the settings UI. */
export async function loadThemeSets(cwd?: string | null): Promise<ThemeSetInfo[]> {
  try {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    const response = await fetch(`/api/themes${query}`, { cache: "no-store" });
    if (!response.ok) return [];
    const data = (await response.json()) as { themeSets?: ThemeSetInfo[] };
    return Array.isArray(data.themeSets) ? data.themeSets : [];
  } catch {
    return [];
  }
}
