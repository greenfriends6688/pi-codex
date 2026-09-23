/**
 * fork:zn-19 — 主题皮肤（Zeno `ThemeSkinStudio` + `theme-packs.ts`）。
 *
 * 一套皮肤 = 4 个基色 + 11 个几何/材质旋钮 + 一张壁纸 + 一段自定义 CSS。
 * 全部真的落到 CSS 变量上（见 `applyThemeSkin`），不是只有 UI 没有效果。
 *
 * ## 派生色为什么不存
 *
 * 皮肤只存 `background / panel / accent / text` 四个基色，其余槽位（hover、
 * 选中、边框、次要文字）在 `applyThemeSkin` 里用 `color-mix` **现场派生**。
 * 存下来会有两个后果：一是改基色后派生色不会跟着变（要重算并回写），二是皮肤
 * 文件里出现十几个用户从没见过的色值，导出给别人时没法解释。Zeno 的
 * `theme-packs.ts` 也是这个路子（`--skin-*-rgb` + 运行时 mix）。
 *
 * ## 与既有环境的关系
 *
 * - **壁纸**不另开一套：写回本仓已有的 `pi-wallpaper` / `pi-wallpaper-scrim`
 *   那几个 key 并派发 `pi-wallpaper-changed`，`WallpaperLayer` 会自己接上。
 *   一份壁纸只有一个真相，两套壁纸系统会互相覆盖。
 * - **圆角**改 `--radius-base`（`app/globals.css` 里全部圆角都由它派生）。
 * - **默认皮肤**是一套「全空」的值：选中它时把上面所有覆盖**移除**，回到主题原样。
 *   这也是「恢复默认」按钮的语义。
 *
 * 纯数据模块：服务端可 import，不碰 DOM。
 */

export const THEME_SKINS_STORAGE_KEY = "pi-theme-skins";
export const SKIN_CUSTOM_CSS_ELEMENT_ID = "fork-skin-custom-css";

export const SKIN_MODE_VALUES = ["light", "dark"] as const;
export type SkinMode = (typeof SKIN_MODE_VALUES)[number];

export const SKIN_WALLPAPER_FIT_VALUES = ["cover", "contain", "tile"] as const;
export type SkinWallpaperFit = (typeof SKIN_WALLPAPER_FIT_VALUES)[number];

/**
 * fork:zn-19-variant — 一套模式（浅色 / 深色）下的颜色覆盖。
 *
 * 空字符串 = 继承：先看该模式的变体，再回落到下面那四个**共享**基色，最后才是主题自己的 token。
 * 这是 Zeno 的模型（`ThemeSkinConfig` 的 `light` / `dark` 字段）：皮肤可以只写一套色
 * 到处通用，也可以给明暗各配一套。
 */
export interface SkinColorVariant {
  background: string;
  panel: string;
  accent: string;
  text: string;
}

export const SKIN_COLOR_KEYS = ["background", "panel", "accent", "text"] as const;
export type SkinColorKey = (typeof SKIN_COLOR_KEYS)[number];

export function emptySkinVariant(): SkinColorVariant {
  return { background: "", panel: "", accent: "", text: "" };
}

export interface ThemeSkin {
  id: string;
  name: string;
  /** 这套皮肤的**取向**：编辑器默认打开哪套变体（运行时按应用当前明暗取变体）。 */
  mode: SkinMode;
  /** 四个基色（两套变体的共享默认值）。 */
  background: string;
  panel: string;
  accent: string;
  text: string;
  /** 浅色 / 深色下的覆盖；空字段回落共享值。 */
  light: SkinColorVariant;
  dark: SkinColorVariant;
  /** 壁纸焦点（百分比）——决定 `object-position`。 */
  focusX: number;
  focusY: number;
  /** 壁纸缩放（百分比，100 = 不缩放）。 */
  wallpaperScale: number;
  /** 壁纸压暗（百分比）——scrim 的不透明度。 */
  wallpaperDim: number;
  /** 会话阅读遮罩（百分比）——消息列底下再垫一层，保证长文可读。 */
  readingMask: number;
  /** 侧栏 / 页面 / 卡片 的底色不透明度（百分比，越大越实）。 */
  sidebarOpacity: number;
  pageOpacity: number;
  cardOpacity: number;
  /** 玻璃模糊（px）。 */
  blur: number;
  /** 组件圆角（px）——写 `--radius-base`。 */
  radius: number;
  /** 边框强度（百分比）：0 = 看不见，100 = 直接用正文色混。 */
  borderAlpha: number;
  /** 壁纸（data URL）。null = 用本仓内置画作。 */
  wallpaper: string | null;
  wallpaperFit: SkinWallpaperFit;
  customCss: string;
}

