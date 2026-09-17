import assert from "node:assert/strict";
import test from "node:test";

const {
  clampScrim,
  parseAreaMode,
  isAcceptedImageType,
  WALLPAPER_SCRIM_DEFAULT,
  WALLPAPER_SCRIM_MIN,
  WALLPAPER_SCRIM_MAX,
  WALLPAPER_MIME_TYPES,
} = await import("./wallpaper.ts");

test("clampScrim clamps to the range and accepts a percentage string", () => {
  assert.equal(clampScrim(70), 70);
  assert.equal(clampScrim("55"), 55);
  assert.equal(clampScrim("55%"), 55);
  assert.equal(clampScrim(0), WALLPAPER_SCRIM_MIN);
  assert.equal(clampScrim(500), WALLPAPER_SCRIM_MAX);
  assert.equal(clampScrim(69.6), 70);
  // Garbage must never produce NaN: a NaN scrim would make the whole
  // color-mix() invalid and drop the scrim entirely.
  assert.equal(clampScrim(undefined), WALLPAPER_SCRIM_DEFAULT);
  assert.equal(clampScrim("wat"), WALLPAPER_SCRIM_DEFAULT);
  assert.equal(clampScrim(null), WALLPAPER_SCRIM_DEFAULT);
});

test("parseAreaMode accepts the three modes and defaults to trans", () => {
  assert.equal(parseAreaMode("none"), "none");
  assert.equal(parseAreaMode("trans"), "trans");
  assert.equal(parseAreaMode("blur"), "blur");
  assert.equal(parseAreaMode("solid"), "trans");
  assert.equal(parseAreaMode(undefined), "trans");
  assert.equal(parseAreaMode(1), "trans");
});

test("isAcceptedImageType rejects SVG", () => {
  assert.equal(isAcceptedImageType("image/jpeg"), true);
  assert.equal(isAcceptedImageType("image/png"), true);
  assert.equal(isAcceptedImageType("image/webp"), true);
  // SVG can carry script and entity payloads and would be loaded from a data
  // URL inside the app's own origin — it must never be accepted.
  assert.equal(isAcceptedImageType("image/svg+xml"), false);
  assert.equal(isAcceptedImageType("image/gif"), false);
  assert.equal(isAcceptedImageType("text/html"), false);
});

test("the MIME allow-list matches what the file picker advertises", () => {
  assert.deepEqual([...WALLPAPER_MIME_TYPES], ["image/jpeg", "image/png", "image/webp"]);
  for (const mime of WALLPAPER_MIME_TYPES) {
    assert.equal(isAcceptedImageType(mime), true);
  }
});
