#!/usr/bin/env node
/**
 * Codex 皮肤主题渲染核对
 *
 * 改过 `app/globals.css` 的主题层之后必跑。静态检查（tsc / lint /
 * audit-tokens.mjs）**发现不了重复主题块**——同名选择器出现两次时，后一份
 * 会静默胜出。只有让浏览器真正解析 CSS 并读回 computed value 才能暴露。
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
const EXPECTED = {
  light: { dark: false, bg: "#ffffff", text: "#1a1c1f", accent: "#339cff", primaryBg: "#1a1c1f" },
  dark: { dark: true, bg: "#181818", text: "#ffffff", accent: "#99ceff", primaryBg: "#ffffff" },
  mist: { dark: false, bg: "#fbfdfc", text: "#16241f", accent: "#1e6559", primaryBg: "#16241f" },
  rose: { dark: false, bg: "#fdfbfb", text: "#2a1f24", accent: "#914360", primaryBg: "#2a1f24" },
  pine: { dark: true, bg: "#181c1a", text: "#f2f7f4", accent: "#acccb7", primaryBg: "#f2f7f4" },
};

// 先做一次零成本的重复选择器检查，给出比浏览器报错更直接的提示。
// 注意选择器可能写成两行（`html[data-theme="pine"],` + `[data-theme="pine"] {`），
// 所以要数「带 { 的那一行」，而不是数选择器名出现几次。
const css = readFileSync("app/globals.css", "utf8");
const hex = (v) => {
  const s = String(v).trim().toLowerCase();
  const m = /^#([0-9a-f]{3})$/.exec(s);
  return m ? `#${m[1].split("").map((c) => c + c).join("")}` : s;
};

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
      radiusMd: v("--radius-md"),
    };
  });

  const diffs = [];
  if (got.dataTheme !== theme) diffs.push(`data-theme=${got.dataTheme}（应为 ${theme}）`);
  if (got.dark !== want.dark) diffs.push(`dark 类=${got.dark}（应为 ${want.dark}）`);
  for (const key of ["bg", "text", "accent", "primaryBg"]) {
    if (hex(got[key]) !== hex(want[key])) {
      diffs.push(`${key}=${got[key]}（应为 ${want[key]}）`);
    }
  }
  if (!got.radiusMd.includes("*")) diffs.push(`--radius-md 未走 calc 尺度：${got.radiusMd}`);

  if (diffs.length) {
    failed = true;
    console.log(`FAIL ${theme.padEnd(6)} ${diffs.join(" | ")}`);
  } else {
    console.log(`OK   ${theme.padEnd(6)} bg=${got.bg.padEnd(9)} accent=${got.accent.padEnd(9)} radius-md=${got.radiusMd}`);
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
