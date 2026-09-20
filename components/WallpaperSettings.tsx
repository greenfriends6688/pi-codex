"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useWallpaper } from "@/hooks/useWallpaper";
import { ConfigButton } from "./SettingsUi";
import {
  BUILTIN_WALLPAPERS,
  activeThemePalette,
  builtinPaintingFor,
  paintingPath,
} from "@/lib/wallpaper-builtin";
import {
  WALLPAPER_SCRIM_MAX,
  WALLPAPER_SCRIM_MIN,
  WALLPAPER_MIME_TYPES,
  type WallpaperAreaMode,
} from "@/lib/wallpaper";

/**
 * Wallpaper settings.
 *
 * The image is stored as a data URL in localStorage, so the picker reports the
 * two failures that actually happen: an unsupported type (SVG is rejected on
 * purpose — it is a script surface, not an image) and an image too large to fit
 * the storage budget after re-encoding.
 *
 * Per-area modes exist because a wallpaper that reaches *everything* makes
 * dense surfaces (the composer, the code blocks) unreadable. Each area therefore
 * opts into `none` (solid), `trans` (translucent) or `blur` (frosted).
 */
export function WallpaperSettings() {
  const { t } = useI18n();
  const {
    enabled,
    url,
    builtin,
    scrim,
    inputMode,
    panelMode,
    messageMode,
    usingBuiltin,
    choose,
    remove,
    useBuiltin,
    setBuiltin,
    setEnabled,
    setScrim,
    setInputMode,
    setPanelMode,
    setMessageMode,
  } = useWallpaper();

  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPick = () => {
    setError(null);
    fileRef.current?.click();
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await choose(file);
      setError(null);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(t(
        code === "unsupported-type" ? "settings.wallpaperBadType"
          : code === "too-large" ? "settings.wallpaperTooLarge"
            : "settings.wallpaperFailed",
      ));
    } finally {
      setBusy(false);
    }
  };

  const areaRow = (
    labelKey: string,
    value: WallpaperAreaMode,
    onChange: (mode: WallpaperAreaMode) => void,
  ) => (
    <div className="settings-wallpaper-area">
      <span className="settings-wallpaper-area-label">{t(labelKey)}</span>
      <select
        className="settings-select"
        value={value}
        aria-label={t(labelKey)}
        onChange={(event) => onChange(event.target.value as WallpaperAreaMode)}
      >
        <option value="none">{t("settings.wallpaperModeNone")}</option>
        <option value="trans">{t("settings.wallpaperModeTrans")}</option>
        <option value="blur">{t("settings.wallpaperModeBlur")}</option>
      </select>
    </div>
  );

  return (
    <div className="settings-wallpaper">
      <p className="settings-pi-theme-description">{t("settings.wallpaperDescription")}</p>

      <input
        ref={fileRef}
        type="file"
        accept={WALLPAPER_MIME_TYPES.join(",")}
        className="sr-only"
        aria-label={t("settings.wallpaperChoose")}
        onChange={(event) => void onFile(event)}
      />

      <div className="settings-wallpaper-actions">
        <ConfigButton variant="secondary" disabled={busy} onClick={onPick}>
          {busy ? t("settings.wallpaperBusy") : (url ? t("settings.wallpaperReplace") : t("settings.wallpaperChoose"))}
        </ConfigButton>
        {url && (
          <ConfigButton variant="ghost" onClick={useBuiltin} title={t("settings.wallpaperUseBuiltin")}>
            {t("settings.wallpaperUseBuiltin")}
          </ConfigButton>
        )}
        {url && (
          <ConfigButton variant="ghost" onClick={remove}>
            {t("settings.wallpaperRemove")}
          </ConfigButton>
        )}
        <div className="settings-wallpaper-toggle">
          <span>{t("settings.wallpaperEnabled")}</span>
          <input
            type="checkbox"
            checked={enabled}
            aria-label={t("settings.wallpaperEnabled")}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </div>
      </div>

      {/* fork:ui-wallpaper — the built-in picker. The active thumbnail is the one
          the layer would actually paint, so it honours the palette fallback when
          the user has never picked (and no thumbnail is active over a custom
          image, which wins over all of them). */}
      <div className="settings-wallpaper-builtins">
        <span className="settings-wallpaper-builtin-label">{t("settings.wallpaperBuiltinPick")}</span>
        <div className="settings-wallpaper-builtin-grid" role="group" aria-label={t("settings.wallpaperBuiltinPick")}>
          {BUILTIN_WALLPAPERS.map((item) => {
            const active = !url && builtinPaintingFor(activeThemePalette(), builtin) === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className="settings-wallpaper-builtin"
                data-active={active ? "true" : undefined}
                aria-pressed={active}
                onClick={() => setBuiltin(item.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static asset, not optimizer-routable */}
                <img src={paintingPath(item.id)} alt="" draggable={false} />
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {enabled && !url && <p className="settings-pi-theme-note">{t("settings.wallpaperBuiltinNote")}</p>}

      {enabled && usingBuiltin && <p className="settings-pi-theme-note">{t("settings.wallpaperBuiltinActive")}</p>}

      {error && <p className="settings-wallpaper-error" role="alert">{error}</p>}

      {/* fork:ui-wallpaper — the scrim slider and the per-area modes drive the
          built-in painting too, so they must not be gated on a user image. */}
      {enabled && (
        <>
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-wallpaper-scrim">{t("settings.wallpaperScrim")}</label>
              <output htmlFor="settings-wallpaper-scrim">{scrim}%</output>
            </div>
            <input
              id="settings-wallpaper-scrim"
              type="range"
              min={WALLPAPER_SCRIM_MIN}
              max={WALLPAPER_SCRIM_MAX}
              step={1}
              value={scrim}
              aria-label={t("settings.wallpaperScrim")}
              aria-valuetext={`${scrim}%`}
              onChange={(event) => setScrim(Number(event.target.value))}
            />
            <div className="settings-chat-range-scale" aria-hidden="true">
              <span>{t("settings.wallpaperScrimMoreImage")}</span>
              <span>{t("settings.wallpaperScrimMoreSurface")}</span>
            </div>
            <p className="settings-chat-range-hint">{t("settings.wallpaperScrimDescription")}</p>
          </div>

          <div className="settings-wallpaper-areas">
            {areaRow("settings.wallpaperAreaMessage", messageMode, setMessageMode)}
            {areaRow("settings.wallpaperAreaPanel", panelMode, setPanelMode)}
            {areaRow("settings.wallpaperAreaInput", inputMode, setInputMode)}
          </div>
        </>
      )}
    </div>
  );
}
