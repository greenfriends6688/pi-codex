"use client";

/**
 * fork:zn-19 — 编辑主题（Zeno `ThemeSkinStudio.tsx`）。
 *
 * 两块：`主题设置` 与 `自定义 CSS`。左边的预览列是**一个真的迷你外壳**（侧栏 +
 * 会话列 + 作曲器），不是色卡 —— 圆角、玻璃模糊、透明度、边框强度这四个旋钮
 * 只有画出一整套 chrome 才看得出来。右边是名称 + 4 个基色 + 11 个滑块。
 *
 * 11 个滑块**全部真的落到 CSS 变量上**（`lib/theme-skins.ts` 的 `writeSkin`），
 * 没有只做 UI 的：焦点/缩放/压暗走壁纸层，阅读遮罩垫在消息列下，三个透明度决定
 * 侧栏/页面/卡片各让多少底透出来，模糊走 `backdrop-filter`，圆角写 `--radius-base`
 * （`app/globals.css` 里所有圆角都由它派生），边框强度参与 `--border` 的混色比例。
 *
 * 保存是**整套替换**而不是逐项 patch：皮肤是一个 18 个字段的整体，逐项合并会让
 * 「取消」和「恢复默认」都要各自维护一份逆操作。
 */

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import {
  SKIN_RANGES,
  resolveCssColorToHex,
  SKIN_WALLPAPER_FIT_VALUES,
  createSkinDraft,
  type SkinMode,
  type SkinWallpaperFit,
  type ThemeSkin,
} from "@/lib/theme-skins";
import { ConfigButton, SettingsSlider } from "./SettingsUi";

const SLIDER_ORDER: Array<{ key: keyof typeof SKIN_RANGES; labelKey: string; unit: string }> = [
  { key: "focusX", labelKey: "settings.skinFocusX", unit: "%" },
  { key: "focusY", labelKey: "settings.skinFocusY", unit: "%" },
  { key: "wallpaperScale", labelKey: "settings.skinWallpaperScale", unit: "%" },
  { key: "wallpaperDim", labelKey: "settings.skinWallpaperDim", unit: "%" },
  { key: "readingMask", labelKey: "settings.skinReadingMask", unit: "%" },
  { key: "sidebarOpacity", labelKey: "settings.skinSidebarOpacity", unit: "%" },
  { key: "pageOpacity", labelKey: "settings.skinPageOpacity", unit: "%" },
  { key: "cardOpacity", labelKey: "settings.skinCardOpacity", unit: "%" },
  { key: "blur", labelKey: "settings.skinBlur", unit: "px" },
  { key: "radius", labelKey: "settings.skinRadius", unit: "px" },
  { key: "borderAlpha", labelKey: "settings.skinBorderAlpha", unit: "%" },
];

const COLOR_FIELDS: Array<{ key: keyof ThemeSkin; labelKey: string }> = [
  { key: "background", labelKey: "settings.skinBackground" },
  { key: "panel", labelKey: "settings.skinPanel" },
  { key: "accent", labelKey: "settings.skinAccent" },
  { key: "text", labelKey: "settings.skinText" },
];

/** `<input type="color">` 只认 `#rrggbb`；基色可能是 oklch 或 color-mix，统一转一道。 */
function toColorInputValue(value: string, fallback: string): string {
  return resolveCssColorToHex(value, fallback) || fallback;
}

