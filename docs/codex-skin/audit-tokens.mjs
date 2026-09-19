#!/usr/bin/env node
/**
 * Codex 皮肤 token 审计
 *
 * 合并上游后必跑。用途：确认本地自造的 CSS 变量（--primary-bg / --radius-*
 * 等，上游没有这些）在 globals.css + settings.css 里仍有定义，避免主题块被
 * 覆写后整块丢失；fork-ui.css 同样要算进来——它才是 UI-01 之后新 token 的家，
 * 不算的话任何新自造 token 都会被误报成「未定义」。
 * 上游覆盖后大面积样式塌掉。
 *
 * 用法：node docs/codex-skin/audit-tokens.mjs
 * 退出码：0 = 通过，1 = 有未定义 token
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SCAN_DIRS = ["app", "components", "lib", "hooks"];
const EXT = new Set([".ts", ".tsx", ".css", ".mjs"]);
const CSS_FILES = ["app/globals.css", "app/settings.css", "app/wallpaper.css", "app/fork-ui.css"];

// 由 JS 在运行时写进 inline style / next-font 的变量，不是缺失。
const RUNTIME_SET = new Set([
  "--app-viewport-height",
  "--font-mono",
  "--font-noto-mono",
  "--catppuccin-icon-light",
  "--catppuccin-icon-dark",
  "--sidebar-width",
  "--right-panel-width",
  "--config-panel-width",
  "--config-panel-height",
  // Written by AppShell onto .main-panels so the workspace header can inset its
  // absolutely-positioned controls by exactly one top-bar button (PR #838).
  "--main-workspace-header-leading-inset",
  "--main-workspace-header-trailing-inset",
  // Written by hooks/useChatAppearance.ts (extension widget text size).
  "--extension-widget-font-size",
  // Written by hooks/useBorderDepth.ts: the slider blends from these snapshots
  // so repeated drags cannot compound the blend.
  "--border-orig",
  "--border-strong-orig",
  "--border-faint-orig",
  // Written by hooks/useUiScale.ts (whole-app text/UI scale).
  "--app-ui-scale",
  // Written by hooks/useWallpaper.ts (scrim opacity percentage).
  "--wallpaper-scrim",
]);

// 每套主题都必须完整重定义的色板。少一个就会从 :root 泄漏成另一套主题的值。
const REQUIRED_PER_THEME = [
  "--bg", "--bg-panel", "--bg-elev", "--bg-hover", "--bg-selected", "--bg-subtle",
  "--border", "--border-strong", "--border-faint",
  "--text", "--text-muted", "--text-dim",
  "--accent", "--accent-hover", "--accent-contrast", "--accent-soft", "--accent-border",
  "--primary-bg", "--primary-fg", "--primary-hover",
  "--user-bg", "--assistant-bg", "--tool-bg", "--code-bg",
  "--danger", "--danger-soft", "--success", "--success-soft",
  "--warning", "--warning-soft", "--diff-added", "--diff-removed",
  "--focus-ring", "--scrim",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.has(extname(p))) out.push(p);
  }
  return out;
}

const used = new Map();
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(file);
    }
  }
}

const css = CSS_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
const defined = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));

// 括号配平。手工解冲突（或脚本拼接主题块）时最容易多留一个 `}`，
// 而这种错误 tsc 与 token 审计都看不出来，只会在 dev server 里炸成 500。
let depth = 0;
let braceError = null;
for (const f of CSS_FILES) {
  depth = 0;
  const lines = readFileSync(f, "utf8").split("\n");
  for (const [i, line] of lines.entries()) {
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth < 0) {
          braceError = `${f}:${i + 1}: 多余的 }`;
          break;
        }
      }
    }
    if (braceError) break;
  }
  if (braceError) break;
  if (depth !== 0) {
    braceError = `${f}: 括号未配平（结尾深度 ${depth}）`;
    break;
  }
}

const missing = [...used].filter(([t]) => !defined.has(t) && !RUNTIME_SET.has(t));

// 逐主题块统计色板完整度。选择器可能跨行（`:root,` / `html.dark,`），
// 所以按「以 { 结尾的选择器行」开启一个块。只有声明了 color-scheme 的块才是
// 调色板块；纯几何 `:root` 块（圆角/布局/动效）不参与色板校验。
const blocks = new Map();
let current = null;
for (const line of css.split("\n")) {
  const trimmed = line.trim();
  if (/^(:root|html\.dark|html\[data-theme|\[data-theme)[^{]*\{\s*$/.test(trimmed)) {
    current = trimmed.replace(/\s*\{\s*$/, "");
    if (!blocks.has(current)) blocks.set(current, { tokens: new Set(), palette: false });
    continue;
  }
  if (current) {
    const m = /^\s*(--[a-zA-Z0-9-]+)\s*:/.exec(line);
    if (m) blocks.get(current).tokens.add(m[1]);
    else if (/^\s*color-scheme\s*:/.test(line)) blocks.get(current).palette = true;
    else if (trimmed === "}") current = null;
  }
}

const palettes = [...blocks]
  .filter(([, b]) => b.palette)
  .map(([selector, b]) => [selector, b.tokens]);

let failed = false;

if (braceError) {
  failed = true;
  console.log(`!! CSS 语法: ${braceError}`);
  console.log("   （手工解冲突后多留一个 } 是最常见的成因；dev server 会 500）");
  console.log();
}

console.log(`被引用的 token: ${used.size}  |  CSS 中定义: ${defined.size}`);
console.log();

if (missing.length) {
  failed = true;
  console.log("!! 未定义的 token（自造 token 可能被上游覆盖掉了）:");
  for (const [token, files] of missing) {
    console.log(`   ${token}  <- ${[...files].join(", ")}`);
  }
} else {
  console.log("OK  所有被引用的 token 都有定义");
}

console.log();
console.log("各主题调色板完整度:");
for (const [selector, toks] of palettes) {
  const miss = REQUIRED_PER_THEME.filter((t) => !toks.has(t));
  if (miss.length) {
    failed = true;
    console.log(`  !! ${selector}  缺: ${miss.join(", ")}`);
  } else {
    console.log(`  OK ${selector}`);
  }
}

// 皮肤新增的语义刻度（排版 / 控件尺寸 / 层级 / 终端）。上游合并时整块
// 丢掉的就是这些，所以它们和自造色板 token 一样需要守住。规范见
// docs/codex-skin/visual-spec.md。
const REQUIRED_SCALE = [
  "--text-2xs", "--text-xs", "--text-sm", "--text-md",
  "--text-lg", "--text-xl", "--text-2xl", "--text-3xl",
  "--control-xs", "--control-sm", "--control-md", "--control-lg",
  "--control-xl", "--control-touch",
  "--z-popover", "--z-drawer", "--z-modal", "--z-toast",
  "--terminal-surface", "--terminal-chrome", "--terminal-border",
  "--terminal-hover", "--terminal-text", "--terminal-text-dim",
  "--elevation-stroke", "--shadow-sm", "--shadow-md", "--shadow-lg", "--shadow-xl",
];
const missingScale = REQUIRED_SCALE.filter((t) => !defined.has(t));
console.log();
if (missingScale.length) {
  failed = true;
  console.log(`!! 皮肤刻度 token 缺失: ${missingScale.join(", ")}`);
} else {
  console.log(`OK  皮肤刻度 token 齐全（${REQUIRED_SCALE.length} 个）`);
}

process.exit(failed ? 1 : 0);
