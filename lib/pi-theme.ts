/**
 * pi CLI theme engine.
 *
 * Loads pi CLI theme JSON files (from `~/.pi/agent/themes/` or
 * `<cwd>/.pi/themes/`), resolves `vars` references, and maps the pi CLI colour
 * tokens onto the **Codex skin's token set**.
 *
 * Why this exists: pi CLI themes are a public contract of the pi ecosystem
 * (`theme-schema.json` in the coding-agent package). Reading them means the web
 * UI's colours follow the user's terminal theme instead of diverging from it.
 *
 * Design note - this is a **layering** engine, not a replacement for the six
 * Codex palettes in `app/globals.css`:
 *   - `data-theme` keeps selecting one of the six Codex palettes;
 *   - an active pi theme is applied as *inline* CSS custom properties on
 *     `<html>`, which win over the palette block by specificity;
 *   - switching back to a Codex palette must `removeProperty()` every token in
 *     `PI_THEME_CSS_VARS` (see `clearPiThemeVars()` in `hooks/usePiTheme.ts`).
 * Geometry (`--radius-*`, `--text-*`, `--control-*`, `--shadow-*`) is never
 * touched, so a pi theme only changes colours.
 *
 * pi CLI theme format:
 *   { name, vars: { key: hex|number, ... }, colors: { token: hex|number|varRef|"", ... } }
 *
 * Colour values can be:
 *   - Hex string: "#ff0000"
 *   - 256-colour index: 242
 *   - Variable reference: "primary" (resolved from vars)
 *   - Empty string "": terminal default (derived from the base palette)
 *
 * The bundled fallback set is **injected** (see `lib/pi-theme-builtin.ts`) rather
 * than imported, so this module has no value imports and can be loaded by
 * `node --test` without any loader configuration.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";

// --- Types ------------------------------------------------------------------

export interface PiTheme {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
  /** Present in upstream JSON files; ignored by the engine. */
  $schema?: string;
}

/** A bundled theme set, pairing a dark and/or light variant by base name. */
export interface BuiltinThemeSet {
  /** Base name, e.g. "gruvbox". */
  name: string;
  dark?: PiTheme;
  light?: PiTheme;
}

/** Represents a paired theme set (e.g. "gruvbox" with dark + light variants). */
export interface ThemeSetInfo {
  /** Base name (e.g. "gruvbox") - used as the stable identifier. */
  name: string;
  /** Human-readable display name. */
  displayName: string;
  /** Whether this set has a dark variant. */
  hasDark: boolean;
  /** Whether this set has a light variant. */
  hasLight: boolean;
  /** True for a bundled theme (no JSON files on disk). */
  builtin: boolean;
}

/** A resolved, ready-to-use theme (one variant of a set). */
export interface ResolvedTheme {
  /** Base theme-set name. */
  name: string;
  /** Whether this specific variant is dark. */
  isDark: boolean;
  /** CSS variable name -> colour value (e.g. "--bg" -> "#282828") */
  cssVars: Record<string, string>;
}

export type ThemeVariant = "dark" | "light";

// --- 256-colour palette -> hex ----------------------------------------------

// Standard xterm 256-colour palette. 0-15: ANSI, 16-231: 6x6x6 cube, 232-255: grayscale.
function ansiToHex(code: number): string {
  const ansi: Record<number, string> = {
    0: "#000000", 1: "#800000", 2: "#008000", 3: "#808000",
    4: "#000080", 5: "#800080", 6: "#008080", 7: "#c0c0c0",
    8: "#808080", 9: "#ff0000", 10: "#00ff00", 11: "#ffff00",
    12: "#0000ff", 13: "#ff00ff", 14: "#00ffff", 15: "#ffffff",
  };
  if (code in ansi) return ansi[code];

  if (code >= 16 && code <= 231) {
    const n = code - 16;
    const r = Math.round((Math.floor(n / 36) % 6) * (255 / 5));
    const g = Math.round((Math.floor(n / 6) % 6) * (255 / 5));
    const b = Math.round((n % 6) * (255 / 5));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  if (code >= 232 && code <= 255) {
    const v = Math.round(((code - 232) / 23) * 255);
    const h = v.toString(16).padStart(2, "0");
    return `#${h}${h}${h}`;
  }

  return "#000000";
}

// --- Colour resolution ------------------------------------------------------

/**
 * Resolve a single colour value to a hex string.
 * - Hex string: returned as-is (lowercased)
 * - Number: treated as a 256-colour index
 * - String matching a var name: resolved from vars
 * - Empty string: returns empty (caller substitutes a default)
 */
export function resolveColor(
  value: string | number | undefined,
  vars: Record<string, string>,
): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return ansiToHex(value);
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed.startsWith("#")) return trimmed.toLowerCase();
  if (vars[trimmed]) return vars[trimmed].toLowerCase();
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed === String(num)) return ansiToHex(num);
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return trimmed.toLowerCase();
}

