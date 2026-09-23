// fork:zn-19-variant — 皮肤颜色变体（浅色/深色）与内置皮肤的测试。
import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  DEFAULT_THEME_SKIN,
  SKIN_MODE_PALETTE,
  createSkinDraft,
  parseThemeSkin,
  resolveSkinColors,
} = await jiti.import("./theme-skins.ts");
const {
  BUILTIN_SKINS,
  allSkinCandidates,
  findActiveSkinIncludingBuiltins,
  isBuiltinSkinId,
} = await jiti.import("./builtin-skins.ts");

const draft = (over = {}) => createSkinDraft("skin-1", "Test", "light", over);

test("a mode variant overrides the shared colours, empty fields fall back to them", () => {
  const skin = {
    ...draft({ background: "#111111", panel: "#222222", accent: "#333333", text: "#444444" }),
    dark: { background: "#000000", panel: "", accent: "", text: "#ffffff" },
  };

  assert.deepEqual(resolveSkinColors(skin, "dark"), {
    background: "#000000",  // variant wins
    panel: "#222222",       // empty in the variant → shared
    accent: "#333333",
    text: "#ffffff",
  });
  // A skin with no variants behaves exactly like the pre-variant model.
  assert.deepEqual(resolveSkinColors(draft({ background: "#abc", panel: "", accent: "", text: "" }), "light"), {
    background: "#abc", panel: "", accent: "", text: "",
  });
});

test("parses both variants and tolerates garbage", () => {
  const parsed = parseThemeSkin({
    id: "skin-1",
    name: "Test",
    mode: "dark",
    background: "#101010",
    light: { background: "#fafafa", panel: 7, accent: null, text: "#111" },
    dark: "not-an-object",
  });

  assert.deepEqual(parsed.light, { background: "#fafafa", panel: "", accent: "", text: "#111" });
  assert.deepEqual(parsed.dark, { background: "", panel: "", accent: "", text: "" });
  // Old skins (no variant fields at all) parse into empty variants.
  const legacy = parseThemeSkin({ id: "skin-2", name: "Old", mode: "light", background: "#123456" });
  assert.deepEqual(legacy.light, { background: "", panel: "", accent: "", text: "" });
  assert.equal(resolveSkinColors(legacy, "dark").background, "#123456");
});

test("the preview palette covers both modes so the studio can render the other one", () => {
  for (const mode of ["light", "dark"]) {
    const palette = SKIN_MODE_PALETTE[mode];
    for (const key of ["background", "panel", "accent", "text"]) {
      assert.match(palette[key], /^#[0-9a-f]{6}$/i, `${mode}.${key}`);
    }
  }
  assert.notEqual(SKIN_MODE_PALETTE.light.background, SKIN_MODE_PALETTE.dark.background);
});

test("built-in wallpaper skins are real skins in the library and can be overridden", () => {
  assert.equal(BUILTIN_SKINS.length, 2);
  for (const skin of BUILTIN_SKINS) {
    assert.ok(isBuiltinSkinId(skin.id));
    assert.match(skin.wallpaper ?? "", /^\/monet-artworks\//);
    // Colours stay empty so the theme's own palette shows through.
    assert.equal(skin.background, "");
  }

  const empty = { skins: [], activeId: "default" };
  assert.deepEqual(allSkinCandidates(empty).map((skin) => skin.id), BUILTIN_SKINS.map((skin) => skin.id));
  assert.equal(findActiveSkinIncludingBuiltins({ ...empty, activeId: BUILTIN_SKINS[0].id })?.id, BUILTIN_SKINS[0].id);
  assert.equal(findActiveSkinIncludingBuiltins(empty), null);

  // Editing a built-in saves an override under the same id; the user's copy wins.
  const edited = { ...BUILTIN_SKINS[0], name: "我的版本" };
  const state = { skins: [edited], activeId: edited.id };
  const candidates = allSkinCandidates(state);
  assert.equal(candidates.filter((skin) => skin.id === edited.id).length, 1);
  assert.equal(candidates.find((skin) => skin.id === edited.id)?.name, "我的版本");
  assert.equal(findActiveSkinIncludingBuiltins(state)?.name, "我的版本");
});

test("default skin stays unsettable (selecting 默认 removes every override)", () => {
  assert.equal(DEFAULT_THEME_SKIN.id, "default");
  assert.equal(findActiveSkinIncludingBuiltins({ skins: BUILTIN_SKINS, activeId: "default" }), null);
});
