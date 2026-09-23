/**
 * fork:zn-19-builtin-skins — 内置壁纸变成**内置皮肤**（Zeno 的 theme packs 形态）。
 *
 * 之前内置画作只能从「壁纸」区块里挑，它是全局壁纸的一份预设；皮肤卡片条里看不到它们，
 * 于是「皮肤」和「壁纸」仍是两套东西（用户在卡片条右侧的空白处看到的就是这个缺口）。
 * Zeno 的做法：内置皮肤本身就带壁纸（`theme-packs.ts` 里 `zhangRuonanUrl` /
 * `mikuStageUrl`），卡片条里直接列出来，点一下就生效，再点「编辑」就能改。
 *
 * 这里的内置皮肤：
 *   - `wallpaper` = 对应的内置画作（静态资源路径，不是 data URL）；
 *   - 四个基色留空 → 继承主题自己的配色（Zeno 的内置包同理，只覆盖它想覆盖的）；
 *   - 其余旋钮用 `DEFAULT_THEME_SKIN` 的默认值（不透明度的默认值本来就是为「壁纸透上来」
 *     调的）。
 *
 * 用户「编辑内置皮肤并保存」时会以同一个 id 写进自己的皮肤列表，**覆盖**这份内置定义；
 * 删除那份覆盖就退回内置原样。
 */

import {
  createSkinDraft,
  type ThemeSkin,
  type ThemeSkinsState,
} from "./theme-skins";
import { BUILTIN_WALLPAPERS, paintingPath, type BuiltinWallpaperId } from "./wallpaper-builtin";

export const BUILTIN_SKIN_ID_PREFIX = "builtin-";

export function builtinSkinId(id: BuiltinWallpaperId): string {
  return `${BUILTIN_SKIN_ID_PREFIX}${id}`;
}

/** 卡片标题从目录取（画作名是专有名词，但仍走 i18n，键锁测试才有一致性可查）。 */
export const BUILTIN_SKIN_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  BUILTIN_WALLPAPERS.map((item) => [builtinSkinId(item.id), item.labelKey]),
);

export const BUILTIN_SKINS: ThemeSkin[] = BUILTIN_WALLPAPERS.map((item) => ({
  ...createSkinDraft(builtinSkinId(item.id), "", "dark", { wallpaper: paintingPath(item.id) }),
}));

export function isBuiltinSkinId(id: string): boolean {
  return id.startsWith(BUILTIN_SKIN_ID_PREFIX);
}

/**
 * 卡片条与解析用的完整列表：内置在前，用户皮肤在后（同 id 时用户那份覆盖内置）。
 */
export function allSkinCandidates(state: ThemeSkinsState): ThemeSkin[] {
  const overridden = new Set(state.skins.map((skin) => skin.id));
  return [
    ...BUILTIN_SKINS.filter((skin) => !overridden.has(skin.id)),
    ...state.skins,
  ];
}

/** 当前生效的皮肤：内置皮肤也算，所以 `activeId` 指向内置 id 时同样能解析出来。 */
export function findActiveSkinIncludingBuiltins(state: ThemeSkinsState): ThemeSkin | null {
  if (state.activeId === "default") return null;
  return allSkinCandidates(state).find((skin) => skin.id === state.activeId) ?? null;
}
