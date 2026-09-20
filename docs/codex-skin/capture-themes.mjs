#!/usr/bin/env node
/**
 * 主题截图（改过调色板 / 浮层 / 排版刻度后跑）
 *
 * 前置：`npm run prod` 已在 127.0.0.1:30141 运行，且 `.next` 是**干净重建**的
 * （`.next` 里残留的 webpack CSS 缓存会让截图停留在旧皮肤上）。
 *
 * 用法：node docs/codex-skin/capture-themes.mjs
 * 产出：仓库根目录 skin-v0.9.1-{light,dark,mist,rose,pine}.png 与
 *       skin-v0.9.1-settings-themes.png
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:30141/";
const THEMES = ["light", "dark"];
const SETTINGS_LABEL = /^(Settings|设置)$/;
const GENERAL_LABEL = /^(General|通用)$/;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: "networkidle", timeout: 90_000 });

for (const theme of THEMES) {
  await page.evaluate((value) => localStorage.setItem("pi-theme", value), theme);
  await page.reload({ waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `skin-v0.9.1-${theme}.png` });
  console.log(`OK   skin-v0.9.1-${theme}.png`);
}

// Settings → General shows the theme picker, which is the one surface where the
// sidebars, tabs, switches and modal shell are all visible at once.
await page.evaluate(() => localStorage.setItem("pi-theme", "light"));
await page.reload({ waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(600);
await page.getByRole("button", { name: SETTINGS_LABEL }).first().click();
await page.waitForTimeout(500);
const general = page.getByRole("button", { name: GENERAL_LABEL }).first();
if (await general.count()) {
  await general.click();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: "skin-v0.9.1-settings-themes.png" });
console.log("OK   skin-v0.9.1-settings-themes.png");

await browser.close();