export const THEME_SKIN_DEFAULT_ID = "default";

/**
 * fork:zn-19-variant — 两套模式的**兜底调色板**（镜像 `app/globals.css` 的 `--bg` /
 * `--bg-panel` / `--accent` / `--text`）。
 *
 * 皮肤预览画的是一个「迷你外壳」，它必须能在**不是当前应用主题**的那套模式下渲染
 * （否则点「深色」就预览不出深色）。主题 token 跟随应用明暗，用不了，所以这里放一份
 * 具体值。Zeno 同样有 `paletteForMode()`。
 */
export const SKIN_MODE_PALETTE: Record<SkinMode, SkinColorVariant> = {
  light: { background: "#ffffff", panel: "#f1f2f4", accent: "#2b7fff", text: "#171717" },
  dark: { background: "#191919", panel: "#2d2d2d", accent: "#2b7fff", text: "#f7f8fa" },
};

/** 旋钮的取值范围，滑块与解析共用一份。 */
export const SKIN_RANGES = {
  focusX: { min: 0, max: 100, step: 1 },
  focusY: { min: 0, max: 100, step: 1 },
  wallpaperScale: { min: 100, max: 200, step: 1 },
  wallpaperDim: { min: 0, max: 100, step: 1 },
  readingMask: { min: 0, max: 100, step: 1 },
  sidebarOpacity: { min: 0, max: 100, step: 1 },
  pageOpacity: { min: 0, max: 100, step: 1 },
  cardOpacity: { min: 0, max: 100, step: 1 },
  blur: { min: 0, max: 40, step: 1 },
  radius: { min: 0, max: 24, step: 1 },
  borderAlpha: { min: 0, max: 100, step: 1 },
} as const satisfies Record<string, { min: number; max: number; step: number }>;

/** 内置的「默认」皮肤：全空 = 选中它即移除所有覆盖。 */
export const DEFAULT_THEME_SKIN: ThemeSkin = {
  id: THEME_SKIN_DEFAULT_ID,
  name: "",
  mode: "dark",
  background: "",
  panel: "",
  accent: "",
  text: "",
  light: emptySkinVariant(),
  dark: emptySkinVariant(),
  focusX: 50,
  focusY: 50,
  wallpaperScale: 100,
  // 30% 而不是 Zeno 的 10%：Zeno 底下是 Electron 原生磨砂，Web 这边只有
  // backdrop-filter，同样 10% 时侧栏文字会糊在壁纸上。这是「默认值要开箱可读」。
  wallpaperDim: 30,
  readingMask: 78,
  sidebarOpacity: 64,
  pageOpacity: 35,
  cardOpacity: 74,
  blur: 0,
  radius: 10,
  borderAlpha: 30,
  wallpaper: null,
  wallpaperFit: "cover",
  customCss: "",
};

/**
 * fork:zn-19-variant — 某个模式下**实际生效**的四个基色。
 *
 * 优先级：该模式的变体 → 共享基色 → 空串（运行时表示「不动主题 token」，
 * 预览表示「用该模式的调色板兜底」）。Zeno 的 `resolveThemeColors` 是同一套顺序。
 */
export function resolveSkinColors(skin: ThemeSkin, mode: SkinMode): SkinColorVariant {
  const variant = skin[mode] ?? emptySkinVariant();
  return {
    background: variant.background || skin.background,
    panel: variant.panel || skin.panel,
    accent: variant.accent || skin.accent,
    text: variant.text || skin.text,
  };
}

/**
 * fork:zn-19-variant — 应用当前实际渲染的模式（`<html data-theme>`）。
 *
 * 新建皮肤时要把「当前外观」写进**这个模式的变体**，而不是写进共享色：写共享色的话
 * 明暗两套长得一模一样，编辑器里那个「浅色 / 深色」开关点了就没有任何变化。
 */
