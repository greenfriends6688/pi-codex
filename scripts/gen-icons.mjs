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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "build");
mkdirSync(outDir, { recursive: true });

// ── 应用图标 master：pi 品牌图标，macOS 圆角矩形规格 ───────────────────────
// 底色/字形用 pi 自己的图标素材（public/icons/icon-512.png）：#23454B + 白色 π。
//
// 规格来自实测本机参考 App（WorkBuddy / Calculator / ChatGPT）的 .icns：
//   画布 1024，圆角矩形 820x820 居中（四边留 102 白边），圆角半径 ≈185，
//   四角 alpha = 0（透明）。注意 macOS **不会**自动裁圆角：参考 App 的图标
//   都是自己画好的圆角矩形，所以这里必须自带圆角与留白。
//   角形拟合表明它们用的是普通圆弧圆角（平均偏差 4~9px），不是超椭圆。
//
// 原素材是「透明底 + 圆形气泡」，气泡是纯色 #23454B（实测无渐变），所以把素材
// 放大后铺进圆角矩形内部、与底色同色即可无缝衔接；左下角的气泡小尾巴也一并
// 融入。素材必须 clip 进圆角矩形，否则它自己的圆形边缘会溢出到留白区。
const TILE_BG = "#23454B";
const CANVAS = 1024;
const TILE = 820;              // 实测 0.801 * 1024
const TILE_INSET = (CANVAS - TILE) / 2;   // 102
const TILE_RADIUS = 185;       // Apple 规格 r/TILE ≈ 0.225（实测 WorkBuddy .221 / Calculator .231）
const SRC = 512;               // 素材画布边长
// 素材里字形包围盒 x:126..385  y:148..375
const GLYPH_W = 385 - 126 + 1;            // 260
const GLYPH_FRAC = GLYPH_W / SRC;         // 字形占素材画布的比例 ≈ 0.508
const GLYPH_CX = (126 + 385 + 1) / 2;     // 把字形包围盒中心对准圆角矩形中心
const GLYPH_CY = (148 + 375 + 1) / 2;

const piArtworkBase64 = readFileSync(
  join(process.cwd(), "public", "icons", "icon-512.png"),
).toString("base64");

// glyphRatio = π 宽度 / 圆角矩形宽度。
// 大尺寸用 0.62；≤32px 单独放大到 0.78 做光学补偿——16px 时矩形只有 13px，
// 按 0.62 算 π 只有 8px，缩略图上会糊成一团。
function masterSvg(glyphRatio) {
  const artSize = Math.round((glyphRatio * TILE) / GLYPH_FRAC);
  const s = artSize / SRC;
  const artX = Math.round(CANVAS / 2 - GLYPH_CX * s);
  const artY = Math.round(CANVAS / 2 - GLYPH_CY * s);
  return `<svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="tile">
      <rect x="${TILE_INSET}" y="${TILE_INSET}" width="${TILE}" height="${TILE}" rx="${TILE_RADIUS}" ry="${TILE_RADIUS}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect x="${TILE_INSET}" y="${TILE_INSET}" width="${TILE}" height="${TILE}" fill="${TILE_BG}"/>
    <image href="data:image/png;base64,${piArtworkBase64}" x="${artX}" y="${artY}" width="${artSize}" height="${artSize}" preserveAspectRatio="xMidYMid meet" image-rendering="optimizeQuality"/>
  </g>
</svg>`;
}
const MASTER_SVG = masterSvg(0.62);
const SMALL_SVG = masterSvg(0.78);
const SMALL_MAX_DIM = 32;      // ≤ 此边长的图标用小尺寸母版

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
// 小尺寸母版（π 放大到 0.78 做光学补偿），只用于 ≤32px 的条目
const smallMasterPng = join(outDir, "icon-small.png");
writeFileSync(smallMasterPng, renderPng(SMALL_SVG, 1024));

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
  // ≤32px 走小尺寸母版（字形更大，缩略图上更清楚）
  const src = dim <= SMALL_MAX_DIM ? smallMasterPng : masterPng;
  sips(src, dim, dim, join(iconset, name));
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