/** Resolve all `vars` entries to hex strings. */
export function resolveVars(vars: Record<string, string | number> | undefined): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!vars) return resolved;
  for (const [key, value] of Object.entries(vars)) {
    resolved[key] = resolveColor(value, {});
  }
  return resolved;
}

/** Resolve all `colors` entries, expanding var references. */
export function resolveColors(
  colors: Record<string, string | number>,
  vars: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    resolved[key] = resolveColor(value, vars);
  }
  // Match pi's own withThemeColorFallbacks so parsed themes carry the same
  // search-match semantics as the TUI even when the tokens are absent.
  resolved.searchMatchBg ||= resolved.selectedBg || "";
  resolved.searchMatchText ||= resolved.text || "";
  return resolved;
}

// --- Colour manipulation helpers --------------------------------------------

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Lighten a hex colour by mixing with white. factor 0 = no change, 1 = white. */
export function lighten(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(
    Math.round(r + (255 - r) * factor),
    Math.round(g + (255 - g) * factor),
    Math.round(b + (255 - b) * factor),
  );
}

/** Darken a hex colour by mixing with black. factor 0 = no change, 1 = black. */
export function darken(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(
    Math.round(r * (1 - factor)),
    Math.round(g * (1 - factor)),
    Math.round(b * (1 - factor)),
  );
}

/** Mix two hex colours. factor 0 = all a, factor 1 = all b. */
export function mix(a: string, b: string, factor: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  return rgbToHex(
    Math.round(ra[0] + (rb[0] - ra[0]) * factor),
    Math.round(ra[1] + (rb[1] - ra[1]) * factor),
    Math.round(ra[2] + (rb[2] - ra[2]) * factor),
  );
}

/** Alpha variant of a hex colour. Returns the input untouched when unparseable. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Number(clamped.toFixed(3))})`;
}

/** Relative luminance (0-1). Decides dark vs light and the text colour on an accent. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [rs, gs, bs] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLum = relativeLuminance(foreground);
  const backgroundLum = relativeLuminance(background);
  return (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05);
}

/** Black or white, whichever reads better on the given colour. */
export function contrastText(hex: string): string {
  return contrastRatio("#ffffff", hex) >= contrastRatio("#000000", hex) ? "#ffffff" : "#161616";
}

/**
 * Preserve a colour's hue while making a modest contrast adjustment.
 * Kept for parity with the reference implementation: 3:1 keeps green and yellow
 * distinguishable in light themes better than forcing 4.5:1 on every status colour.
 */
