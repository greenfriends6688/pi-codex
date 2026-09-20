import assert from "node:assert/strict";
import test from "node:test";

const {
  BUILTIN_WALLPAPERS,
  DEFAULT_WALLPAPER_PAINTING,
  builtinPaintingFor,
  builtinWallpaperFor,
  isBuiltinWallpaperId,
  paintingPath,
  resolveWallpaperSrc,
} = await import("./wallpaper-builtin.ts");

test("every selectable built-in resolves to a distinct existing public path", () => {
  const paths = BUILTIN_WALLPAPERS.map((item) => paintingPath(item.id));
  assert.deepEqual(paths, ["/monet-artworks/zhang-ruonan.jpg", "/monet-artworks/cai-xukun.jpg"]);
  assert.equal(new Set(paths).size, paths.length, "two entries must not share one image");
});

test("the default is one of the selectable built-ins", () => {
  // Otherwise the picker would render with nothing active on a fresh profile and
  // "Use built-in" would show whatever the palette defaults to, unselectable.
  assert.ok(
    BUILTIN_WALLPAPERS.some((item) => item.id === DEFAULT_WALLPAPER_PAINTING),
    `${DEFAULT_WALLPAPER_PAINTING} is not in BUILTIN_WALLPAPERS`,
  );
});

test("isBuiltinWallpaperId rejects anything that is not a current built-in", () => {
  assert.equal(isBuiltinWallpaperId("cai-xukun"), true);
  assert.equal(isBuiltinWallpaperId("zhang-ruonan"), true);
  // A stored id can outlive the wallpaper it names.
  assert.equal(isBuiltinWallpaperId("miku-stage"), false);
  assert.equal(isBuiltinWallpaperId("default"), false);
  assert.equal(isBuiltinWallpaperId(""), false);
  assert.equal(isBuiltinWallpaperId(undefined), false);
  assert.equal(isBuiltinWallpaperId(null), false);
  assert.equal(isBuiltinWallpaperId(42), false);
});

test("the user's pick wins over the palette fallback", () => {
  assert.equal(builtinPaintingFor("light", "cai-xukun"), "cai-xukun");
  assert.equal(builtinPaintingFor("dark", "cai-xukun"), "cai-xukun");
  // An unknown stored id must not produce a 404 <img>; it falls back instead.
  assert.equal(builtinPaintingFor("light", "deleted-wallpaper"), DEFAULT_WALLPAPER_PAINTING);
  assert.equal(builtinPaintingFor("light", undefined), DEFAULT_WALLPAPER_PAINTING);
  assert.equal(builtinPaintingFor(null, ""), DEFAULT_WALLPAPER_PAINTING);
});

test("a user image always beats every built-in", () => {
  const custom = "data:image/jpeg;base64,AAA";
  assert.equal(resolveWallpaperSrc(custom, "light", "cai-xukun"), custom);
  assert.equal(resolveWallpaperSrc(custom, "dark", undefined), custom);
  assert.equal(
    resolveWallpaperSrc("", "light", "cai-xukun"),
    builtinWallpaperFor("light", "cai-xukun"),
  );
});
