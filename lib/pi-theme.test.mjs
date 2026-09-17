import assert from "node:assert/strict";
import test from "node:test";

const {
  PI_THEME_CSS_VARS,
  ALL_COLOR_TOKENS,
  mapToCodexTokens,
  parseThemeFilename,
  resolveColor,
  resolveColors,
  resolveVars,
  resolveTheme,
  listThemeSets,
  contrastRatio,
  contrastText,
  relativeLuminance,
  withAlpha,
  mix,
  ensureContrast,
  themeNameToDisplay,
} = await import("./pi-theme.ts");

// The bundled registry is injected (see lib/pi-theme-builtin.ts) so the engine
// itself stays free of value imports and this test file needs no loader setup.
const { BUILTIN_THEMES } = await import("./pi-theme-builtin.ts");

// ─── Colour resolution ──────────────────────────────────────────────────────

test("resolveColor passes hex through lowercased and adds a missing #", () => {
  assert.equal(resolveColor("#FF0000", {}), "#ff0000");
  assert.equal(resolveColor("ff0000", {}), "#ff0000");
});

test("resolveColor expands variable references", () => {
  assert.equal(resolveColor("accent", { accent: "#123456" }), "#123456");
});

test("resolveColor converts 256-colour indexes (number and numeric string)", () => {
  assert.equal(resolveColor(0, {}), "#000000");
  assert.equal(resolveColor(15, {}), "#ffffff");
  // 16 → start of the 6×6×6 cube
  assert.equal(resolveColor(16, {}), "#000000");
  assert.equal(resolveColor(231, {}), "#ffffff");
  // 232 → start of the grayscale ramp
  assert.equal(resolveColor(232, {}), "#000000");
  assert.equal(resolveColor(255, {}), "#ffffff");
  assert.equal(resolveColor("242", {}), resolveColor(242, {}));
});

test("resolveColor returns empty for the terminal-default empty string", () => {
  assert.equal(resolveColor("", {}), "");
  assert.equal(resolveColor("   ", {}), "");
  assert.equal(resolveColor(undefined, {}), "");
});

test("resolveVars resolves a palette block", () => {
  const vars = resolveVars({ bg0: "#282828", red: 9 });
  assert.equal(vars.bg0, "#282828");
  assert.equal(vars.red, "#ff0000");
});

test("resolveColors fills the search-match fallbacks from selectedBg/text", () => {
  const colors = resolveColors(
    { text: "#eeeeee", selectedBg: "#333333", searchMatchBg: "", searchMatchText: "" },
    {},
  );
  assert.equal(colors.searchMatchBg, "#333333");
  assert.equal(colors.searchMatchText, "#eeeeee");
});

test("resolveColors keeps explicit search-match values", () => {
  const colors = resolveColors(
    { text: "#eeeeee", selectedBg: "#333333", searchMatchBg: "#ff00ff", searchMatchText: "#000000" },
    {},
  );
  assert.equal(colors.searchMatchBg, "#ff00ff");
  assert.equal(colors.searchMatchText, "#000000");
});

// ─── Colour helpers ─────────────────────────────────────────────────────────

test("withAlpha emits rgba and clamps out-of-range alpha", () => {
  assert.equal(withAlpha("#ff0000", 0.5), "rgba(255, 0, 0, 0.5)");
  assert.equal(withAlpha("#ff0000", 2), "rgba(255, 0, 0, 1)");
  assert.equal(withAlpha("#ff0000", -1), "rgba(255, 0, 0, 0)");
  // Unparseable input is returned untouched rather than silently becoming black.
  assert.equal(withAlpha("not-a-colour", 0.5), "not-a-colour");
});

test("relativeLuminance orders black < white and mix interpolates", () => {
  assert.ok(relativeLuminance("#000000") < relativeLuminance("#ffffff"));
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
});

test("contrastText picks the readable foreground", () => {
  assert.equal(contrastText("#ffffff"), "#161616");
  assert.equal(contrastText("#000000"), "#ffffff");
  assert.ok(contrastRatio(contrastText("#3b82f6"), "#3b82f6") >= 4.5);
});

