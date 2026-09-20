#!/usr/bin/env node
/**
 * Codex 皮肤主题渲染核对
 *
 * 改过 `app/globals.css` 的主题层之后必跑。静态检查（tsc / lint /
 * audit-tokens.mjs）**发现不了重复主题块**——同名选择器出现两次时，后一份
 * 会静默胜出。只有让浏览器真正解析 CSS 并读回 computed value 才能暴露。
 *
 * 颜色比较走**渲染后的 RGB**，不是字面串：构建链会把 `oklch()` 重写成 `lab()`
 * （实测 `--accent-soft` 读回来是 `lab(59.8% -5.25 -53.8 / .12)`），所以按字面比
 * 较会在正确值上误报。把两侧都丢给浏览器解析成 rgb 再比，才是「上色对不对」这篇
 * 测试真正要问的问题，也不依赖任何色彩空间写法。
 *
 * 前置：dev server 已在 127.0.0.1:30141 运行（`npm run dev`）。
 *
 * 用法：node docs/codex-skin/verify-themes.mjs
 * 退出码：0 = 5 套调色板全部符合预期，1 = 有偏差
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:30141/";

// 本皮肤的期望值。改调色板时同步更新这里。
// 比较走浏览器解析后的 RGB（见文件头），所以 hex / oklch 两种写法都可以写。
//
// fork:boardui（PR-02）—— 颜色槽位已交给 BoardUI 的语义 token（见
// app/globals.css 末尾的 `fork:boardui-bridge`）：六套 palette 的 --bg/--text/
// --accent/--primary-bg 都引用 --color-*，所以只剩 BoardUI 的亮/暗两组值。
// 改这些值时三处要一起改：这里、app/globals.css 的桥接层、visual-spec.md。
const BOARDUI_ACCENT = "oklch(0.623 0.214 259.815)"; // accent-500（默认蓝，边框/选中底）
const BOARDUI_PRIMARY = "oklch(0.546 0.245 262.881)"; // accent-600（实心底，白字 4.9:1）
const BOARDUI_LIGHT = { dark: false, bg: "#ffffff", text: "oklch(0.145 0 0)", accent: BOARDUI_ACCENT, primaryBg: BOARDUI_PRIMARY };
const BOARDUI_DARK = { dark: true, bg: "#121212", text: "oklch(0.985 0 0)", accent: BOARDUI_ACCENT, primaryBg: BOARDUI_PRIMARY };
const EXPECTED = {
  light: { ...BOARDUI_LIGHT },
  dark: { ...BOARDUI_DARK },
};

// 先做一次零成本的重复选择器检查，给出比浏览器报错更直接的提示。
// 注意选择器可能写成两行（`html[data-theme="pine"],` + `[data-theme="pine"] {`），
// 所以要数「带 { 的那一行」，而不是数选择器名出现几次。
const css = readFileSync("app/globals.css", "utf8");

// 颜色归一：把每个值真的画到 canvas 上，再读回中心像素。
//
// 为什么不能直接读 computed `color`：CSS Color 4 会**保留色彩空间**，
// `color: lab(...)` 原样回读 `lab(...)`、`oklch(...)` 原样回读 `oklch(...)`。
// 而构建链会把源码里的 `oklch()` 重写成 `lab()`，于是「期望值 oklch / 实际值
// lab」永远不相等——按字面或按空间比较都会在正确值上误报。像素是唯一不依赖
// 色彩空间写法的口径：两种写法算完必须落到同一个 sRGB 像素（容差 ±2，覆盖两条
// 转换路径的末位舍入）。
const PIXEL_OF_COLOR = (values) => {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return values.map((v) => {
    ctx.clearRect(0, 0, 8, 8);
    ctx.fillStyle = "#000";
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 8, 8);
    const [r, g, b, a] = ctx.getImageData(4, 4, 1, 1).data;
    return [r, g, b, a];
  });
};

const samePixel = (a, b) => a.every((value, index) => Math.abs(value - b[index]) <= 2);

let duplicated = false;
for (const theme of Object.keys(EXPECTED)) {
  const re = new RegExp(`data-theme="${theme}"\\]\\s*\\{`, "g");
  const hits = (css.match(re) ?? []).length;
  if (hits !== 1) {
    duplicated = true;
    console.log(`!! [data-theme="${theme}"] 块在 globals.css 中出现 ${hits} 次（应为 1 次）`);
  }
}
if (duplicated) {
  console.log("   重复的主题块会让后一份静默覆盖重打结果。先清理再跑渲染核对。\n");
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: "networkidle", timeout: 90_000 });

let failed = duplicated;

for (const [theme, want] of Object.entries(EXPECTED)) {
  await page.evaluate((t) => localStorage.setItem("pi-theme", t), theme);
  await page.reload({ waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(700);

  const got = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {
      dataTheme: document.documentElement.dataset.theme,
      dark: document.documentElement.classList.contains("dark"),
      bg: v("--bg"),
      text: v("--text"),
      accent: v("--accent"),
      primaryBg: v("--primary-bg"),
      /* fork:zn-11 —Zeno 的三档圆角参与核对：行 6 / 控件 10 / 面板 12，
         输入框跟面板同档。旧版这里核的是 Codex 的 calc 尺度（`*` 号），
         尺度已换成字面值，所以改成核对三个实际生效的半径。 */
      radiusMd: v("--radius-md"),
      radiusLg: v("--radius-lg"),
      radius2xl: v("--radius-2xl"),
      radiusComposer: v("--radius-composer"),
    };
  });

  // 颜色一律归一成**实际像素**再比（见文件头）。
  const [gotBg, gotText, gotAccent, gotPrimary, wantBg, wantText, wantAccent, wantPrimary] =
    await page.evaluate(PIXEL_OF_COLOR, [
      got.bg, got.text, got.accent, got.primaryBg,
      want.bg, want.text, want.accent, want.primaryBg,
    ]);
  const gotColors = { bg: gotBg, text: gotText, accent: gotAccent, primaryBg: gotPrimary };
  const wantColors = { bg: wantBg, text: wantText, accent: wantAccent, primaryBg: wantPrimary };

  const diffs = [];
  if (got.dataTheme !== theme) diffs.push(`data-theme=${got.dataTheme}（应为 ${theme}）`);
  if (got.dark !== want.dark) diffs.push(`dark 类=${got.dark}（应为 ${want.dark}）`);
  for (const key of ["bg", "text", "accent", "primaryBg"]) {
    if (!samePixel(gotColors[key], wantColors[key])) {
      diffs.push(`${key}=rgba(${gotColors[key]})（应为 rgba(${wantColors[key]})，源码 ${want[key]}）`);
    }
  }
  // 圆角：--radius-composer 现在指向 --radius-2xl（fork:boardui 的 24px 大圆角
  // 卡），浏览器把 var() 原样回读，所以要跟着链展开再比。
  const resolvedComposer =
    got.radiusComposer === "var(--radius-lg)" ? got.radiusLg
    : got.radiusComposer === "var(--radius-2xl)" ? got.radius2xl
    : got.radiusComposer;
  if (got.radiusMd !== "10px") diffs.push(`--radius-md=${got.radiusMd}（应为 10px）`);
  if (got.radiusLg !== "12px") diffs.push(`--radius-lg=${got.radiusLg}（应为 12px）`);
  if (got.radius2xl !== "24px") diffs.push(`--radius-2xl=${got.radius2xl}（应为 24px）`);
  if (resolvedComposer !== "24px") diffs.push(`--radius-composer=${resolvedComposer}（应为 24px）`);

  if (diffs.length) {
    failed = true;
    console.log(`FAIL ${theme.padEnd(6)} ${diffs.join(" | ")}`);
  } else {
    console.log(`OK   ${theme.padEnd(6)} bg=rgb(${gotColors.bg.slice(0, 3)}) accent=rgb(${gotColors.accent.slice(0, 3)}) radius=${got.radiusMd}/${got.radiusLg}/${resolvedComposer}`);
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
