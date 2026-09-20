/**
 * Built-in wallpapers: the Monet paintings that ship with the desktop build.
 *
 * Users overwhelmingly want a wallpaper they did not have to find, and picking
 * one image per theme is what makes a default feel considered rather than
 * random — switching the palette swaps the painting with it.
 *
 * Resolution order in `resolveWallpaperSrc`:
 *   1. the user's own image;
 *   2. the painting matching the active **Codex palette**;
 *   3. `default.jpg`.
 *
 * The paintings are the upstream author's `public/monet-artworks/*.jpg` set,
 * copied verbatim. They are static assets served from `/public` and rendered
 * into an `<img src>`, so the SVG restriction that applies to *user* uploads
 * does not apply here.
 */

const PAINTING_DIR = "/monet-artworks";

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
};

export const DEFAULT_WALLPAPER_PAINTING = "default";

/** Painting name for the given palette. */
export function builtinPaintingFor(palette: string | null | undefined): string {
  if (palette && PALETTE_PAINTING[palette]) return PALETTE_PAINTING[palette];
  return DEFAULT_WALLPAPER_PAINTING;
}

/** Absolute `/public` path for a painting. */
export function paintingPath(name: string): string {
  return `${PAINTING_DIR}/${name}.jpg`;
}

/** The built-in wallpaper path for the given palette. */
export function builtinWallpaperFor(palette: string | null | undefined): string {
  return paintingPath(builtinPaintingFor(palette));
}

/** Read the active Codex palette from `<html>`. */
export function activeThemePalette(): string {
  if (typeof document === "undefined") return "";
  return document.documentElement.dataset.theme ?? "";
}

/** User image when set, otherwise the built-in painting for the active palette. */
export function resolveWallpaperSrc(url: string, palette: string): string {
  return url || builtinWallpaperFor(palette);
}
