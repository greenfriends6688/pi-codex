/**
 * Client-side constants and the pre-paint bootstrap for the pi CLI theme
 * overlay.
 *
 * Deliberately **not** a "use client" module: `app/layout.tsx` is a server
 * component and needs `PI_THEME_INIT_SCRIPT`, and importing a plain value out of
 * a client-boundary module would hand it a client reference instead of the
 * string.
 *
 * `PI_THEME_CSS_VARS` is duplicated from `lib/pi-theme.ts` on purpose: that
 * module reads theme files off disk and therefore imports `fs`/`os`, so it can
 * never be pulled into a client bundle. `lib/pi-theme-tokens.test.mjs` asserts
 * the two lists stay identical, which is what keeps the duplication safe.
 */

export const PI_THEME_NAME_KEY = "pi-pi-theme-name";
export const PI_THEME_CACHE_KEY = "pi-pi-theme-cache";
/** cwd of the active theme, so a project-local theme keeps resolving after a reload. */
export const PI_THEME_CWD_KEY = "pi-pi-theme-cwd";

/** Emitted on `<html>` while a pi theme is layered on top of a Codex palette. */
export const PI_THEME_ATTR = "data-pi-theme";

/**
 * Every CSS custom property the pi-theme overlay writes onto `<html>`.
 *
 * Geometry tokens (`--radius-*`, `--text-*`, `--control-*`, `--shadow-*`) are
 * deliberately absent: a terminal theme changes colours, not layout.
 */
export const PI_THEME_CSS_VARS = [
  // surfaces
  "--bg", "--bg-panel", "--bg-elev", "--bg-hover", "--bg-selected", "--bg-subtle",
  // hairlines
  "--border", "--border-strong", "--border-faint",
  // foreground
  "--text", "--text-muted", "--text-dim",
  // accent family
  "--accent", "--accent-hover", "--accent-contrast", "--accent-soft", "--accent-border",
  // monochrome primary action
  "--primary-bg", "--primary-fg", "--primary-hover",
  // message surfaces
  "--user-bg", "--assistant-bg", "--tool-bg", "--code-bg",
  // semantics
  "--danger", "--danger-soft", "--success", "--success-soft",
  "--warning", "--warning-soft", "--diff-added", "--diff-removed",
  // misc
  "--focus-ring", "--scrim",
] as const;

/**
 * Re-applies the cached pi theme before first paint.
 *
 * Runs after `THEME_INIT_SCRIPT`, which is what sets `.dark` — the overlay's
 * light/dark variant is picked from that class, so the ordering matters.
 */
export const PI_THEME_INIT_SCRIPT = `(function(){try{
var el=document.documentElement;
var name=localStorage.getItem(${JSON.stringify(PI_THEME_NAME_KEY)});
if(!name)return;
var raw=localStorage.getItem(${JSON.stringify(PI_THEME_CACHE_KEY)});
var cache=raw?JSON.parse(raw):{};
var mode=el.classList.contains("dark")?"dark":"light";
var vars=cache[name+"::"+mode]||cache[name+"::"+(mode==="dark"?"light":"dark")];
if(!vars)return;
var tokens=${JSON.stringify([...PI_THEME_CSS_VARS])};
for(var i=0;i<tokens.length;i++){var v=vars[tokens[i]];if(v)el.style.setProperty(tokens[i],v)}
el.setAttribute(${JSON.stringify(PI_THEME_ATTR)},name);
}catch(e){}})();`;

/**
 * Snapshot variables the border-depth slider blends from.
 *
 * Inlined as string literals rather than imported from `lib/border-depth.ts`:
 * this module must stay import-free so the Node test runner can load it through
 * the same ESM graph as `lib/pi-theme.ts` (see the note at the top).
 */
export const PI_THEME_BORDER_SNAPSHOT = [
  "--border-orig", "--border-strong-orig", "--border-faint-orig",
] as const;