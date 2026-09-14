// gen-icons.mjs — 生成 macOS 应用图标与菜单栏 template 图标
// 用法: node scripts/gen-icons.mjs   (在项目根目录运行)
// 产物:
//   build/icon.icns          应用图标（1024 全出血 master → iconset → icns）
//   build/icon.png          1024 master（调试用）
//   build/trayTemplate.png  菜单栏 template 图标（单色黑 + alpha，22pt）
//   build/trayTemplate@2x.png                              44pt
// macOS 会把图标裁成 squircle，因此 master 必须全出血（不预置圆角/透明角）。
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "build");
mkdirSync(outDir, { recursive: true });

// ── 应用图标 master（1024 全出血：深色渐变底 + 终端提示符 ">_") ─────────────
const MASTER_SVG = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e1b4b"/>
      <stop offset="0.55" stop-color="#4338ca"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <path d="M290 330 L570 512 L290 694" stroke="#ffffff" stroke-width="92" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="630" y="606" width="120" height="96" rx="48" fill="#ffffff"/>
</svg>`;

// ── 菜单栏 template 图标（单色黑 + alpha，系统自动反白）─────────────────────
const TRAY_SVG = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <path d="M${size * 0.16} ${size * 0.26} L${size * 0.5} ${size * 0.5} L${size * 0.16} ${size * 0.74}"
        stroke="#000000" stroke-width="${size * 0.14}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="${size * 0.62}" y="${size * 0.6}" width="${size * 0.26}" height="${size * 0.18}" rx="${size * 0.08}" fill="#000000"/>
</svg>`;

function renderPng(svg, width) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return resvg.render().asPng();
}

function sips(src, width, height, dst) {
  execFileSync("sips", ["-z", String(height), String(width), src, "--out", dst], {
    stdio: "inherit",
  });
}

// 1. 应用图标
const masterPng = join(outDir, "icon.png");
writeFileSync(masterPng, renderPng(MASTER_SVG, 1024));

const iconset = join(outDir, "icon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

const sizes = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];
for (const [dim, name] of sizes) {
  if (dim === 1024) {
    // 1024 直接用 master 的尺寸
    sips(masterPng, 1024, 1024, join(iconset, name));
  } else {
    sips(masterPng, dim, dim, join(iconset, name));
  }
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(outDir, "icon.icns")], {
  stdio: "inherit",
});
rmSync(iconset, { recursive: true, force: true });
console.log("✓ build/icon.icns");

// 2. 菜单栏 template 图标
writeFileSync(join(outDir, "trayTemplate.png"), renderPng(TRAY_SVG(22), 22));
writeFileSync(join(outDir, "trayTemplate@2x.png"), renderPng(TRAY_SVG(44), 44));
console.log("✓ build/trayTemplate.png / trayTemplate@2x.png");