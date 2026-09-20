/**
 * Built-in wallpapers: the paintings bundled with the desktop build, shown when
 * the user has not picked an image of their own.
 *
 * Resolution order in `resolveWallpaperSrc`:
 *   1. the user's own image;
 *   2. the built-in the user picked (`BUILTIN_WALLPAPERS`);
 *   3. the painting matching the active **Codex palette**;
 *   4. `DEFAULT_WALLPAPER_PAINTING`.
 *
 * These are static assets served from `/public` and rendered into an `<img src>`,
 * so the SVG restriction that applies to *user* uploads does not apply here.
 *
 * `public/monet-artworks/` still holds the upstream author's original Monet set
 * (`aqua` `gruvbox` `rose` `solarized` `tether`). Nothing points at them since the
 * default was replaced; they are kept on disk so a palette can pick its own art
 * again without re-adding the files. The directory name predates the portraits.
 */

const PAINTING_DIR = "/monet-artworks";

/**
 * Codex palette id → painting.
 *
 * Both palettes resolve to the same image now. The per-palette split used to be
 * deliberate — the dark palettes took the darker paintings (`solarized`,
 * `gruvbox`), because a bright canvas behind a dark UI needs a heavy scrim and
 * that is the one thing that makes a wallpaper look cheap. Keep the map so that
 * argument still has somewhere to live if a palette wants its own art back.
 */
const PALETTE_PAINTING: Record<string, string> = {
  light: "zhang-ruonan",
  dark: "zhang-ruonan",
};

/**
 * The built-in wallpapers a user can pick between, in display order.
 *
 * `labelKey` rather than the display text: the names are proper nouns and are
 * identical in every locale, but they still have to come from the catalog or the
 * zh/en key-lockstep test has nothing to check them against.
 */
export const BUILTIN_WALLPAPERS = [
  { id: "zhang-ruonan", labelKey: "settings.wallpaperBuiltinZhangRuonan" },
  { id: "cai-xukun", labelKey: "settings.wallpaperBuiltinCaiXukun" },
] as const;

export type BuiltinWallpaperId = (typeof BUILTIN_WALLPAPERS)[number]["id"];

export const DEFAULT_WALLPAPER_PAINTING: BuiltinWallpaperId = "zhang-ruonan";

/**
 * Guard for the id read back out of localStorage.
 *
 * A stored id can outlive the wallpaper it names (a built-in gets removed), and
 * an unknown id must fall through to the default instead of producing a 404 the
 * `<img>` would swallow into a blank workspace.
 */
export function isBuiltinWallpaperId(value: unknown): value is BuiltinWallpaperId {
  return typeof value === "string" && BUILTIN_WALLPAPERS.some((item) => item.id === value);
}

/** Painting name for the given palette, unless the user picked one and it still exists. */
export function builtinPaintingFor(
  palette: string | null | undefined,
  chosen?: string | null,
): string {
  if (isBuiltinWallpaperId(chosen)) return chosen;
  if (palette && PALETTE_PAINTING[palette]) return PALETTE_PAINTING[palette];
  return DEFAULT_WALLPAPER_PAINTING;
}

/** Absolute `/public` path for a painting. */
export function paintingPath(name: string): string {
  return `${PAINTING_DIR}/${name}.jpg`;
}

/** The built-in wallpaper path for the given palette and optional user pick. */
export function builtinWallpaperFor(
  palette: string | null | undefined,
  chosen?: string | null,
): string {
  return paintingPath(builtinPaintingFor(palette, chosen));
}

/** Read the active Codex palette from `<html>`. */
export function activeThemePalette(): string {
  if (typeof document === "undefined") return "";
  return document.documentElement.dataset.theme ?? "";
}

/** User image when set, otherwise the built-in for the palette / user pick. */
export function resolveWallpaperSrc(
  url: string,
  palette: string,
  chosen?: string | null,
): string {
  return url || builtinWallpaperFor(palette, chosen);
}
