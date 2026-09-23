"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  SKIN_CUSTOM_CSS_ELEMENT_ID,
  THEME_SKINS_DEFAULT_STATE,
  THEME_SKINS_STORAGE_KEY,
  THEME_SKIN_DEFAULT_ID,
  parseThemeSkinsState,
  resolveSkinColors,
  type SkinMode,
  type ThemeSkin,
  type ThemeSkinsState,
} from "@/lib/theme-skins";
import { applyWallpaperState, readWallpaperState } from "@/hooks/useWallpaper";
import { allSkinCandidates, findActiveSkinIncludingBuiltins } from "@/lib/builtin-skins";

/**
 * fork:zn-19 — 主题皮肤的状态 + 落地（DOM 副作用 + 持久化）。
 *
 * 与 `useUiDensity` 同形：模块级 store + `useSyncExternalStore` + localStorage。
 * 额外两件事：
 *
 *   1. **注入自定义 CSS**：往 `<head>` 放一个带固定 id 的 `<style>`。放在 head
 *      而不是 `<html style>`，因为用户写的是规则（选择器 + 声明），不是单个属性的值。
 *      每次 apply 都整段替换，不做 diff —— 一段 CSS 文本做增量合并只会更难懂。
 *   2. **把壁纸写回本仓已有的那把 key**：皮肤的壁纸就是应用壁纸，`WallpaperLayer`
 *      监听 `pi-wallpaper-changed` 会自己刷新。选中「默认」皮肤时**不改动**那把 key
 *      ——默认皮肤的定义是「不覆盖」，顺手清掉用户的壁纸是越权。
 */

const listeners = new Set<() => void>();
let state: ThemeSkinsState | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStored(): ThemeSkinsState {
  if (typeof window === "undefined") return THEME_SKINS_DEFAULT_STATE;
  try {
    return parseThemeSkinsState(window.localStorage.getItem(THEME_SKINS_STORAGE_KEY));
  } catch {
    return THEME_SKINS_DEFAULT_STATE;
  }
}

function ensureState(): ThemeSkinsState {
  if (state === null) state = readStored();
  return state;
}

/** 所有由皮肤覆盖的变量，集中在这里，方便「移除覆盖」时一次清干净。 */
const SKIN_VARIABLES = [
  "--bg",
  "--bg-panel",
  "--bg-elev",
  "--bg-hover",
  "--bg-selected",
  "--bg-subtle",
  "--bg-composer",
  "--text",
  "--text-muted",
  "--text-dim",
  "--border",
  "--border-strong",
  "--border-faint",
  "--accent",
  "--accent-hover",
  "--accent-text",
  "--radius-base",
  "--skin-blur",
  "--skin-reading-mask",
  "--skin-panel-base",
  "--skin-bg-base",
  "--skin-page-alpha",
  "--skin-panel-alpha",
  "--skin-sidebar-alpha",
] as const;

const SKIN_DATA_ATTRIBUTES = [
  "themeSkin",
  "themeSkinMode",
  "themeSkinWallpaperFit",
] as const;

/**
 * fork:zn-19 — 皮肤接管壁纸时的「原样备份」。
 *
 * 本仓的壁纸存储只有一份（`pi-wallpaper`），皮肤要显示自己的图就得覆盖它。
 * 不备份的话，用户切回「默认」皮肤时**自己原来那张图就没了** —— 这不是皮肤
 * 该带走的东西。所以第一次接管前把原值存一份，回到默认时还原。
 */
const SKIN_WALLPAPER_BACKUP_KEY = "pi-theme-skin-wallpaper-backup";

function restoreUserWallpaper(): void {
  if (typeof window === "undefined") return;
  try {
    const backup = window.localStorage.getItem(SKIN_WALLPAPER_BACKUP_KEY);
    if (backup === null) return;
    window.localStorage.removeItem(SKIN_WALLPAPER_BACKUP_KEY);
    applyWallpaperState({
      url: backup,
      // 空字符串 = 用户原本就没有自定义图，这时保持「是否启用」不动。
      ...(backup ? { enabled: true } : {}),
    });
  } catch {
    // 存储不可用：皮肤退出时不还原，至少不报错
  }
}

