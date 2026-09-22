/**
 * lib/stream-enter-memory.ts
 *
 * fork:zm-02 — one-shot memory for the streaming entrance animation.
 *
 * The transcript is a paged render window that remounts on session switch, so a
 * naive "animate every row on mount" implementation replays the whole screen
 * (the ZCode reference hit the same wall and solved it with a module-level
 * `Map<toolId, timestamp>` — ToolCallBlocks.tsx:27-72). This module is that map,
 * but pure: the clock is injectable so the eviction rules are unit-testable
 * without touching real time.
 *
 * Contract:
 *   - `shouldPlay(id, active)` is the only read a component needs. It is
 *     `false` for empty ids, `false` when the caller is not active (not
 *     streaming), and `false` once the id has been recorded.
 *   - `record(id)` marks the id as played. The component calls it after the
 *     entrance has started, so a remount during the animation cannot replay it.
 *   - The map is capped (`STREAM_ENTER_MAX_KEYS`), evicting the oldest records
 *     first, so a long-lived tab cannot grow it without bound.
 *
 * The component-side counterpart is `STREAM_ENTER_CLEANUP_MS`: after a batch of
 * entrances finishes, ProcessGroup drops the `data-fork-enter` marker. Keeping
 * the constant here means the JS timer and the CSS duration can be reviewed
 * together.
 */

/** Hard cap on remembered ids (same order of magnitude as the reference's 800). */
export const STREAM_ENTER_MAX_KEYS = 800;

/** How long the `data-fork-enter` marker stays after an entrance starts. */
export const STREAM_ENTER_CLEANUP_MS = 1000;

/** Stagger unit for the entrance delay (`--fork-enter-delay`). */
export const STREAM_ENTER_STEP_MS = 36;

/** Delay is clamped to this many stagger steps (~360ms) so late rows never wait seconds. */
export const STREAM_ENTER_MAX_STAGGER = 10;

export interface StreamEnterMemoryOptions {
  /** Maximum remembered ids; defaults to `STREAM_ENTER_MAX_KEYS`. */
  maxKeys?: number;
  /** Injectable clock (tests); defaults to `Date.now`. */
  now?: () => number;
}

export interface StreamEnterMemory {
  /** True when this id (or an empty id) must not animate again. */
  hasPlayed(id: string): boolean;
  /** True only when the id is non-empty, unrecorded and the caller is active. */
  shouldPlay(id: string, active?: boolean): boolean;
  /** Marks an id as played; returns false for an empty id. */
  record(id: string, at?: number): boolean;
  /** Drops the oldest records until `maxKeys` is respected; returns evicted count. */
  prune(): number;
  size(): number;
  clear(): void;
}

/** Whitespace-only ids are inert rather than a shared "empty" animation key. */
export function normalizeStreamEnterId(id: string): string | null {
  const normalized = id.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * CSS value for one row's entrance delay. `sequence` is the stable per-turn
 * ordinal assigned by buildProcessSteps — never the render window's array
 * index, which shifts when older messages are prepended.
 */
export function streamEnterDelay(
  sequence: number,
  options?: { stepMs?: number; maxSteps?: number },
): string {
  const stepMs = options?.stepMs ?? STREAM_ENTER_STEP_MS;
  const maxSteps = options?.maxSteps ?? STREAM_ENTER_MAX_STAGGER;
  const finite = Number.isFinite(sequence) ? sequence : 0;
  const clamped = Math.max(0, Math.min(Math.floor(finite), maxSteps));
  return `calc(${clamped} * ${stepMs}ms)`;
}

export function createStreamEnterMemory(options: StreamEnterMemoryOptions = {}): StreamEnterMemory {
  const maxKeys = Math.max(0, Math.floor(options.maxKeys ?? STREAM_ENTER_MAX_KEYS));
  const now = options.now ?? (() => Date.now());
  /** id -> first-recorded timestamp (insertion order is the tie-breaker). */
  const played = new Map<string, number>();

  const prune = (): number => {
    if (played.size <= maxKeys) return 0;
    const oldest = Array.from(played.entries()).sort((left, right) => left[1] - right[1]);
    const overflow = played.size - maxKeys;
    let removed = 0;
    for (let index = 0; index < overflow; index += 1) {
      const entry = oldest[index];
      if (!entry) break;
      played.delete(entry[0]);
      removed += 1;
    }
    return removed;
  };

  return {
    hasPlayed(id) {
      const key = normalizeStreamEnterId(id);
      return key === null ? true : played.has(key);
    },
    shouldPlay(id, active = true) {
      if (!active) return false;
      const key = normalizeStreamEnterId(id);
      return key === null ? false : !played.has(key);
    },
    record(id, at) {
      const key = normalizeStreamEnterId(id);
      if (key === null) return false;
      played.set(key, at ?? now());
      prune();
      return true;
    },
    prune,
    size() {
      return played.size;
    },
    clear() {
      played.clear();
    },
  };
}

/**
 * Module-level instance shared by every ProcessGroup size — one browser tab,
 * one history. `globalThis` is not needed here (unlike the RPC registry): a hot
 * reload is allowed to forget the animation history, it only costs one replay.
 */
export const streamEnterMemory = createStreamEnterMemory();
