"use client";

/**
 * fork:zn-19 — 主题皮肤卡片条（Zeno 设置 → 外观 →「主题皮肤」）。
 *
 * 一条横向滚动的皮肤列表，每张卡是**一个迷你外壳缩略图**而不是色块：
 * 上半是壁纸/渐变（`art`），右下角压一块半透明面板（`glass`），面板里一条强调色
 * （`accent`）。Zeno 的注释专门写了这件事 ——「Theme Studio intentionally previews
 * a complete mini-shell, not a color swatch」。纯色卡看不出玻璃、圆角、边框强度
 * 这些旋钮的区别，而它们正是皮肤的一半。
 *
 * 左右各一个滚动按钮（`theme-skin-rail` 的三列 grid：按钮 / 轨道 / 按钮），
 * 底部一条 `border-top` 动作栏：新建主题 / 导入 / 编辑 / 导出。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  DEFAULT_THEME_SKIN,
  THEME_SKIN_DEFAULT_ID,
  parseSkinImport,
  serializeSkinForExport,
  type ThemeSkin,
} from "@/lib/theme-skins";
import { ConfigButton } from "./SettingsUi";
import { BUILTIN_SKIN_LABEL_KEYS } from "@/lib/builtin-skins";

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "left" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

/** 卡片的迷你预览。颜色全部内联，因为这是「皮肤的值」而不是「主题的值」。 */
function SkinCardArt({ skin }: { skin: ThemeSkin | null }) {
  // 默认皮肤没有基色：画一块中性的占位，而不是留空。
  const background = skin?.background || "var(--bg)";
  const panel = skin?.panel || "var(--bg-elev)";
  const accent = skin?.accent || "var(--accent)";
  return (
    <span
      className="fork-skin-card-art"
      style={{
        backgroundImage: skin?.wallpaper
          ? `url(${skin.wallpaper})`
          : `linear-gradient(140deg, ${background}, color-mix(in srgb, ${background} 72%, ${panel}))`,
        backgroundPosition: skin ? `${skin.focusX}% ${skin.focusY}%` : "center",
        backgroundSize: skin ? `${skin.wallpaperScale}%` : "cover",
      }}
    >
      <span
        className="fork-skin-card-glass"
        style={{
          background: `color-mix(in srgb, ${panel} ${skin?.cardOpacity ?? 80}%, transparent)`,
          borderRadius: `${Math.min(12, skin?.radius ?? 10)}px`,
          backdropFilter: skin?.blur ? `blur(${Math.min(12, skin.blur)}px)` : undefined,
        }}
      >
        <span className="fork-skin-card-accent" style={{ background: accent }} />
      </span>
    </span>
  );
}

export function ThemeSkinStrip({
  skins,
  activeId,
  onSelect,
  onCreate,
  onEdit,
  onImport,
  onExport,
  busy = false,
}: {
  skins: ThemeSkin[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onImport: (skin: ThemeSkin) => void;
  onExport: (skin: ThemeSkin) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* 滚动按钮的可用态是**量出来的**，不是猜的：卡片宽度随断点变（148/160），
     `scrollWidth > clientWidth` 在只有一张皮肤时为 false，按钮就该灰掉。 */
  const syncScrollState = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    setCanScrollLeft(grid.scrollLeft > 1);
    setCanScrollRight(grid.scrollLeft + grid.clientWidth < grid.scrollWidth - 1);
  }, []);

  useEffect(() => {
    syncScrollState();
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [syncScrollState, skins.length]);

  const scrollBy = (delta: number) => {
    gridRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  const activeSkin = activeId === THEME_SKIN_DEFAULT_ID
    ? null
    : skins.find((skin) => skin.id === activeId) ?? null;

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const skin = parseSkinImport(text);
    if (skin) onImport(skin);
  };

  return (
    <div className="fork-skin-library">
      <div className="fork-skin-rail">
        <button
          type="button"
          className="fork-skin-scroll-button"
          aria-label={t("settings.skinScrollLeft")}
          disabled={!canScrollLeft}
          onClick={() => scrollBy(-320)}
        >
          <ChevronIcon direction="left" />
        </button>

        <div
          ref={gridRef}
          className="fork-skin-grid"
          onScroll={syncScrollState}
          role="radiogroup"
          aria-label={t("settings.skinLibrary")}
        >
          {[null, ...skins].map((skin) => {
            const id = skin?.id ?? THEME_SKIN_DEFAULT_ID;
            // fork:zn-19-builtin-skins — 内置皮肤没写死名字（跨语言会错），标题按 id 取目录。
            const label = skin
              ? (BUILTIN_SKIN_LABEL_KEYS[skin.id] ? t(BUILTIN_SKIN_LABEL_KEYS[skin.id]) : skin.name)
              : t("settings.skinDefault");
            const selected = activeId === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                disabled={busy}
                data-active={selected ? "true" : undefined}
                className="fork-skin-card"
                onClick={() => onSelect(id)}
              >
                <SkinCardArt skin={skin ?? (null as ThemeSkin | null)} />
                <span className="fork-skin-card-name">{label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="fork-skin-scroll-button"
          aria-label={t("settings.skinScrollRight")}
          disabled={!canScrollRight}
          onClick={() => scrollBy(320)}
        >
          <ChevronIcon direction="right" />
        </button>
      </div>

      <div className="fork-skin-library-actions">
        <ConfigButton variant="secondary" size="small" onClick={onCreate}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("settings.skinNew")}
        </ConfigButton>
        <ConfigButton variant="ghost" size="small" onClick={() => fileInputRef.current?.click()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 8 5-5 5 5" />
            <path d="M5 21h14" />
          </svg>
          {t("settings.skinImport")}
        </ConfigButton>
        <ConfigButton
          variant="ghost"
          size="small"
          disabled={activeSkin === null}
          onClick={() => activeSkin && onEdit(activeSkin.id)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          {t("settings.skinEdit")}
        </ConfigButton>
        <ConfigButton
          variant="ghost"
          size="small"
          disabled={activeSkin === null}
          onClick={() => activeSkin && onExport(activeSkin)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V3" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          {t("settings.skinExport")}
        </ConfigButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            void handleImportFile(event.target.files?.[0] ?? null);
            // 清空，否则连续导入同一个文件第二次不触发 change
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

export { DEFAULT_THEME_SKIN, serializeSkinForExport };