function clearSkin(): void {
  const root = document.documentElement;
  for (const name of SKIN_VARIABLES) root.style.removeProperty(name);
  for (const name of SKIN_DATA_ATTRIBUTES) root.removeAttribute(`data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  document.getElementById(SKIN_CUSTOM_CSS_ELEMENT_ID)?.remove();
  restoreUserWallpaper();
}

function writeCustomCss(css: string): void {
  let element = document.getElementById(SKIN_CUSTOM_CSS_ELEMENT_ID) as HTMLStyleElement | null;
  if (!css.trim()) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("style");
    element.id = SKIN_CUSTOM_CSS_ELEMENT_ID;
    document.head.appendChild(element);
  }
  element.textContent = css;
}

/**
 * 把皮肤落到 CSS 变量上。
 *
 * 四个基色直接写；其余槽位**现场派生**（`color-mix`），这样改一个基色整套跟着变，
 * 而皮肤文件里只需要存四个色值。派生公式与本仓 `app/globals.css` 的意图一致：
 * hover 是正文色一档淡、边框是正文色按 `borderAlpha` 混、次要文字是正文色 62%。
 */
function writeSkin(skin: ThemeSkin): void {
  const root = document.documentElement;
  // fork:zn-19-variant — 取哪套变体看**应用当前的明暗**（Zeno 的 auto 语义）：
  // 皮肤没写该模式的覆盖时自动回落到共享基色，所以老皮肤行为不变。
  const activeMode: SkinMode = root.dataset.theme === "dark" ? "dark" : "light";
  const { background, panel, accent, text } = resolveSkinColors(skin, activeMode);

  if (background) root.style.setProperty("--bg", background);
  if (text) root.style.setProperty("--text", text);

  // 面板/浮层/作曲器共用面板色，不透明度由「卡片透明度」决定：卡片越淡，壁纸越透。
  if (panel) {
    const card = `color-mix(in srgb, ${panel} ${skin.cardOpacity}%, transparent)`;
    root.style.setProperty("--bg-elev", card);
    root.style.setProperty("--bg-composer", card);
    root.style.setProperty("--bg-panel", `color-mix(in srgb, ${panel} ${skin.sidebarOpacity}%, transparent)`);
    root.style.setProperty("--bg-subtle", panel);
  }

  if (text) {
    root.style.setProperty("--bg-hover", `color-mix(in srgb, ${text} 10%, transparent)`);
    root.style.setProperty("--bg-selected", `color-mix(in srgb, ${text} 16%, transparent)`);
    root.style.setProperty("--text-muted", `color-mix(in srgb, ${text} 62%, ${background || "transparent"})`);
    root.style.setProperty("--text-dim", `color-mix(in srgb, ${text} 46%, ${background || "transparent"})`);
    const border = `color-mix(in srgb, ${text} ${skin.borderAlpha}%, transparent)`;
    root.style.setProperty("--border", border);
    root.style.setProperty("--border-faint", border);
    root.style.setProperty("--border-strong", `color-mix(in srgb, ${text} ${Math.min(100, skin.borderAlpha * 1.6)}%, transparent)`);
  }

  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-hover", `color-mix(in srgb, ${accent} 82%, ${text || "#000"})`);
    root.style.setProperty("--accent-text", `color-mix(in srgb, ${accent} 82%, ${text || "#000"})`);
  }

  root.style.setProperty("--radius-base", `${skin.radius}px`);
  root.style.setProperty("--skin-blur", `${skin.blur}px`);
  // 阅读遮罩与三个透明度也发成变量：CSS 侧要对「渐变的两端」和「半透明面」分别取值，
  // 光靠改写 --bg / --bg-elev 表达不了（渐变需要知道百分比，不是颜色）。
  /* fork:zn-19 — **不带 alpha 的面板/画布基色**（Zeno 的 `--skin-panel-rgb`）。
     各面必须自己乘**一次**自己的透明度：如果拿已经含卡片透明度的 `--bg-elev` 再乘
     侧栏透明度，两层 alpha 会相乘（70% × 62% = 43%），侧栏就糊在壁纸上了。
     一个面一个 alpha，这是 Zeno 发基色的理由。 */
  if (panel) root.style.setProperty("--skin-panel-base", panel);
  if (background) root.style.setProperty("--skin-bg-base", background);
  root.style.setProperty("--skin-reading-mask", `${skin.readingMask}%`);
  root.style.setProperty("--skin-page-alpha", `${skin.pageOpacity}%`);
  root.style.setProperty("--skin-panel-alpha", `${skin.cardOpacity}%`);
  root.style.setProperty("--skin-sidebar-alpha", `${skin.sidebarOpacity}%`);

  root.dataset.themeSkin = "true";
  // 记录**实际生效**的模式（不是皮肤自称的 mode）：CSS 要按模式分叉时才有意义。
  root.dataset.themeSkinMode = activeMode;
  root.dataset.themeSkinWallpaperFit = skin.wallpaperFit;

  writeCustomCss(skin.customCss);

  /* 壁纸：走 `useWallpaper` 的 store，不直接写 DOM —— 否则用户下次在设置里
     「选壁纸」时，hook 会用一个过期的 state 把皮肤的选择覆盖回去。

     皮肤有自己的图 → 接管（先备份用户原来那张）。皮肤没有图 → **不动** URL 与启用
     状态，只更新「压暗」：没配图的皮肤不该顺手把用户的壁纸关掉。 */
  const previous = readWallpaperState();
  if (skin.wallpaper) {
    try {
      if (window.localStorage.getItem(SKIN_WALLPAPER_BACKUP_KEY) === null) {
        window.localStorage.setItem(SKIN_WALLPAPER_BACKUP_KEY, previous.url);
      }
    } catch {
      // 存储不可用：退化成「不还原」，但本次会话仍然生效
    }
    applyWallpaperState({ url: skin.wallpaper, enabled: true, scrim: skin.wallpaperDim });
  } else {
    applyWallpaperState({ scrim: skin.wallpaperDim });
  }
}

export function applyThemeSkinsState(next: ThemeSkinsState): void {
  if (typeof document === "undefined") return;
  const skin = findActiveSkinIncludingBuiltins(next);
  if (!skin) {
    clearSkin();
    return;
  }
  writeSkin(skin);
}

export function applyStoredThemeSkins(): void {
  applyThemeSkinsState(ensureState());
}

function persist(next: ThemeSkinsState): void {
  state = next;
  try {
    window.localStorage.setItem(THEME_SKINS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用
  }
  applyThemeSkinsState(next);
  emit();
}

export function useThemeSkins() {
  const current = useSyncExternalStore(subscribe, ensureState, () => THEME_SKINS_DEFAULT_STATE);

  const setActive = useCallback((id: string) => {
    persist({ ...ensureState(), activeId: id });
  }, []);

  /** 新建或整体替换一套皮肤（保存时用）。 */
  const upsertSkin = useCallback((skin: ThemeSkin) => {
    const previous = ensureState();
    const index = previous.skins.findIndex((item) => item.id === skin.id);
    const skins = index >= 0
      ? previous.skins.map((item) => (item.id === skin.id ? skin : item))
      : [...previous.skins, skin];
    persist({ skins, activeId: skin.id });
  }, []);

  const removeSkin = useCallback((id: string) => {
    const previous = ensureState();
    const skins = previous.skins.filter((item) => item.id !== id);
    persist({
      skins,
      activeId: previous.activeId === id ? THEME_SKIN_DEFAULT_ID : previous.activeId,
    });
  }, []);

  /** 订阅外部删掉了皮肤（例如另一个标签页）：状态本身在 localStorage 里，重读即可。 */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_SKINS_STORAGE_KEY) return;
      applyThemeSkinsState(readStored());
      emit();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return {
    // 卡片条要看得到内置皮肤（内置壁纸的落点）；同 id 时用户那份覆盖内置。
    skins: allSkinCandidates(current),
    activeId: current.activeId,
    activeSkin: findActiveSkinIncludingBuiltins(current),
    setActive,
    upsertSkin,
    removeSkin,
  };
}

export { THEME_SKIN_DEFAULT_ID };