export function ThemeSkinStudio({
  skin,
  isNew,
  onCancel,
  onSave,
  onDelete,
}: {
  skin: ThemeSkin;
  isNew: boolean;
  onCancel: () => void;
  onSave: (skin: ThemeSkin) => void;
  onDelete?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ThemeSkin>(skin);
  const [tab, setTab] = useState<"settings" | "css">("settings");
  const [previewMode, setPreviewMode] = useState<SkinMode>(skin.mode);
  const [message, setMessage] = useState("");
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose: onCancel });

  useEffect(() => { setDraft(skin); }, [skin]);
  useEffect(() => { setPreviewMode(skin.mode); }, [skin.mode]);

  const patch = (next: Partial<ThemeSkin>) => setDraft((current) => ({ ...current, ...next }));

  const pickWallpaper = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      // 上限 3MB：皮肤会被导出/导入成 JSON，data URL 会把文件撑大 1/3。
      if (file.size > 3_000_000) {
        setMessage(t("settings.skinWallpaperTooLarge"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          patch({ wallpaper: reader.result });
          setMessage("");
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  /* 预览用同一套派生公式，但**只作用在预览盒子里**：把 `draft` 的派生值算成
     inline style，而不是写 `<html>` 变量 —— 否则「编辑中」的皮肤会当场改掉整个应用，
     用户按「取消」时来不及回滚。 */
  const previewStyle = useMemo(() => {
    const { background, panel, accent, text } = draft;
    const bg = background || "var(--bg)";
    const pn = panel || "var(--bg-elev)";
    const ac = accent || "var(--accent)";
    const tx = text || "var(--text)";
    return {
      background: bg,
      color: tx,
      "--preview-panel": `color-mix(in srgb, ${pn} ${draft.cardOpacity}%, transparent)`,
      "--preview-sidebar": `color-mix(in srgb, ${pn} ${draft.sidebarOpacity}%, transparent)`,
      "--preview-page": `color-mix(in srgb, ${bg} ${draft.pageOpacity}%, transparent)`,
      "--preview-border": `color-mix(in srgb, ${tx} ${draft.borderAlpha}%, transparent)`,
      "--preview-radius": `${draft.radius}px`,
      "--preview-blur": `${draft.blur}px`,
      "--preview-accent": ac,
      "--preview-text-muted": `color-mix(in srgb, ${tx} 62%, ${bg})`,
    } as React.CSSProperties;
  }, [draft]);

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      className="fork-skin-dialog-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div className="fork-skin-dialog" role="dialog" aria-modal="true" aria-label={t("settings.skinEditTitle")}>
        <header className="fork-skin-dialog-header">
          <strong>{isNew ? t("settings.skinNewTitle") : t("settings.skinEditTitle")}</strong>
          <button type="button" className="fork-skin-dialog-close" aria-label={t("i18n.close")} onClick={onCancel}>×</button>
        </header>

        <div role="tablist" className="fork-skin-dialog-tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "settings"}
            className="fork-skin-dialog-tab"
            data-active={tab === "settings" ? "true" : undefined}
            onClick={() => setTab("settings")}
          >
            {t("settings.skinTabSettings")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "css"}
            className="fork-skin-dialog-tab"
            data-active={tab === "css" ? "true" : undefined}
            onClick={() => setTab("css")}
          >
            {t("settings.skinTabCss")}
          </button>
        </div>

        {tab === "settings" ? (
          <div className="fork-skin-dialog-body">
            <div className="fork-skin-dialog-preview-column">
              <div className="fork-skin-preview-head">
                <span>{t("settings.skinPreview")}</span>
                <div role="radiogroup" aria-label={t("settings.skinPreview")} className="fork-skin-preview-mode">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={previewMode === "light"}
                    data-active={previewMode === "light" ? "true" : undefined}
                    onClick={() => { setPreviewMode("light"); patch({ mode: "light" }); }}
                  >
                    {t("settings.skinModeLight")}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={previewMode === "dark"}
                    data-active={previewMode === "dark" ? "true" : undefined}
                    onClick={() => { setPreviewMode("dark"); patch({ mode: "dark" }); }}
                  >
                    {t("settings.skinModeDark")}
                  </button>
                </div>
              </div>

              {/* 迷你外壳：侧栏 + 会话列 + 作曲器。圆角/玻璃/透明度/边框只在这三块上
                  同时出现时才看得出来。 */}
              <div className="fork-skin-preview" style={previewStyle} data-mode={previewMode}>
                {draft.wallpaper ? (
                  <div
                    className="fork-skin-preview-wallpaper"
                    style={{
                      backgroundImage: `url(${draft.wallpaper})`,
                      backgroundPosition: `${draft.focusX}% ${draft.focusY}%`,
                      backgroundSize: `${draft.wallpaperScale}%`,
                    }}
                  />
                ) : null}
                <div
                  className="fork-skin-preview-mask"
                  style={{
                    background: `color-mix(in srgb, ${previewStyle.background as string} ${draft.wallpaperDim}%, transparent)`,
                  }}
                />
                <div className="fork-skin-preview-shell">
                  <div className="fork-skin-preview-sidebar">
                    <span className="fork-skin-preview-brand" />
                    <span className="fork-skin-preview-nav" data-active="true" />
                    <span className="fork-skin-preview-nav" />
                    <span className="fork-skin-preview-nav" />
                  </div>
                  <div className="fork-skin-preview-main">
                    <div className="fork-skin-preview-thread">
                      <span className="fork-skin-preview-line" style={{ width: "82%" }} />
                      <span className="fork-skin-preview-line" style={{ width: "64%" }} />
                      <span className="fork-skin-preview-line" style={{ width: "74%" }} />
                    </div>
                    <div className="fork-skin-preview-composer" />
                  </div>
                </div>
              </div>

              <div className="fork-skin-dialog-asset-actions">
                <ConfigButton variant="secondary" size="small" onClick={pickWallpaper}>
                  {t("settings.skinChooseWallpaper")}
                </ConfigButton>
                <ConfigButton
                  variant="ghost"
                  size="small"
                  disabled={!draft.wallpaper}
                  onClick={() => patch({ wallpaper: null })}
                >
                  {t("settings.skinRemoveWallpaper")}
                </ConfigButton>
                <label className="fork-skin-fit">
                  <span className="sr-only">{t("settings.skinWallpaperFit")}</span>
                  <select
                    className="fork-settings-select"
                    value={draft.wallpaperFit}
                    aria-label={t("settings.skinWallpaperFit")}
                    onChange={(event) => patch({ wallpaperFit: event.target.value as SkinWallpaperFit })}
                  >
                    {SKIN_WALLPAPER_FIT_VALUES.map((fit) => (
                      <option key={fit} value={fit}>{t(`settings.skinFit_${fit}`)}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="fork-skin-dialog-controls">
              <label className="fork-skin-field">
                <span>{t("settings.skinName")}</span>
                <input
                  type="text"
                  className="fork-skin-text-input"
                  maxLength={60}
                  value={draft.name}
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </label>

              <div className="fork-skin-color-grid">
                {COLOR_FIELDS.map((field) => (
                  <label key={String(field.key)} className="fork-skin-color-field">
                    <span>{t(field.labelKey)}</span>
                    <input
                      type="color"
                      value={toColorInputValue(
                        String(draft[field.key] ?? ""),
                        previewMode === "light" ? "#ffffff" : "#191919",
                      )}
                      onChange={(event) => patch({ [field.key]: event.target.value } as Partial<ThemeSkin>)}
                    />
                  </label>
                ))}
              </div>

              <div className="fork-skin-slider-grid">
                {SLIDER_ORDER.map((entry) => {
                  const range = SKIN_RANGES[entry.key];
                  const value = draft[entry.key] as number;
                  return (
                    <SettingsSlider
                      key={entry.key}
                      label={t(entry.labelKey)}
                      value={value}
                      displayValue={`${value}${entry.unit}`}
                      min={range.min}
                      max={range.max}
                      step={range.step}
                      onChange={(next) => patch({ [entry.key]: next } as Partial<ThemeSkin>)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="fork-skin-dialog-css">
            <p className="fork-skin-dialog-css-hint">{t("settings.skinCustomCssHint")}</p>
            <textarea
              className="fork-skin-css-input"
              spellCheck={false}
              value={draft.customCss}
              onChange={(event) => patch({ customCss: event.target.value })}
              placeholder={".sidebar-container { letter-spacing: 0.01em; }"}
            />
          </div>
        )}

        {message ? <p className="fork-skin-dialog-message" role="status">{message}</p> : null}

        <footer className="fork-skin-dialog-footer">
          <div className="fork-skin-dialog-footer-left">
            {onDelete && !isNew ? (
              <ConfigButton
                variant="ghost"
                size="small"
                onClick={() => onDelete(draft.id)}
              >
                {t("i18n.delete")}
              </ConfigButton>
            ) : null}
          </div>
          <div className="fork-skin-dialog-footer-right">
            <ConfigButton variant="ghost" size="small" onClick={onCancel}>
              {t("i18n.cancel")}
            </ConfigButton>
            <ConfigButton
              variant="secondary"
              size="small"
              onClick={() => setDraft(createSkinDraft(draft.id, draft.name, draft.mode))}
            >
              {t("settings.skinReset")}
            </ConfigButton>
            <ConfigButton variant="primary" size="small" onClick={() => onSave(draft)}>
              {t("i18n.save")}
            </ConfigButton>
          </div>
        </footer>
      </div>
    </div>
  );
}