test("ensureContrast only intervenes below the requested ratio", () => {
  const bg = "#ffffff";
  // Already readable — returned unchanged.
  assert.equal(ensureContrast("#000000", bg, 3), "#000000");
  // Too faint — darkened until it reaches the minimum.
  const fixed = ensureContrast("#fefefe", bg, 3);
  assert.notEqual(fixed, "#fefefe");
  assert.ok(contrastRatio(fixed, bg) >= 3);
});

// ─── Filename convention ────────────────────────────────────────────────────

test("parseThemeFilename splits the -dark / -light suffix case-insensitively", () => {
  assert.deepEqual(parseThemeFilename("gruvbox-dark.json"), { base: "gruvbox", variant: "dark" });
  assert.deepEqual(parseThemeFilename("Gruvbox-Light.json"), { base: "Gruvbox", variant: "light" });
  assert.deepEqual(parseThemeFilename("monokai.json"), { base: "monokai", variant: null });
});

test("themeNameToDisplay title-cases kebab and snake names", () => {
  assert.equal(themeNameToDisplay("orbital-rose"), "Orbital Rose");
  assert.equal(themeNameToDisplay("miku_aqua"), "Miku Aqua");
});

// ─── Codex token mapping ────────────────────────────────────────────────────

test("mapToCodexTokens emits every required Codex token", () => {
  const css = mapToCodexTokens(
    resolveColors({ text: "#e8e8e8", accent: "#ff8800", success: "#00aa00", error: "#cc0000", warning: "#ddaa00" }, {}),
    { bg0: "#1a1a1a", bg1: "#242424", bg2: "#2e2e2e", fg0: "#e8e8e8" },
  );
  for (const token of PI_THEME_CSS_VARS) {
    assert.ok(css[token], `${token} should be defined, got ${JSON.stringify(css[token])}`);
  }
});

test("mapToCodexTokens derives dark-theme surfaces and the inverted primary button", () => {
  const css = mapToCodexTokens(
    resolveColors({ text: "#e8e8e8" }, {}),
    { bg0: "#1a1a1a", bg1: "#242424", bg2: "#2e2e2e", fg0: "#e8e8e8" },
  );
  assert.equal(css["--bg"], "#1a1a1a");
  assert.equal(css["--bg-panel"], "#242424");
  // Dark themes raise surfaces toward the foreground.
  assert.notEqual(css["--bg-elev"], css["--bg"]);
  // Primary button is monochrome inverted, never the accent.
  assert.equal(css["--primary-bg"], "#e8e8e8");
  assert.equal(css["--primary-fg"], "#1a1a1a");
  // Assistant messages sit directly on the page background.
  assert.equal(css["--assistant-bg"], "transparent");
});

test("mapToCodexTokens keeps light-theme elevated surfaces at the base colour", () => {
  const css = mapToCodexTokens(
    resolveColors({ text: "#1a1a1a" }, {}),
    { bg0: "#ffffff", bg1: "#f5f5f5", fg0: "#1a1a1a" },
  );
  assert.equal(css["--bg-elev"], "#ffffff");
  assert.equal(css["--primary-bg"], "#1a1a1a");
  assert.equal(css["--primary-fg"], "#ffffff");
});

test("mapToCodexTokens fall-derives the hairline ladder from the pi border colour", () => {
  const css = mapToCodexTokens(
    resolveColors({ text: "#e8e8e8", border: "#5a5a5a" }, {}),
    { bg0: "#1a1a1a", bg1: "#242424", fg0: "#e8e8e8" },
  );
  assert.equal(css["--border-strong"], "rgba(90, 90, 90, 0.55)");
  assert.equal(css["--border"], "rgba(90, 90, 90, 0.34)");
  assert.equal(css["--border-faint"], "rgba(90, 90, 90, 0.18)");
});

test("mapToCodexTokens falls back to a derived border when pi declares none", () => {
  const css = mapToCodexTokens(
    resolveColors({ text: "#e8e8e8" }, {}),
    { bg0: "#1a1a1a", bg1: "#242424", bg2: "#2e2e2e", bg3: "#383838", fg0: "#e8e8e8" },
  );
  assert.equal(css["--border"], "rgba(56, 56, 56, 0.34)");
});

