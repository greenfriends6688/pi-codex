/**
 * Wallpaper feature — a user-supplied background image behind the workspace,
 * dimmed by a scrim of the app's own background colour.
 *
 * `<html>` state (all written by `hooks/useWallpaper.ts`):
 *   data-wallpaper        "on" while enabled
 *   data-wallpaper-ready  "1" once the image has decoded (fade-in gate)
 *   --wallpaper-scrim     scrim opacity percentage, e.g. "70%"
 *   data-wallpaper-input / -panel / -message
 *                         per-area effect mode: none | trans | blur
 *
 * Two constraints shape this module, both learned the hard way upstream:
 *
 *  1. **The image must be rendered into an `<img src>`, never a CSS property.**
 *     Chromium silently drops CSS property values above ~1MB, and a photo data
 *     URL easily exceeds that — a CSS-variable wallpaper just disappears.
 *
 *  2. **The scrim paints `--bg`, not a hard-coded colour.** Theming is what keeps
 *     text contrast intact across all six Codex palettes, so no palette token is
 *     ever rewritten by this feature. That is also why area modes only change
 *     *opacity* and *frost*, never hue.
 */

/** Scrim opacity range (%). Higher = more theme background, less wallpaper. */
export const WALLPAPER_SCRIM_MIN = 30;
export const WALLPAPER_SCRIM_MAX = 95;
export const WALLPAPER_SCRIM_DEFAULT = 70;

/** Downscale cap for the longest image edge (px) before storing. */
export const WALLPAPER_MAX_DIMENSION = 2560;

/**
 * Storage budget for the persisted data URL, in characters.
 *
 * localStorage holds ~5MB and base64 inflates by 4/3, so a photo has to be
 * re-encoded to fit. `fileToWallpaperDataUrl` tries JPEG first (photos are what
 * people actually use) and only then falls back to shrinking further.
 */
export const WALLPAPER_STORAGE_BUDGET = 3_900_000;

/**
 * Accepted image MIME types. **SVG is deliberately rejected**: it is a script
 * and entity attack surface, and it would be loaded from a data URL inside the
 * app's own origin.
 */
export const WALLPAPER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type WallpaperAreaMode = "none" | "trans" | "blur";

export const WALLPAPER_URL_KEY = "pi-wallpaper";
export const WALLPAPER_ENABLED_KEY = "pi-wallpaper-enabled";
export const WALLPAPER_SCRIM_KEY = "pi-wallpaper-scrim";
export const WALLPAPER_INPUT_MODE_KEY = "pi-wallpaper-input";
export const WALLPAPER_MESSAGE_MODE_KEY = "pi-wallpaper-message";
export const WALLPAPER_PANEL_MODE_KEY = "pi-wallpaper-panel";
export const WALLPAPER_CHANGED_EVENT = "pi-wallpaper-changed";

/** Clamp an arbitrary value to the scrim range (accepts "70%" too). */
export function clampScrim(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(n)) return WALLPAPER_SCRIM_DEFAULT;
  return Math.max(WALLPAPER_SCRIM_MIN, Math.min(WALLPAPER_SCRIM_MAX, Math.round(n)));
}

export function parseAreaMode(value: unknown): WallpaperAreaMode {
  return value === "none" || value === "blur" || value === "trans" ? value : "trans";
}

export function isAcceptedImageType(mime: string): boolean {
  return (WALLPAPER_MIME_TYPES as readonly string[]).includes(mime);
}

/** Read the persisted wallpaper data URL. Server-safe (returns ""). */
export function readStoredWallpaperUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(WALLPAPER_URL_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Downscale + re-encode a picked file into a data URL that fits the storage
 * budget.
 *
 * Strategy: draw the image at (at most) `WALLPAPER_MAX_DIMENSION` on the longest
 * edge, then try JPEG quality steps downward. Wallpapers are photographic and
 * sit behind a scrim, so JPEG artefacts are invisible while PNG would blow the
 * quota immediately.
 *
 * Throws with a human-readable message when the type is rejected or the result
 * cannot be made to fit.
 */
export async function fileToWallpaperDataUrl(file: File): Promise<string> {
  if (!isAcceptedImageType(file.type)) {
    throw new Error("unsupported-type");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, WALLPAPER_MAX_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("encode-failed");
    context.drawImage(image, 0, 0, width, height);

    for (const quality of [0.82, 0.7, 0.58, 0.45]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= WALLPAPER_STORAGE_BUDGET) return dataUrl;
    }
    throw new Error("too-large");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("decode-failed"));
    image.src = src;
  });
}
