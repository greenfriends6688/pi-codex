"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useWallpaper } from "@/hooks/useWallpaper";
import { ConfigButton } from "./SettingsUi";
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
export function WallpaperSettings({
  skinActive = false,
  onEditSkin,
}: {
  /**
   * fork:zn-19-merge — 有自定义皮肤生效时，壁纸与各面透明度由**皮肤**决定
   * （`html[data-theme-skin="true"]` 那一组 CSS 会接管，全局的 per-area 模式被显式排除）。
   * 这时再摆一排滑块就是「看着能调、其实无效」的死控件，所以改成说明 + 去编辑皮肤。
   */
  skinActive?: boolean;
  onEditSkin?: () => void;
} = {}) {
  const { t } = useI18n();
  const {
    enabled,
    url,
    scrim,
    inputMode,
    panelMode,
    messageMode,
    usingBuiltin,
    choose,
    remove,
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

  if (skinActive) {
    return (
      <div className="settings-wallpaper">
        <p className="settings-pi-theme-description">{t("settings.wallpaperSkinOwned")}</p>
        {onEditSkin && (
          <div className="settings-wallpaper-actions">
            <ConfigButton variant="secondary" onClick={onEditSkin}>
              {t("settings.wallpaperSkinOwnedEdit")}
            </ConfigButton>
          </div>
        )}
      </div>
    );
  }

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

      {/* fork:zn-19-builtin-skins — 内置画作不再是这里的一份预设，而是卡片条里的内置皮肤
          （点一下就带壁纸生效、还能直接编辑）。这里只留「自己的图片」这条路径，避免
          「皮肤 / 壁纸」又变成两处可配同一件事。 */}

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
