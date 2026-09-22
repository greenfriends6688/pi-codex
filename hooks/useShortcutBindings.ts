"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  parseShortcutOverrides,
  resolveEffectiveShortcutBindings,
  type EffectiveShortcutBindings,
  type ShortcutOverrides,
} from "@/lib/shortcuts";

/*
 * fork:zc-04 — React bridge for the shortcut kernel.
 *
 * Storage: browser localStorage under `pi-web:shortcut-bindings`, not
 * `~/.pi/agent/pi-web-preferences.json`. The plan allowed either; localStorage
 * wins here because (a) the kernel is a client-only concept — server-side
 * keyboard dispatch does not exist — so a round trip through an API route buys
 * nothing, and (b) it matches every other client preference in this fork
 * (`pi-web:settings-navigation`, title model, tool preset, step expansion),
 * which keeps the "one storage shape per concern" rule intact. The trade-off is
 * per-browser rather than per-machine keymaps; that is the same trade-off the
 * theme already makes.
 *
 * A module-level store (instead of per-hook state) means the settings recorder,
 * the global dispatcher, and any label renderer all observe one snapshot, and a
 * second browser tab stays in sync through the native `storage` event.
 */

export const SHORTCUT_BINDINGS_STORAGE_KEY = "pi-web:shortcut-bindings";

const EMPTY_OVERRIDES: ShortcutOverrides = Object.freeze({});

const listeners = new Set<() => void>();
let cachedOverrides: ShortcutOverrides = EMPTY_OVERRIDES;
let cachedRaw: string | null | undefined;
let storageListenerAttached = false;

function readStoredOverrides(): ShortcutOverrides {
  if (typeof window === "undefined") return EMPTY_OVERRIDES;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SHORTCUT_BINDINGS_STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: defaults are still usable.
    return EMPTY_OVERRIDES;
  }
  if (raw === cachedRaw) return cachedOverrides;
  cachedRaw = raw;
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  cachedOverrides = parseShortcutOverrides(parsed);
  return cachedOverrides;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function attachStorageListener(): void {
  if (storageListenerAttached || typeof window === "undefined") return;
  storageListenerAttached = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== SHORTCUT_BINDINGS_STORAGE_KEY) return;
    cachedRaw = undefined;
    emit();
  });
}

function subscribe(listener: () => void): () => void {
  attachStorageListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ShortcutOverrides {
  return readStoredOverrides();
}

function getServerSnapshot(): ShortcutOverrides {
  return EMPTY_OVERRIDES;
}

/** Persist a new overrides object and notify every subscriber. */
export function setShortcutOverrides(next: ShortcutOverrides): void {
  const raw = JSON.stringify(next);
  cachedRaw = raw;
  cachedOverrides = parseShortcutOverrides(next);
  try {
    window.localStorage.setItem(SHORTCUT_BINDINGS_STORAGE_KEY, raw);
  } catch {
    // Storage full/blocked: the in-memory snapshot still applies this session.
  }
  emit();
}

export function getShortcutOverrides(): ShortcutOverrides {
  return readStoredOverrides();
}

export interface UseShortcutBindingsResult {
  overrides: ShortcutOverrides;
  effective: EffectiveShortcutBindings;
  /** Replace the whole overrides object (already built by the kernel helpers). */
  updateBindings: (next: ShortcutOverrides) => void;
  /** Reset every command back to its default binding. */
  resetBindings: () => void;
}

export function useShortcutBindings(): UseShortcutBindingsResult {
  const overrides = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const effective = useMemo(() => resolveEffectiveShortcutBindings(overrides), [overrides]);

  const updateBindings = useCallback((next: ShortcutOverrides) => {
    setShortcutOverrides(next);
  }, []);

  const resetBindings = useCallback(() => {
    setShortcutOverrides({});
  }, []);

  return {
    overrides,
    effective,
    updateBindings,
    resetBindings,
  };
}