export function ensureContrast(color: string, background: string, minimum = 3): string {
  if (!hexToRgb(color) || !hexToRgb(background) || contrastRatio(color, background) >= minimum) {
    return color;
  }
  const darkenForContrast = relativeLuminance(background) > relativeLuminance(color);
  for (let step = 1; step <= 20; step += 1) {
    const candidate = darkenForContrast
      ? darken(color, step * 0.05)
      : lighten(color, step * 0.05);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return darkenForContrast ? "#000000" : "#ffffff";
}

// --- pi token -> Codex token mapping ----------------------------------------

/**
 * Every CSS custom property this engine writes onto `<html>`.
 *
 * `clearPiThemeVars()` MUST remove exactly this list, otherwise switching back
 * to a Codex palette leaves stale inline colours behind - the single most common
 * bug in a layering theme system.
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
 * Maps resolved pi CLI theme colours + vars onto the Codex skin's token set.
 *
 * The Codex tokens are **translucent** by design (hairlines and overlays are an
 * alpha of the foreground so they layer correctly over `--bg`, `--bg-panel` and
 * `--bg-elev` alike). pi CLI tokens are mostly solid. The mapping therefore keeps
 * the pi theme's *hue* and re-derives Codex's *alpha ladder* on top of it, which
 * is what makes a pi theme land in the same visual range as a Codex palette
 * instead of looking like a different design.
 */
export function mapToCodexTokens(
  colors: Record<string, string>,
  vars: Record<string, string>,
): Record<string, string> {
  const bg0 = vars.bg0 || "#1a1a1a";
  const fg0 = vars.fg0 || "#e8e8e8";
  const bg1 = vars.bg1 || mix(bg0, fg0, 0.06);
  const bg2 = vars.bg2 || mix(bg0, fg0, 0.12);

  const isDark = relativeLuminance(bg0) < 0.5;

  const text = colors.text || fg0;
  const borderSource = colors.border || vars.bg3 || mix(bg0, text, 0.3);
  const accent = colors.accent || vars.orange || vars.blue || vars.green || "#3b82f6";
  const success = colors.success || vars.green || "#16a34a";
  const error = colors.error || vars.red || "#dc2626";
  const warning = colors.warning || vars.orange || "#d97706";

  const css: Record<string, string> = {};

  // Surfaces
  css["--bg"] = bg0;
  css["--bg-panel"] = bg1;
  // Elevated surfaces move toward the foreground in dark themes and stay at the
  // base colour in light themes (a white app has nowhere lighter to go).
  css["--bg-elev"] = isDark ? mix(bg0, text, 0.07) : bg0;
  css["--bg-hover"] = withAlpha(text, isDark ? 0.06 : 0.055);
  css["--bg-selected"] = withAlpha(text, isDark ? 0.1 : 0.095);
  css["--bg-subtle"] = withAlpha(text, 0.032);

  // Hairlines: the pi border colour, alpha-laddered onto Codex's three steps.
  // pi's own border colour is already tuned against its background, so the same
  // alphas read correctly in both polarities.
  css["--border-strong"] = withAlpha(borderSource, 0.55);
  css["--border"] = withAlpha(borderSource, 0.34);
  css["--border-faint"] = withAlpha(borderSource, 0.18);

  // Foreground: Codex uses a three-step alpha ramp off one text colour.
  css["--text"] = text;
  css["--text-muted"] = withAlpha(text, 0.72);
  css["--text-dim"] = withAlpha(text, 0.52);

  // Accent
  css["--accent"] = accent;
  css["--accent-hover"] = isDark ? lighten(accent, 0.14) : darken(accent, 0.12);
  css["--accent-contrast"] = contrastText(accent);
  css["--accent-soft"] = withAlpha(accent, isDark ? 0.16 : 0.12);
  css["--accent-border"] = withAlpha(accent, 0.5);

  // Primary action: Codex's primary button is monochrome (inverted foreground),
  // never the accent, so it stays out of the way of the accent's meaning.
  css["--primary-bg"] = text;
  css["--primary-fg"] = bg0;
  css["--primary-hover"] = mix(text, bg0, 0.12);

  // Message surfaces
  const userBg = colors.userMessageBg || "";
  css["--user-bg"] = userBg && userBg !== bg0 ? userBg : withAlpha(text, 0.05);
  css["--assistant-bg"] = "transparent";
  const toolBg = colors.toolSuccessBg || "";
  css["--tool-bg"] = toolBg && toolBg !== bg0 ? toolBg : (isDark ? bg2 : bg1);
  css["--code-bg"] = css["--tool-bg"];

  // Semantics
  css["--danger"] = error;
  css["--danger-soft"] = withAlpha(error, isDark ? 0.18 : 0.11);
  css["--success"] = success;
  css["--success-soft"] = withAlpha(success, isDark ? 0.18 : 0.12);
  css["--warning"] = warning;
  css["--warning-soft"] = withAlpha(warning, isDark ? 0.18 : 0.13);
  css["--diff-added"] = withAlpha(colors.toolDiffAdded || success, isDark ? 0.24 : 0.16);
  css["--diff-removed"] = withAlpha(colors.toolDiffRemoved || error, isDark ? 0.24 : 0.16);

  // Misc
  css["--focus-ring"] = withAlpha(accent, 0.7);
  css["--scrim"] = isDark ? "rgba(0, 0, 0, 0.62)" : "rgba(0, 0, 0, 0.45)";

  return css;
}

// --- Theme loading ----------------------------------------------------------

/** All pi CLI colour tokens (53 tokens, incl. the fullscreen search-match pair). */
export const ALL_COLOR_TOKENS = [
  "accent", "border", "borderAccent", "borderMuted",
  "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  "selectedBg", "userMessageBg", "userMessageText",
  "customMessageBg", "customMessageText", "customMessageLabel",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
  "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "thinkingMax",
  "bashMode",
  "searchMatchBg", "searchMatchText",
] as const;

/**
 * Parse a pi CLI theme JSON file.
 * Validates required fields and fills in missing colour tokens with empty strings
 * (so a schema drift upstream degrades to "token absent", never a crash).
 */
export function parseThemeFile(path: string): PiTheme | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const json = JSON.parse(raw) as Record<string, unknown>;

    if (typeof json.name !== "string" || !json.name) return null;
    if (typeof json.colors !== "object" || json.colors === null) return null;

    const source = json.colors as Record<string, string | number>;
    const colors: Record<string, string | number> = {};
    for (const token of ALL_COLOR_TOKENS) {
      colors[token] = source[token] ?? "";
    }

    return {
      name: json.name,
      vars: typeof json.vars === "object" && json.vars !== null
        ? (json.vars as Record<string, string | number>)
        : undefined,
      colors,
    };
  } catch {
    return null;
  }
}

