"use client";

/**
 * fork:zn-19-merge — 内置壁纸选择器（壁纸区块与主题皮肤工作室共用）。
 *
 * 之前只有设置里的「壁纸」区块能挑这两张内置画作，进工作室给皮肤配图时挑不到，
 * 用户得退出去、在另一块 UI 里挑、再回来——这正是「三处 UI 各管一段」的由来。
 * 抽成组件后两个入口用同一份列表、同一套选中态。
 */

import { useI18n } from "@/hooks/useI18n";
import { BUILTIN_WALLPAPERS, paintingPath, type BuiltinWallpaperId } from "@/lib/wallpaper-builtin";

export function BuiltinWallpaperPicker({
  activeId,
  onPick,
  labelKey = "settings.wallpaperBuiltinPick",
}: {
  /** 当前生效的内置画作 id；null = 用的是自定义图片或皮肤自己的图。 */
  activeId: BuiltinWallpaperId | null;
  onPick: (id: BuiltinWallpaperId) => void;
  labelKey?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-wallpaper-builtins">
      <span className="settings-wallpaper-builtin-label">{t(labelKey)}</span>
      <div className="settings-wallpaper-builtin-grid" role="group" aria-label={t(labelKey)}>
        {BUILTIN_WALLPAPERS.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className="settings-wallpaper-builtin"
              data-active={active ? "true" : undefined}
              aria-pressed={active}
              onClick={() => onPick(item.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static asset, not optimizer-routable */}
              <img src={paintingPath(item.id)} alt="" draggable={false} />
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 把一张壁纸 URL 反查回内置画作 id（皮肤存的是路径，全局存的是 id）。 */
export function builtinIdForWallpaperUrl(url: string | null | undefined): BuiltinWallpaperId | null {
  if (!url) return null;
  const match = BUILTIN_WALLPAPERS.find((item) => url.endsWith(paintingPath(item.id)));
  return match ? match.id : null;
}