export function currentSkinMode(): SkinMode {
  if (typeof document === "undefined") return DEFAULT_THEME_SKIN.mode;
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * 新建皮肤的起点：**照抄当前生效的基色**，而不是写死一套色。
 * 写死的话「新建主题」永远从一个跟当前界面无关的配色开始，用户第一步就得先改回来。
 */
export function createSkinDraft(id: string, name: string, mode: SkinMode, base: Partial<ThemeSkin> = {}): ThemeSkin {
  return {
    ...DEFAULT_THEME_SKIN,
    ...base,
    id,
    name,
    mode,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** 解析一套模式变体：坏字段回落空串（= 继承共享值），坏整体当成空变体。 */
function parseSkinVariant(input: unknown): SkinColorVariant {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return emptySkinVariant();
  const raw = input as Record<string, unknown>;
  return {
    background: readString(raw.background, ""),
    panel: readString(raw.panel, ""),
    accent: readString(raw.accent, ""),
    text: readString(raw.text, ""),
  };
}

/**
 * 解析一套皮肤。**坏字段回落默认值、坏整体返回 null**（由调用方决定是丢还是留）。
 * 皮肤会被导入/导出，所以解析必须对任意 JSON 都不抛。
 */
export function parseThemeSkin(input: unknown): ThemeSkin | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const id = readString(raw.id, "").trim();
  if (!id) return null;
  const mode: SkinMode = SKIN_MODE_VALUES.includes(raw.mode as SkinMode)
    ? (raw.mode as SkinMode)
    : DEFAULT_THEME_SKIN.mode;
  const wallpaperFit: SkinWallpaperFit = SKIN_WALLPAPER_FIT_VALUES.includes(raw.wallpaperFit as SkinWallpaperFit)
    ? (raw.wallpaperFit as SkinWallpaperFit)
    : DEFAULT_THEME_SKIN.wallpaperFit;

  const skin: ThemeSkin = {
    id,
    name: readString(raw.name, id).slice(0, 60),
    mode,
    background: readString(raw.background, ""),
    panel: readString(raw.panel, ""),
    accent: readString(raw.accent, ""),
    text: readString(raw.text, ""),
    light: parseSkinVariant(raw.light),
    dark: parseSkinVariant(raw.dark),
    focusX: clampNumber(raw.focusX, SKIN_RANGES.focusX.min, SKIN_RANGES.focusX.max, DEFAULT_THEME_SKIN.focusX),
    focusY: clampNumber(raw.focusY, SKIN_RANGES.focusY.min, SKIN_RANGES.focusY.max, DEFAULT_THEME_SKIN.focusY),
    wallpaperScale: clampNumber(raw.wallpaperScale, SKIN_RANGES.wallpaperScale.min, SKIN_RANGES.wallpaperScale.max, DEFAULT_THEME_SKIN.wallpaperScale),
    wallpaperDim: clampNumber(raw.wallpaperDim, SKIN_RANGES.wallpaperDim.min, SKIN_RANGES.wallpaperDim.max, DEFAULT_THEME_SKIN.wallpaperDim),
    readingMask: clampNumber(raw.readingMask, SKIN_RANGES.readingMask.min, SKIN_RANGES.readingMask.max, DEFAULT_THEME_SKIN.readingMask),
    sidebarOpacity: clampNumber(raw.sidebarOpacity, SKIN_RANGES.sidebarOpacity.min, SKIN_RANGES.sidebarOpacity.max, DEFAULT_THEME_SKIN.sidebarOpacity),
    pageOpacity: clampNumber(raw.pageOpacity, SKIN_RANGES.pageOpacity.min, SKIN_RANGES.pageOpacity.max, DEFAULT_THEME_SKIN.pageOpacity),
    cardOpacity: clampNumber(raw.cardOpacity, SKIN_RANGES.cardOpacity.min, SKIN_RANGES.cardOpacity.max, DEFAULT_THEME_SKIN.cardOpacity),
    blur: clampNumber(raw.blur, SKIN_RANGES.blur.min, SKIN_RANGES.blur.max, DEFAULT_THEME_SKIN.blur),
    radius: clampNumber(raw.radius, SKIN_RANGES.radius.min, SKIN_RANGES.radius.max, DEFAULT_THEME_SKIN.radius),
    borderAlpha: clampNumber(raw.borderAlpha, SKIN_RANGES.borderAlpha.min, SKIN_RANGES.borderAlpha.max, DEFAULT_THEME_SKIN.borderAlpha),
    wallpaper: typeof raw.wallpaper === "string" && raw.wallpaper.startsWith("data:") ? raw.wallpaper : null,
    wallpaperFit,
    // 自定义 CSS 有大小上限：一份皮肤不该能塞进一整张图。
    customCss: readString(raw.customCss, "").slice(0, 20000),
  };
  return skin;
}

export interface ThemeSkinsState {
  skins: ThemeSkin[];
  activeId: string;
}

export const THEME_SKINS_DEFAULT_STATE: ThemeSkinsState = {
  skins: [],
  activeId: THEME_SKIN_DEFAULT_ID,
};

export function parseThemeSkinsState(raw: string | null): ThemeSkinsState {
  if (!raw) return THEME_SKINS_DEFAULT_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return THEME_SKINS_DEFAULT_STATE;
    }
    const record = parsed as Record<string, unknown>;
    const skins = Array.isArray(record.skins)
      ? record.skins.map(parseThemeSkin).filter((skin): skin is ThemeSkin => skin !== null)
      : [];
    const activeId = typeof record.activeId === "string" ? record.activeId : THEME_SKIN_DEFAULT_ID;
    return { skins, activeId };
  } catch {
    return THEME_SKINS_DEFAULT_STATE;
  }
}

