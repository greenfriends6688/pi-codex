/**
 * fork:zn-15 — 侧边栏半透明偏好（Zeno 设置里的「侧边栏半透明」）。
 *
 * Zeno 的开关接的是 Electron 的原生磨砂（`zenso-sidebar-translucent` →
 * `vibrancy`），Web 形态没有那一层，所以这里对应到 **backdrop-filter**：
 * 侧栏底色降到 72% 透明度再模糊背后内容。背后正好是本仓已有的
 * `WallpaperLayer`，所以打开开关确实能看到壁纸透出来，不是一个空效果。
 *
 * 纯数据 + 解析放在这里，DOM 副作用与持久化在 `hooks/useRailTranslucent.ts`，
 * 与 `useUiDensity` / `useBorderDepth` 同形。
 */

export const RAIL_TRANSLUCENT_STORAGE_KEY = "pi-rail-translucent";
export const RAIL_TRANSLUCENT_DEFAULT = false;

export function parseStoredRailTranslucent(raw: string | null): boolean {
  return raw === "1" || raw === "true";
}