/** Normalize a bundled/in-memory theme the same way `parseThemeFile` does. */
export function normalizeTheme(theme: PiTheme): PiTheme {
  const colors: Record<string, string | number> = {};
  for (const token of ALL_COLOR_TOKENS) {
    colors[token] = theme.colors[token] ?? "";
  }
  return { name: theme.name, vars: theme.vars, colors };
}

// --- File-name convention helpers -------------------------------------------

/**
 * Detect the base name and variant from a theme filename.
 *
 *   gruvbox-dark.json  -> { base: "gruvbox", variant: "dark" }
 *   gruvbox-light.json -> { base: "gruvbox", variant: "light" }
 *   monokai.json       -> { base: "monokai", variant: null }
 */
export function parseThemeFilename(
  filename: string,
): { base: string; variant: ThemeVariant | null } {
  const stem = basename(filename, extname(filename));

  const darkMatch = /^(.+)-dark$/i.exec(stem);
  if (darkMatch) return { base: darkMatch[1], variant: "dark" };

  const lightMatch = /^(.+)-light$/i.exec(stem);
  if (lightMatch) return { base: lightMatch[1], variant: "light" };

  return { base: stem, variant: null };
}

interface ScannedFile {
  base: string;
  variant: ThemeVariant;
}

/** Scan a directory for pi CLI theme JSON files. */
function scanThemeDir(dir: string): ScannedFile[] {
  const results: ScannedFile[] = [];
  try {
    if (!existsSync(dir)) return results;
    for (const entry of readdirSync(dir)) {
      if (extname(entry) !== ".json") continue;
      const fullPath = join(dir, entry);
      try {
        if (!statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }
      const theme = parseThemeFile(fullPath);
      if (!theme) continue;
      const parsed = parseThemeFilename(entry);
      const vars = resolveVars(theme.vars);
      const isDark = relativeLuminance(vars.bg0 || "#1a1a1a") < 0.5;
      // When the filename carries no variant, infer it from the content.
      results.push({ base: parsed.base, variant: parsed.variant ?? (isDark ? "dark" : "light") });
    }
  } catch {
    // Permission errors, locked directories, ...
  }
  return results;
}

/** Turn a kebab-case theme name into a display-friendly title. */
export function themeNameToDisplay(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Directories searched for user themes, in precedence order. */
function userThemeDirs(projectCwd?: string): string[] {
  const dirs = [join(homedir(), ".pi", "agent", "themes")];
  if (projectCwd) dirs.push(join(projectCwd, ".pi", "themes"));
  return dirs;
}

/** List all available theme sets (user themes + injected bundled sets). */
export function listThemeSets(
  projectCwd?: string,
  builtins: readonly BuiltinThemeSet[] = [],
): ThemeSetInfo[] {
  const result: ThemeSetInfo[] = [];
  const seen = new Set<string>();

  const allFiles: ScannedFile[] = [];
  for (const dir of userThemeDirs(projectCwd)) {
    allFiles.push(...scanThemeDir(dir));
  }

  const groups = new Map<string, ScannedFile[]>();
  for (const f of allFiles) {
    const list = groups.get(f.base) ?? [];
    list.push(f);
    groups.set(f.base, list);
  }

  for (const [base, files] of groups) {
    if (seen.has(base)) continue;
    seen.add(base);
    result.push({
      name: base,
      displayName: themeNameToDisplay(base),
      hasDark: files.some((f) => f.variant === "dark"),
      hasLight: files.some((f) => f.variant === "light"),
      builtin: false,
    });
  }

  // Bundled themes - only when no user theme shares the same base name
  // (user themes take precedence over a bundled theme of the same name).
  for (const builtin of builtins) {
    if (seen.has(builtin.name)) continue;
    seen.add(builtin.name);
    result.push({
      name: builtin.name,
      displayName: themeNameToDisplay(builtin.name),
      hasDark: !!builtin.dark,
      hasLight: !!builtin.light,
      builtin: true,
    });
  }

  return result;
}

/** Build a ResolvedTheme from already-parsed parts (shared by all lookup paths). */
function buildResolved(name: string, theme: PiTheme): ResolvedTheme {
  const normalized = normalizeTheme(theme);
  const vars = resolveVars(normalized.vars);
  const colors = resolveColors(normalized.colors, vars);
  const bg0 = vars.bg0 || "#1a1a1a";
  return {
    name,
    isDark: relativeLuminance(bg0) < 0.5,
    cssVars: mapToCodexTokens(colors, vars),
  };
}

/**
 * Resolve a specific variant of a theme set.
 *
 * Lookup order (user dirs first, then bundled):
 *   1. `{base}-{variant}.json` (e.g. `gruvbox-dark.json`)
 *   2. `{base}.json` (single-file fallback)
 *   3. the opposite variant (when only one variant exists)
 */
export function resolveTheme(
  name: string,
  variant: ThemeVariant,
  projectCwd?: string,
  builtins: readonly BuiltinThemeSet[] = [],
): ResolvedTheme | null {
  if (!name) return null;

  const candidates = [
    `${name}-${variant}.json`,
    `${name}.json`,
    `${name}-${variant === "dark" ? "light" : "dark"}.json`,
  ];

  for (const dir of userThemeDirs(projectCwd)) {
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate);
      if (!existsSync(fullPath)) continue;
      const theme = parseThemeFile(fullPath);
      if (!theme) continue;
      return buildResolved(name, theme);
    }
  }

  // Direct path (from settings or a CLI argument).
  if (existsSync(name)) {
    const theme = parseThemeFile(name);
    if (theme) return buildResolved(basename(name, extname(name)), theme);
  }

  // Bundled fallback. User themes and direct paths above take precedence.
  const builtin = builtins.find((t) => t.name === name);
  if (builtin) {
    const theme = variant === "light"
      ? (builtin.light ?? builtin.dark)
      : (builtin.dark ?? builtin.light);
    if (theme) return buildResolved(name, theme);
  }

  return null;
}
