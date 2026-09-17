"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Process renderer preference.
 *
 *  - `legacy`   the original flat renderer: every tool call / thinking block is
 *               its own collapsible row under the assistant message.
 *  - `timeline` semantic steps (see `lib/step-categorizer.ts`), laid out as a
 *               vertical timeline.
 *  - `tabs`     the same steps, laid out as a tab strip.
 *
 * Default is `legacy` on purpose: the grouped renderer is a new code path and
 * users on a large session should not have their transcript change shape without
 * asking. The settings panel exposes the switch.
 *
 * Module-level store + `useSyncExternalStore` so the settings dialog and the
 * chat window always agree, and so a change applies without a reload. Cross-tab
 * changes arrive through the `storage` event; same-tab changes through a
 * custom event (the `storage` event does not fire in the originating tab).
 */

export type ProcessRendererPreference = "legacy" | "timeline" | "tabs";

const STORAGE_KEY = "pi-process-renderer";
const CHANGE_EVENT = "pi-process-renderer-change";
const DEFAULT_MODE: ProcessRendererPreference = "legacy";

export const PROCESS_RENDERER_STORAGE_KEY: Record<ProcessRendererPreference, ProcessRendererPreference> = {
  legacy: "legacy",
  timeline: "timeline",
  tabs: "tabs",
};

export function parseProcessRenderer(raw: string | null): ProcessRendererPreference {
  return raw === "timeline" || raw === "tabs" ? raw : "legacy";
}

function getStoredMode(): ProcessRendererPreference {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    return parseProcessRenderer(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_MODE;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function getServerSnapshot(): ProcessRendererPreference {
  return DEFAULT_MODE;
}

export function useProcessDisplayMode() {
  const displayMode = useSyncExternalStore(subscribe, getStoredMode, getServerSnapshot);

  const setDisplayMode = useCallback((mode: ProcessRendererPreference) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, parseProcessRenderer(mode));
    } catch {
      // storage unavailable — the in-memory store still updates for this session
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { displayMode, setDisplayMode };
}