/** `null` = 默认皮肤（没有覆盖）。 */
export function findActiveSkin(state: ThemeSkinsState): ThemeSkin | null {
  if (state.activeId === THEME_SKIN_DEFAULT_ID) return null;
  return state.skins.find((skin) => skin.id === state.activeId) ?? null;
}

/** 导出：一份皮肤一个 JSON 文件；`version` 留着以后加迁移。 */
export function serializeSkinForExport(skin: ThemeSkin): string {
  return JSON.stringify({ version: 1, skin }, null, 2);
}

export function parseSkinImport(raw: string): ThemeSkin | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    // 接受两种：裸皮肤，或 `{ version, skin }` 包装（导出的形态）。
    return parseThemeSkin("skin" in record ? record.skin : record);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * 把任意 CSS 颜色解析成 `#rrggbb`。
 *
 * `<input type="color">` 只认 `#rrggbb`，而当前生效的色值可能是 `oklch(...)`、
 * `color-mix(...)`、甚至带 alpha 的 `color(srgb … / .6)` —— 我们既不能正则解析
 * （构建链会把 oklch 重写成 lab），也不能让色板留空。
 *
 * 做法与 `docs/codex-skin/check-contrast.mjs` 一致：画到 canvas 再读像素。
 * 这是唯一不依赖颜色写法的口径。带 alpha 的值先手动合成到给定底色上 —— canvas 读
 * 出来的是**预乘过**的像素，直接用会把半透明色取成偏黑的值。
 * ------------------------------------------------------------------------- */
export function resolveCssColorToHex(value: string, backdrop = "#000000"): string {
  if (typeof document === "undefined") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";
    // 先铺底，再把目标色叠上去：这样 alpha 由浏览器合成，而不是我们猜。
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillStyle = trimmed;
    ctx.fillRect(0, 0, 4, 4);
    const [r, g, b] = ctx.getImageData(2, 2, 1, 1).data;
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return "";
  }
}

/** 新建皮肤的起点：**取当前实际渲染的四个基色**，不是写死一套。 */
export function readCurrentSkinBase(): Pick<ThemeSkin, "background" | "panel" | "accent" | "text"> {
  if (typeof document === "undefined") {
    return { background: "", panel: "", accent: "", text: "" };
  }
  const styles = getComputedStyle(document.documentElement);
  // 面板色取 `--bg-elev`：它是卡片/浮层的实底，比 `--bg-panel`（侧栏，常带透明度）更适合当基色。
  const background = resolveCssColorToHex(styles.getPropertyValue("--bg"));
  return {
    background,
    panel: resolveCssColorToHex(styles.getPropertyValue("--bg-elev"), background || "#000000"),
    accent: resolveCssColorToHex(styles.getPropertyValue("--accent"), background || "#000000"),
    text: resolveCssColorToHex(styles.getPropertyValue("--text"), background || "#000000"),
  };
}
