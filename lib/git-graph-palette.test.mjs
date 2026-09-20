import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./git-graph-palette.ts");
}

test("derives a hue-rotated palette that keeps the accent's own lightness", async () => {
  const { LANE_COLOR_COUNT, deriveLanePalette } = await loadSubject();
  // Gruvbox dark accent：L 55%，满饱和。
  const palette = deriveLanePalette("#fe8019", true);
  assert.equal(palette.length, LANE_COLOR_COUNT);
  // lane 0 保持 accent 色相，其余绕色轮旋转。
  assert.match(palette[0], /^hsl\(\d+ /);
  const hues = palette.map((color) => Number(color.match(/^hsl\((\d+) /)[1]));
  assert.equal(new Set(hues).size, LANE_COLOR_COUNT);
  for (const color of palette) {
    assert.match(color, /^hsl\(\d+ \d+% 55%\)$/);
  }
});

test("light-variant accents keep their deeper theme-tuned lightness", async () => {
  const { deriveLanePalette } = await loadSubject();
  // Gruvbox light accent 色相相近但更深（L 45%）；色板必须沿用这个亮度，
  // 不能自作主张改亮。
  const dark = deriveLanePalette("#fe8019", true);
  const light = deriveLanePalette("#d65d0e", false);
  assert.notDeepEqual(dark, light);
  for (const color of light) {
    assert.match(color, /^hsl\(\d+ \d+% 45%\)$/);
  }
  // 支线退居主线之后：饱和度更低、亮度相同。
  const sideS = Number(light[1].match(/^hsl\(\d+ (\d+)% /)[1]);
  const lane0S = Number(light[0].match(/^hsl\(\d+ (\d+)% /)[1]);
  assert.ok(sideS < lane0S);
});

test("3-digit hex accents are supported", async () => {
  const { FALLBACK_PALETTE, LANE_COLOR_COUNT, deriveLanePalette } = await loadSubject();
  const palette = deriveLanePalette("#58a", true);
  assert.equal(palette.length, LANE_COLOR_COUNT);
  assert.notDeepEqual(palette, FALLBACK_PALETTE);
});

test("unparseable or near-grey accents fall back to the mode's fixed palette", async () => {
  const { FALLBACK_PALETTE, FALLBACK_PALETTE_LIGHT, deriveLanePalette } = await loadSubject();
  assert.deepEqual(deriveLanePalette("not-a-color", true), FALLBACK_PALETTE);
  assert.deepEqual(deriveLanePalette("", true), FALLBACK_PALETTE);
  assert.deepEqual(deriveLanePalette("#444444", true), FALLBACK_PALETTE);
  assert.deepEqual(deriveLanePalette("not-a-color", false), FALLBACK_PALETTE_LIGHT);
  assert.deepEqual(deriveLanePalette("", false), FALLBACK_PALETTE_LIGHT);
  assert.deepEqual(deriveLanePalette("#444444", false), FALLBACK_PALETTE_LIGHT);
});
