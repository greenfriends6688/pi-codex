/**
 * fork:notice-dedupe — suppress an extension that notifies the same thing on every
 * session start (pi-memory does this while qmd is missing).
 *
 * Lives here rather than inside the hook because each session switch mounts a fresh
 * `useAgentSession`, so the memory has to outlive the component; keeping it pure also
 * makes the window testable without rendering React.
 */
export const NOTICE_DEDUPE_TTL_MS = 10 * 60 * 1000;

const recentNotices = new Map<string, number>();

/**
 * @returns true when an identical notice (same type, same trimmed text) was already
 * shown inside the window — the caller should drop it.
 */
export function isDuplicateNotice(message: string, type = "info", now = Date.now()): boolean {
  for (const [key, at] of recentNotices) {
    if (now - at > NOTICE_DEDUPE_TTL_MS) recentNotices.delete(key);
  }
  const key = `${type}\u0000${message}`;
  if (recentNotices.has(key)) return true;
  recentNotices.set(key, now);
  return false;
}

/** Test hook: forget everything remembered so far. */
export function __resetNoticeDedupe(): void {
  recentNotices.clear();
}
