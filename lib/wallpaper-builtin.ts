/**
 * Built-in wallpapers: the Monet paintings that ship with the desktop build.
 *
 * Users overwhelmingly want a wallpaper they did not have to find, and picking
 * one image per theme is what makes a default feel considered rather than
 * random — switching the palette or the pi theme swaps the painting with it.
 *
 * Resolution order in `resolveWallpaperSrc`:
 *   1. the user's own image;
 *   2. the painting matching the active **pi theme** (the more specific choice);
 *   3. the painting matching the active **Codex palette**;
 *   4. `default.jpg`.
 *
 * The paintings are the upstream author's `public/monet-artworks/*.jpg` set,
 * copied verbatim. They are static assets served from `/public` and rendered
 * into an `<img src>`, so the SVG restriction that applies to *user* uploads
 * does not apply here.
 */

const PAINTING_DIR = "/monet-artworks";

/** pi CLI theme base name → painting. */
const PI_THEME_PAINTING: Record<string, string> = {
  gruvbox: "gruvbox",
  "miku-aqua": "aqua",
  "orbital-rose": "rose",
  "scarlet-tether": "tether",
  solarized: "solarized",
};

/**
 * Codex palette id → painting.
 *
 * The two dark palettes reuse the darker paintings (`solarized`, `gruvbox`);
 * pointing them at `default` would put a bright canvas behind a dark UI and
 * force a heavy scrim, which is the one thing that makes a wallpaper look cheap.
 */
const PALETTE_PAINTING: Record<string, string> = {
  light: "default",
  dark: "solarized",
  mist: "aqua",
  rose: "rose",
  pine: "gruvbox",
};

export const DEFAULT_WALLPAPER_PAINTING = "default";

/** Painting name for the given palette and pi theme. */
export function builtinPaintingFor(palette: string | null | undefined, piTheme?: string | null): string {
  if (piTheme && PI_THEME_PAINTING[piTheme]) return PI_THEME_PAINTING[piTheme];
  if (palette && PALETTE_PAINTING[palette]) return PALETTE_PAINTING[palette];
  return DEFAULT_WALLPAPER_PAINTING;
}

/** Absolute `/public` path for a painting. */
export function paintingPath(name: string): string {
  return `${PAINTING_DIR}/${name}.jpg`;
}

/** The built-in wallpaper path for the given palette + pi theme. */
export function builtinWallpaperFor(palette: string | null | undefined, piTheme?: string | null): string {
  return paintingPath(builtinPaintingFor(palette, piTheme));
}

/**
 * Read the active theme identity from `<html>`.
 *
 * A pi theme overlay keeps the Codex palette's `data-theme`, so both values are
 * needed to pick the most specific painting.
 */
export function activeThemeIdentity(): { palette: string; piTheme: string } {
  if (typeof document === "undefined") return { palette: "", piTheme: "" };
  const el = document.documentElement;
  return {
    palette: el.dataset.theme ?? "",
    piTheme: el.getAttribute("data-pi-theme") ?? "",
  };
}

/** User image when set, otherwise the built-in painting for the active theme. */
export function resolveWallpaperSrc(url: string, palette: string, piTheme: string): string {
  return url || builtinWallpaperFor(palette, piTheme);
}
