"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  WALLPAPER_BUILTIN_KEY,
  WALLPAPER_CHANGED_EVENT,
  WALLPAPER_ENABLED_KEY,
  WALLPAPER_INPUT_MODE_KEY,
  WALLPAPER_MESSAGE_MODE_KEY,
  WALLPAPER_PANEL_MODE_KEY,
  WALLPAPER_SCRIM_DEFAULT,
  WALLPAPER_SCRIM_KEY,
  WALLPAPER_URL_KEY,
  clampScrim,
  fileToWallpaperDataUrl,
  parseAreaMode,
  readStoredBuiltinWallpaper,
  readStoredWallpaperUrl,
  type WallpaperAreaMode,
} from "@/lib/wallpaper";

/**
 * Wallpaper state.
 *
 * All of the feature's DOM effects live on `<html>` so the CSS in
 * `app/wallpaper.css` can key off them without touching the React tree:
 *
 *   data-wallpaper="on"           enabled
 *   data-wallpaper-ready="1"      image decoded (drives the fade-in)
 *   --wallpaper-scrim             scrim percentage
 *   data-wallpaper-{input,panel,message}   per-area effect mode
 *
 * The image itself is *not* a CSS variable (see the note in lib/wallpaper.ts) —
 * `components/WallpaperLayer.tsx` renders it into an `<img src>`.
 */

export interface WallpaperState {
  enabled: boolean;
  url: string;
  /** Chosen built-in id, or "" to fall back to the palette's painting. */
  builtin: string;
  scrim: number;
  inputMode: WallpaperAreaMode;
  panelMode: WallpaperAreaMode;
  messageMode: WallpaperAreaMode;
}

const DEFAULTS: WallpaperState = {
  enabled: false,
  url: "",
  builtin: "",
  scrim: WALLPAPER_SCRIM_DEFAULT,
  inputMode: "blur",
  panelMode: "trans",
  messageMode: "trans",
};

const listeners = new Set<() => void>();
let state: WallpaperState | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function read(): WallpaperState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return {
      enabled: window.localStorage.getItem(WALLPAPER_ENABLED_KEY) === "1",
      url: readStoredWallpaperUrl(),
      builtin: readStoredBuiltinWallpaper(),
      scrim: clampScrim(window.localStorage.getItem(WALLPAPER_SCRIM_KEY) ?? WALLPAPER_SCRIM_DEFAULT),
      inputMode: parseAreaMode(window.localStorage.getItem(WALLPAPER_INPUT_MODE_KEY)),
      panelMode: parseAreaMode(window.localStorage.getItem(WALLPAPER_PANEL_MODE_KEY)),
      messageMode: parseAreaMode(window.localStorage.getItem(WALLPAPER_MESSAGE_MODE_KEY)),
    };
  } catch {
    return DEFAULTS;
  }
}

function ensure(): WallpaperState {
  if (state === null) state = read();
  return state;
}

/**
 * Push the state onto `<html>`.
 *
 * `enabled` additionally requires a URL: a wallpaper that is "on" with no image
 * would leave the panels translucent over a solid background, which reads as a
 * rendering bug rather than a setting.
 */
function syncDom(next: WallpaperState): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  // A wallpaper is "on" even without a user image: the layer then falls back to
  // the built-in painting for the active palette, so enabling the feature
  // always shows something instead of leaving the panels translucent over a
  // flat background (which reads as a rendering bug, not a setting).
  const active = next.enabled;
  if (active) el.setAttribute("data-wallpaper", "on");
  else el.removeAttribute("data-wallpaper");
  el.style.setProperty("--wallpaper-scrim", `${next.scrim}%`);
  el.setAttribute("data-wallpaper-input", next.inputMode);
  el.setAttribute("data-wallpaper-panel", next.panelMode);
  el.setAttribute("data-wallpaper-message", next.messageMode);
}

function write(partial: Partial<WallpaperState>): void {
  const next = { ...ensure(), ...partial };
  state = next;
  syncDom(next);
  try {
    const storage = window.localStorage;
    storage.setItem(WALLPAPER_ENABLED_KEY, next.enabled ? "1" : "0");
    storage.setItem(WALLPAPER_SCRIM_KEY, String(next.scrim));
    storage.setItem(WALLPAPER_INPUT_MODE_KEY, next.inputMode);
    storage.setItem(WALLPAPER_PANEL_MODE_KEY, next.panelMode);
    storage.setItem(WALLPAPER_MESSAGE_MODE_KEY, next.messageMode);
    if (next.url) storage.setItem(WALLPAPER_URL_KEY, next.url);
    else storage.removeItem(WALLPAPER_URL_KEY);
    if (next.builtin) storage.setItem(WALLPAPER_BUILTIN_KEY, next.builtin);
    else storage.removeItem(WALLPAPER_BUILTIN_KEY);
  } catch {
    // Quota or privacy mode: the state still applies for this session.
  }
  // WallpaperLayer listens for this so the <img> swaps without a remount.
  window.dispatchEvent(new Event(WALLPAPER_CHANGED_EVENT));
  emit();
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Apply the persisted wallpaper once, on first client render. */
export function initWallpaper(): void {
  syncDom(ensure());
}

export function useWallpaper() {
  const current = useSyncExternalStore(subscribe, ensure, () => DEFAULTS);

  const choose = useCallback(async (file: File): Promise<void> => {
    const dataUrl = await fileToWallpaperDataUrl(file);
    write({ url: dataUrl, enabled: true });
  }, []);

  const remove = useCallback(() => {
    write({ url: "", enabled: false });
  }, []);

  /** Drop the custom image but keep the wallpaper on — it falls back to the
   *  built-in the user picked, or the palette's painting. */
  const useBuiltin = useCallback(() => {
    write({ url: "", enabled: true });
  }, []);

  /**
   * Pick a bundled wallpaper.
   *
   * Clears a custom image on purpose: leaving it set would keep winning in
   * `resolveWallpaperSrc`, so the click would look broken.
   */
  const setBuiltin = useCallback((builtin: string) => {
    write({ builtin, url: "", enabled: true });
  }, []);

  return {
    ...current,
    choose,
    remove,
    useBuiltin,
    setBuiltin,
    setEnabled: useCallback((enabled: boolean) => write({ enabled }), []),
    setScrim: useCallback((scrim: number) => write({ scrim: clampScrim(scrim) }), []),
    setInputMode: useCallback((inputMode: WallpaperAreaMode) => write({ inputMode }), []),
    setPanelMode: useCallback((panelMode: WallpaperAreaMode) => write({ panelMode }), []),
    setMessageMode: useCallback((messageMode: WallpaperAreaMode) => write({ messageMode }), []),
    /** Re-read storage (used when another tab changed a setting). */
    reload: useCallback(() => {
      state = null;
      syncDom(ensure());
      emit();
    }, []),
    /** `true` when a wallpaper is actually painted (user image or built-in). */
    active: current.enabled,
    /** `true` when the built-in painting is what is being shown. */
    usingBuiltin: current.enabled && current.url.length === 0,
  };
}
