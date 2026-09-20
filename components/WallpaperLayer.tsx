"use client";

import { useEffect, useState } from "react";
import { WALLPAPER_CHANGED_EVENT, readStoredBuiltinWallpaper, readStoredWallpaperUrl } from "@/lib/wallpaper";
import { activeThemePalette, resolveWallpaperSrc } from "@/lib/wallpaper-builtin";

/**
 * The wallpaper `<img>` plus its scrim.
 *
 * Rendered as the **first child of the workspace row** so every later sibling
 * paints above it, and as a sibling of the chat column so the scrim rules in
 * `app/wallpaper.css` can reach it.
 *
 * With no user image the active palette picks a built-in painting. A
 * `MutationObserver` watches `data-theme` on `<html>`, so the painting follows
 * a theme change instead of staying on the previous theme's image — which reads
 * as a rendering bug rather than a setting.
 *
 * The URL is only read inside an effect: reading storage during render would make
 * the server and the first client render disagree (hydration mismatch).
 *
 * This component also owns the **fade-in gate**: the `<img>` sets
 * `data-wallpaper-ready` once decoded, so the wallpaper appears without the
 * settings panel ever having been opened.
 */
export function WallpaperLayer() {
  const [url, setUrl] = useState("");
  const [builtin, setBuiltin] = useState("");
  const [palette, setPalette] = useState("");
  /** fork:ui-perf — gate for the <img>: no wallpaper, no request. */
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const syncUrl = () => setUrl(readStoredWallpaperUrl());
    const syncBuiltin = () => setBuiltin(readStoredBuiltinWallpaper());
    const syncPalette = () => setPalette(activeThemePalette());
    const syncEnabled = () => setEnabled(document.documentElement.getAttribute("data-wallpaper") === "on");
    syncUrl();
    syncBuiltin();
    syncPalette();
    syncEnabled();

    window.addEventListener(WALLPAPER_CHANGED_EVENT, syncUrl);
    window.addEventListener(WALLPAPER_CHANGED_EVENT, syncBuiltin);
    const observer = new MutationObserver(() => {
      syncPalette();
      syncEnabled();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-wallpaper"],
    });
    return () => {
      window.removeEventListener(WALLPAPER_CHANGED_EVENT, syncUrl);
      window.removeEventListener(WALLPAPER_CHANGED_EVENT, syncBuiltin);
      observer.disconnect();
    };
  }, []);

  // fork:ui-perf — the built-in painting is ~860KB. It used to be resolved (and
  // therefore downloaded) even with the wallpaper switched off, so every first
  // paint paid for an image nobody saw. No src, no request.
  const src = enabled ? resolveWallpaperSrc(url, palette, builtin) : null;

  return (
    <div className="chat-wallpaper" aria-hidden="true">
      {/* next/image is not usable here: the source is either a local data URL
          that must not be routed through the image optimizer, or a static asset
          with no query-string variants. */}
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element -- data URL / static asset, not optimizer-routable */
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={() => { document.documentElement.dataset.wallpaperReady = "1"; }}
          onError={() => { document.documentElement.dataset.wallpaperReady = "1"; }}
        />
      ) : null}
    </div>
  );
}
