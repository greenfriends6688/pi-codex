"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SessionInfo } from "./types";

/**
 * Client-side session flags: pinned and archived.
 *
 * Both are **presentation-only**. Nothing here renames, moves or deletes a
 * `.jsonl` file — that is a hard rule for this app (a session the user cannot
 * see is still a session the user owns), and it is why these flags live in
 * `localStorage` rather than in the session file.
 *
 * Stored as two id arrays under one key so a flag write is a single atomic
 * `setItem`. Cross-tab changes arrive through the `storage` event; same-tab
 * changes through a custom event (the `storage` event does not fire in the
 * originating tab).
 */

const STORAGE_KEY = "pi-session-flags";
const CHANGE_EVENT = "pi-session-flags-change";

/**
 * fork:ui-10 — a manual status per session ("what happened to this one?").
 *
 * Same reasoning as pin/archive: presentation-only, stored in localStorage, never
 * written into the session file. The tag is what drives the coloured dot in the
 * sidebar; it is deliberately orthogonal to the live run state (a running session
 * shows its spinner regardless of its tag).
 */
export const SESSION_TAGS = ["complete", "interrupted", "error", "aborted", "pending"] as const;
export type SessionTag = (typeof SESSION_TAGS)[number];

/** Dot colour per tag — the tokens the rest of the app already uses. */
export const SESSION_TAG_TONES: Record<SessionTag, string> = {
  complete: "var(--success)",
  interrupted: "var(--warning)",
  error: "var(--danger)",
  aborted: "var(--text-dim)",
  pending: "var(--accent)",
};

export function isSessionTag(value: unknown): value is SessionTag {
  return typeof value === "string" && (SESSION_TAGS as readonly string[]).includes(value);
}

export interface SessionFlags {
  pinned: string[];
  archived: string[];
  /**
   * fork:ui-archive-history — session id → 归档时间（ISO）。
   *
   * 「归档历史」页要按时间排序并显示「多久前归档」，光有一串 id 排不出来。老数据没有这个
   * 字段，解析时按缺失处理（这些行按 id 顺序排在末尾）。
   */
  archivedAt: Record<string, string>;
  /** session id → tag. A session without a tag has no dot. */
  tags: Record<string, SessionTag>;
}

const EMPTY: SessionFlags = { pinned: [], archived: [], archivedAt: {}, tags: {} };

const listeners = new Set<() => void>();
let cache: SessionFlags | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function sanitizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

export function parseSessionFlags(raw: string | null): SessionFlags {
  if (!raw) return { ...EMPTY, tags: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY, tags: {} };
    const record = parsed as Record<string, unknown>;
    return {
      pinned: sanitizeIdList(record.pinned),
      archived: sanitizeIdList(record.archived),
      archivedAt: sanitizeArchivedAt(record.archivedAt),
      tags: sanitizeTags(record.tags),
    };
  } catch {
    return { ...EMPTY, tags: {} };
  }
}

/** id → ISO 时间戳；坏值丢掉（历史页会按「未知时间」渲染）。 */
function sanitizeArchivedAt(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    if (id && typeof at === "string" && at) out[id] = at;
  }
  return out;
}

/** Unknown tags and non-string ids are dropped rather than rendered as a "?" dot. */
function sanitizeTags(value: unknown): Record<string, SessionTag> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, SessionTag> = {};
  for (const [id, tag] of Object.entries(value as Record<string, unknown>)) {
    if (id && isSessionTag(tag)) out[id] = tag;
  }
  return out;
}

function read(): SessionFlags {
  if (typeof window === "undefined") return EMPTY;
  try {
    return parseSessionFlags(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function ensure(): SessionFlags {
  if (cache === null) cache = read();
  return cache;
}

function write(next: SessionFlags): void {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the in-memory flags still apply for this session
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  emit();
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cache = null;
    emit();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function togglePinned(id: string): void {
  const current = ensure();
  write({ ...current, pinned: toggleIn(current.pinned, id) });
}

export function toggleArchived(id: string): void {
  const current = ensure();
  const archived = toggleIn(current.archived, id);
  const archivedAt = { ...current.archivedAt };
  if (archived.includes(id)) archivedAt[id] = new Date().toISOString();
  else delete archivedAt[id];
  write({ ...current, archived, archivedAt });
}

/** Set or clear one session's tag (`null` clears it). */
export function setSessionTag(id: string, tag: SessionTag | null): void {
  const current = ensure();
  const tags = { ...current.tags };
  if (tag === null) delete tags[id];
  else tags[id] = tag;
  write({ ...current, tags });
}

export function getSessionTag(id: string): SessionTag | undefined {
  return ensure().tags[id];
}

/** Non-hook accessor for imperative callers (context menu actions). */
export function getSessionFlags(): SessionFlags {
  return ensure();
}

/**
 * Filter + order one project's sessions.
 *
 * Archived sessions are dropped from the main list; pinned ones move to the top
 * while keeping the existing relative order (a stable partition, so the list
 * does not reshuffle when a second session is pinned).
 */
export function applySessionFlags<T extends Pick<SessionInfo, "id">>(
  sessions: readonly T[],
  flags: SessionFlags,
): T[] {
  if (flags.archived.length === 0 && flags.pinned.length === 0) return [...sessions];
  const archived = new Set(flags.archived);
  const pinned = new Set(flags.pinned);
  const visible: T[] = [];
  const pinnedRows: T[] = [];
  for (const session of sessions) {
    if (archived.has(session.id)) continue;
    if (pinned.has(session.id)) pinnedRows.push(session);
    else visible.push(session);
  }
  return [...pinnedRows, ...visible];
}

/**
 * The archived rows of one session list.
 *
 * `applySessionFlags` intentionally drops archived sessions from the main
 * list; this is the explicit counterpart a caller uses to surface them again
 * (the sidebar's per-project "Archived" section), so the two behaviours stay
 * independent instead of weakening the filter for existing callers.
 */
export function archivedSessions<T extends Pick<SessionInfo, "id">>(
  sessions: readonly T[],
  flags: SessionFlags,
): T[] {
  if (flags.archived.length === 0) return [];
  const archived = new Set(flags.archived);
  return sessions.filter((session) => archived.has(session.id));
}

export function useSessionFlags() {
  const flags = useSyncExternalStore(subscribe, ensure, () => EMPTY);

  const pin = useCallback((id: string) => togglePinned(id), []);
  const archive = useCallback((id: string) => toggleArchived(id), []);
  const setTag = useCallback((id: string, tag: SessionTag | null) => setSessionTag(id, tag), []);

  return { flags, pin, archive, setTag };
}