test("mapToCodexTokens reuses the pi user-message surface only when it differs from bg0", () => {
  const withOwn = mapToCodexTokens(
    resolveColors({ text: "#e8e8e8", userMessageBg: "#1e2a2b" }, {}),
    { bg0: "#1a1a1a", bg1: "#242424", fg0: "#e8e8e8" },
  );
  assert.equal(withOwn["--user-bg"], "#1e2a2b");

  const sameAsBg = mapToCodexTokens(
    resolveColors({ text: "#e8e8e8", userMessageBg: "#1a1a1a" }, {}),
    { bg0: "#1a1a1a", bg1: "#242424", fg0: "#e8e8e8" },
  );
  // Falls back to a translucent overlay rather than a solid identical to the page.
  assert.equal(sameAsBg["--user-bg"], "rgba(232, 232, 232, 0.05)");
});

test("ALL_COLOR_TOKENS covers the pi schema including the search-match pair", () => {
  assert.ok(ALL_COLOR_TOKENS.includes("searchMatchBg"));
  assert.ok(ALL_COLOR_TOKENS.includes("searchMatchText"));
  assert.ok(ALL_COLOR_TOKENS.includes("toolDiffAdded"));
  assert.equal(new Set(ALL_COLOR_TOKENS).size, ALL_COLOR_TOKENS.length);
});

// ─── Bundled themes ─────────────────────────────────────────────────────────

test("listThemeSets includes the bundled sets", () => {
  const sets = listThemeSets(undefined, BUILTIN_THEMES);
  const names = sets.map((s) => s.name);
  for (const expected of ["gruvbox", "miku-aqua", "orbital-rose", "scarlet-tether", "solarized"]) {
    assert.ok(names.includes(expected), `missing bundled theme set: ${expected}`);
  }
  // Bundled sets must be flagged so the settings UI can label them.
  assert.equal(sets.find((s) => s.name === "gruvbox")?.builtin, true);
  assert.equal(sets.find((s) => s.name === "gruvbox")?.hasDark, true);
  assert.equal(sets.find((s) => s.name === "gruvbox")?.hasLight, true);
});

test("listThemeSets without builtins still lists only what is on disk", () => {
  const sets = listThemeSets();
  assert.equal(sets.some((s) => s.name === "gruvbox"), false);
});

test("every bundled set resolves both variants to a full Codex token map", () => {
  for (const name of ["gruvbox", "miku-aqua", "orbital-rose", "scarlet-tether", "solarized"]) {
    for (const variant of ["dark", "light"]) {
      const resolved = resolveTheme(name, variant, undefined, BUILTIN_THEMES);
      assert.ok(resolved, `${name} ${variant} should resolve`);
      for (const token of PI_THEME_CSS_VARS) {
        assert.ok(resolved.cssVars[token], `${name}/${variant} missing ${token}`);
      }
      assert.equal(resolved.isDark, variant === "dark", `${name} ${variant} polarity`);
    }
  }
});

test("resolveTheme returns null for unknown names and empty input", () => {
  assert.equal(resolveTheme("", "dark", undefined, BUILTIN_THEMES), null);
  assert.equal(resolveTheme("definitely-not-a-theme-xyz", "dark", undefined, BUILTIN_THEMES), null);
  // Without the injected registry, a bundled name is simply unknown.
  assert.equal(resolveTheme("gruvbox", "dark"), null);
});

test("resolveTheme falls back to the opposite variant for single-variant sets", () => {
  // A synthetic dark-only set: every bundled set ships both variants, so using
  // one of those would never reach the `builtin.light ?? builtin.dark` fallback.
  const gruvbox = BUILTIN_THEMES.find((set) => set.name === "gruvbox");
  assert.ok(gruvbox);
  const darkOnly = { name: "gruvbox", dark: gruvbox.dark };
  const resolved = resolveTheme("gruvbox", "light", undefined, [darkOnly]);
  assert.ok(resolved);
  assert.equal(resolved.isDark, true);
});
