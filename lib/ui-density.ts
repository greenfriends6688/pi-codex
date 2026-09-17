/**
 * fork:ui-22 — interface density (pure part).
 *
 * A single unitless factor written to `--fork-density` on `<html>`, which the
 * fork's CSS multiplies into vertical rhythm (`calc(16px * var(--fork-density))`).
 * MusePi keeps the same shape (`--gui-density`, docs/gui-design.md §2) and the
 * reason is the same: one number, no per-component flags.
 *
 * Ceiling, on purpose: density only reaches surfaces that lay themselves out
 * from CSS. The sidebar session list is virtualized on a fixed
 * `SESSION_LIST_ITEM_HEIGHT`, so scaling row heights there would desync the
 * list — session rows stay fixed and the hook's copy says so.
 */

export const UI_DENSITY_VALUES = ["compact", "standard", "comfortable"] as const;
export type UiDensity = (typeof UI_DENSITY_VALUES)[number];

export const UI_DENSITY_DEFAULT: UiDensity = "standard";
export const UI_DENSITY_STORAGE_KEY = "pi-ui-density";

/** Multiplier per step. Kept in one place so CSS never hardcodes a factor. */
export const UI_DENSITY_FACTORS: Record<UiDensity, number> = {
  compact: 0.85,
  standard: 1,
  comfortable: 1.15,
};

export function isUiDensity(value: unknown): value is UiDensity {
  return typeof value === "string" && (UI_DENSITY_VALUES as readonly string[]).includes(value);
}

/** Stored value → density; anything unknown falls back to the default. */
export function parseStoredUiDensity(value: string | null | undefined): UiDensity {
  return isUiDensity(value) ? value : UI_DENSITY_DEFAULT;
}

export function uiDensityFactor(density: UiDensity): number {
  return UI_DENSITY_FACTORS[density] ?? 1;
}

/** Inline style for a `<html>` element; `null` clears the override. */
export function uiDensityCssValue(density: UiDensity): string {
  // The standard step writes the factor too: a value that is switched back must
  // not leave the previous multiplication in place.
  return String(uiDensityFactor(density));
}
