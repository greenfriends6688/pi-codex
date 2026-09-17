/**
 * Border-depth model for the Settings → 通用 slider.
 *
 * The Codex skin uses a three-step hairline ladder (`--border-faint` /
 * `--border` / `--border-strong`), all authored as translucent foreground
 * colours. The user-facing slider re-blends that ladder against the surface and
 * the foreground so borders can be made invisible or pushed to maximum contrast
 * without editing any palette:
 *
 *   depth   0 → border = background (invisible)
 *   depth  50 → the theme's own value (pass-through, no color-mix cost)
 *   depth 100 → border = text colour (maximum contrast)
 *
 * Pure functions only — no DOM — so the boundary behaviour is unit-testable.
 * `hooks/useBorderDepth.ts` owns the side effects.
 */

/** CSS custom properties written by the border-depth feature. */
export const BORDER_DEPTH_VARS = ["--border", "--border-strong", "--border-faint"] as const;

/**
 * Snapshot variables. The slider always blends from these, never from the live
 * `--border*`, otherwise every drag step would re-blend an already-blended value
 * and the colour would drift after a few moves.
 */
export const BORDER_ORIG_VARS = ["--border-orig", "--border-strong-orig", "--border-faint-orig"] as const;

export const BORDER_DEPTH_DEFAULT = 50;
export const BORDER_DEPTH_MIN = 0;
export const BORDER_DEPTH_MAX = 100;

/**
 * How each ladder step is offset from the slider value.
 *
 * The three steps keep their relative order at every depth: the strong line is
 * always firmer than the default line, which is always firmer than the faint
 * one. Offsets are in depth units, so at depth 50 the mid step still resolves to
 * the theme's own value.
 */
export const BORDER_STEP_OFFSETS: Record<string, number> = {
  "--border": 0,
  "--border-strong": 16,
  "--border-faint": -18,
};

/** Clamp an arbitrary input to a valid depth. */
export function clampBorderDepth(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return BORDER_DEPTH_DEFAULT;
  return Math.max(BORDER_DEPTH_MIN, Math.min(BORDER_DEPTH_MAX, Math.round(n)));
}

/** Effective depth for one ladder step (clamped after applying its offset). */
export function stepDepth(depth: number, cssVar: string): number {
  const offset = BORDER_STEP_OFFSETS[cssVar] ?? 0;
  return clampBorderDepth(clampBorderDepth(depth) + offset);
}

/** Read a depth value out of persisted storage, falling back to the default. */
export function parseStoredBorderDepth(raw: string | null): number {
  if (raw === null) return BORDER_DEPTH_DEFAULT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? clampBorderDepth(n) : BORDER_DEPTH_DEFAULT;
}

/**
 * Build the CSS value for one ladder step.
 *
 * Returns `null` when the caller should fall back to the theme's own value
 * (i.e. remove the inline override) — that is the depth-50 fast path, where an
 * identity `color-mix()` would only add work for every paint.
 *
 * The two halves blend toward *different* things, and that asymmetry matters:
 *
 *  - **0 → 50 fades the colour's own alpha out** (toward `transparent`). The
 *    obvious-looking alternative — blending toward `var(--bg)` — is wrong: the
 *    Codex hairlines are *translucent* (`oklch(... / 0.1)`), and `--bg` is
 *    opaque, so mixing the two *raises* the alpha. Sliding toward "invisible"
 *    would draw a firmer grey line instead of a fainter one. (Verified in a
 *    real browser: depth 0 produced `color-mix(... 0%, white 100%)`, i.e. a
 *    solid surface colour.)
 *  - **50 → 100 blends toward the text colour**, which is already opaque, so an
 *    opaque target is correct there.
 *
 * Both halves use a gamma below 1 so a move in the middle of the track is
 * visible; a linear map makes the useful range sit entirely at the two ends.
 */
export function borderDepthValue(origVar: string, depth: number): string | null {
  const d = clampBorderDepth(depth);

  // 50 is the pass-through point: use the snapshot directly.
  if (d === 50) return `var(${origVar})`;

  if (d < 50) {
    const percent = Math.round(Math.pow(d / 50, 0.6) * 100);
    if (percent <= 0) return "transparent";
    return `color-mix(in srgb, var(${origVar}) ${percent}%, transparent)`;
  }

  const textPercent = Math.round(Math.pow((d - 50) / 50, 0.7) * 100);
  if (textPercent >= 100) return "var(--text)";
  return `color-mix(in srgb, var(${origVar}) ${100 - textPercent}%, var(--text) ${textPercent}%)`;
}

/** Does this depth need an inline override at all? */
export function borderDepthNeedsOverride(depth: number): boolean {
  const d = clampBorderDepth(depth);
  const needs = Object.keys(BORDER_STEP_OFFSETS).some((cssVar) => stepDepth(d, cssVar) !== 50);
  return needs;
}
