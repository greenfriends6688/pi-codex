import assert from "node:assert/strict";
import test from "node:test";

// `lib/pi-theme.ts` reads theme files off disk (fs/os), so it can never be part
// of a client bundle. The overlay's token list therefore exists twice: once in
// that server module and once in `lib/pi-theme-client.ts`. This test is what
// makes the duplication safe — if the two ever drift, the pre-paint bootstrap
// would apply a different set of variables than the runtime does, which is
// exactly the class of bug that is invisible until a reload.
const { PI_THEME_CSS_VARS: serverList } = await import("./pi-theme.ts");
const { PI_THEME_CSS_VARS: clientList } = await import("./pi-theme-client.ts");

test("the server and client pi-theme token lists are identical", () => {
  assert.deepEqual([...clientList], [...serverList]);
});

test("the token list contains no geometry tokens", () => {
  // A terminal theme changes colours, not layout: a pi theme must never be able
  // to shift the app's geometry.
  for (const token of clientList) {
    assert.doesNotMatch(token, /^--(radius|text-\d|control|shadow|z-|motion|ease|height|spacing)/);
  }
});

test("the token list has no duplicates and covers the Codex palette blocks", () => {
  assert.equal(new Set(clientList).size, clientList.length);
  // The tokens the Codex palettes restate per theme must all be overridable, or
  // a pi theme would leave a palette colour showing through.
  for (const token of [
    "--bg", "--bg-panel", "--bg-elev", "--bg-hover", "--bg-selected", "--bg-subtle",
    "--border", "--border-strong", "--border-faint",
    "--text", "--text-muted", "--text-dim",
    "--accent", "--accent-hover", "--accent-contrast", "--accent-soft", "--accent-border",
    "--primary-bg", "--primary-fg", "--primary-hover",
    "--user-bg", "--assistant-bg", "--tool-bg", "--code-bg",
    "--danger", "--danger-soft", "--success", "--success-soft",
    "--warning", "--warning-soft", "--diff-added", "--diff-removed",
    "--focus-ring", "--scrim",
  ]) {
    assert.ok(clientList.includes(token), `missing ${token}`);
  }
});
