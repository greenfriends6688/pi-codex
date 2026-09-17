import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  UI_DENSITY_DEFAULT,
  UI_DENSITY_FACTORS,
  UI_DENSITY_VALUES,
  parseStoredUiDensity,
  uiDensityCssValue,
  uiDensityFactor,
} = await jiti.import("@/lib/ui-density");

/*
 * fork:ui-22 — density is one unitless factor in the CSS cascade, so the only
 * things worth pinning are: the steps are ordered compact < standard < comfortable,
 * and an unknown stored value can never leave the UI at a non-1 factor by accident.
 */
test("factors are ordered and standard is exactly 1", () => {
  assert.equal(UI_DENSITY_FACTORS.standard, 1);
  assert.ok(UI_DENSITY_FACTORS.compact < 1);
  assert.ok(UI_DENSITY_FACTORS.comfortable > 1);
  for (const value of UI_DENSITY_VALUES) {
    assert.ok(uiDensityFactor(value) > 0.5 && uiDensityFactor(value) < 2, `${value} outside a sane range`);
  }
});

test("unknown stored values fall back to the default", () => {
  assert.equal(parseStoredUiDensity("compact"), "compact");
  assert.equal(parseStoredUiDensity("comfortable"), "comfortable");
  assert.equal(parseStoredUiDensity(null), UI_DENSITY_DEFAULT);
  assert.equal(parseStoredUiDensity(""), UI_DENSITY_DEFAULT);
  assert.equal(parseStoredUiDensity("dense"), UI_DENSITY_DEFAULT);
  assert.equal(parseStoredUiDensity(undefined), UI_DENSITY_DEFAULT);
});

test("switching back to standard writes the 1 factor instead of clearing it", () => {
  // Clearing the property would leave the previous multiplication in the cascade,
  // so the value is always written.
  assert.equal(uiDensityCssValue("standard"), "1");
  assert.equal(uiDensityCssValue("compact"), String(UI_DENSITY_FACTORS.compact));
});
