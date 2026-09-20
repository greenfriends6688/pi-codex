#!/usr/bin/env node
/**
 * 对比度门禁（DSN-02）
 *
 * 检查每个主题下「前景 token 画在背景 token 上」的 WCAG 2.1 对比度。
 * 静态检查发现不了这类问题：色值改了、桥接层换了来源，只有让浏览器解析
 * 并算一遍才知道某些辅助文字是不是已经糊在背景里。
 *
 * fork:boardui（PR-02）之后颜色槽位由 BoardUI 的语义 token 供给，六套 palette
 * 收敛为亮/暗两组，所以这里逐主题跑、但允许亮色组和暗色组各有一份期望。
 *
 * 前置：服务已在 127.0.0.1:30141 运行（`npm run prod`）。
 * 用法：node docs/codex-skin/check-contrast.mjs
 * 退出码：0 = 全部达标；1 = 有低于阈值的组合
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:30141/";
const THEMES = ["light", "dark", "mist", "rose", "pine"];

/**
 * 前景/背景组合与最低对比度。
 *
 * 4.5 = WCAG AA 正文；3.0 = AA 大字 / 非文本辅助信息（时间戳、计数这类
 * 可以扫一眼即可的元信息）。`--text-dim` 按 3.0 要求，但在报告里单独标出
 * 实际值 —— BoardUI 的 text-tertiary 在亮色下本来就很淡。
 */
const CHECKS = [
  { fg: "--text", bg: "--bg", min: 4.5, label: "正文 / 画布" },
  { fg: "--text", bg: "--bg-panel", min: 4.5, label: "正文 / 侧栏" },
  { fg: "--text-muted", bg: "--bg", min: 4.5, label: "次要文字 / 画布" },
  { fg: "--text-muted", bg: "--bg-panel", min: 4.5, label: "次要文字 / 侧栏" },
  { fg: "--text-dim", bg: "--bg", min: 3.0, label: "辅助文字 / 画布" },
  { fg: "--text-dim", bg: "--bg-panel", min: 3.0, label: "辅助文字 / 侧栏" },
  { fg: "--primary-fg", bg: "--primary-bg", min: 4.5, label: "主按钮文字 / 主按钮底" },
  { fg: "--accent-text", bg: "--bg", min: 4.5, label: "accent 文字 / 画布" },
  { fg: "--accent-text", bg: "--bg-panel", min: 4.5, label: "accent 文字 / 侧栏" },
];

const luminance = ([r, g, b]) => {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrastOf = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let failures = 0;

for (const theme of THEMES) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.evaluate((t) => localStorage.setItem("pi-theme", t), theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);

  const values = await page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // 把任意色彩空间（oklch/lab/hex）画到画布再读像素：这是唯一不依赖写法
    // 的口径，构建链会把 oklch() 重写成 lab()。
    const px = (value) => {
      ctx.clearRect(0, 0, 8, 8);
      ctx.fillStyle = "#000";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 8, 8);
      const [r, g, b, a] = ctx.getImageData(4, 4, 1, 1).data;
      return [r, g, b, a / 255];
    };
    return Object.fromEntries(names.map((n) => [n, { raw: cs.getPropertyValue(n).trim(), rgba: px(cs.getPropertyValue(n).trim()) }]));
  }, [...new Set(CHECKS.flatMap((c) => [c.fg, c.bg]))]);

  const lines = [];
  for (const check of CHECKS) {
    const fg = values[check.fg].rgba;
    const bg = values[check.bg].rgba;
    if (fg[3] < 1 || bg[3] < 1) {
      lines.push(`SKIP ${check.label}（含 alpha，需先合成背景）`);
      continue;
    }
    const ratio = contrastOf(fg, bg);
    const ok = ratio >= check.min;
    if (!ok) failures += 1;
    lines.push(`${ok ? "OK  " : "FAIL"} ${ratio.toFixed(2)}:1 (≥${check.min}) ${check.label}`);
  }
  console.log(`\n[${theme}] bg=${values["--bg"].raw} text=${values["--text"].raw}`);
  for (const line of lines) console.log(`  ${line}`);
}

await browser.close();

console.log(failures === 0 ? "\n全部达标" : `\n${failures} 项低于阈值`);
process.exit(failures === 0 ? 0 : 1);
