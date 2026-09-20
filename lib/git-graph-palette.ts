/**
 * fork:git-graph — Git 图谱的主题派生车道色板（纯函数，可在 Node 里单测）。
 *
 * 原型硬编码了 10 种颜色；产品里图谱必须跟随当前 pi CLI 主题。
 * 明暗两套主题已经各自调过 accent（浅色主题的 accent 更深），因此这里
 * **不重新决定亮度**：lane 0（首父主线）直接用 accent 原色，其余车道只
 * 绕色轮旋转 hue、保持 accent 的亮度——仅把饱和度调低，让支线退居主线之后。
 * accent 无法解析或接近灰色（没有可旋转的 hue）时退回明暗各自的固定色板。
 */

export const FALLBACK_PALETTE = [
  "#5871a3", "#4d9d6e", "#b3702d", "#a34d68", "#7a6bc4",
  "#2e8f8f", "#9d4d4d", "#6e7f3d", "#a3794d", "#4d6e9d",
];

// 浅色背景用的更深一档色板。
export const FALLBACK_PALETTE_LIGHT = [
  "#3d5c8f", "#2f7a50", "#8f5a1f", "#8f2f4d", "#5d4fa8",
  "#1f6e6e", "#7a2f2f", "#4f5f22", "#7a5222", "#224f7a",
];

export const LANE_COLOR_COUNT = FALLBACK_PALETTE.length;

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  let value = match[1];
  if (value.length === 3) {
    value = value.split("").map((c) => c + c).join("");
  }
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToCss(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

export function deriveLanePalette(accent: string, isDark: boolean): string[] {
  const hsl = hexToHsl(accent);
  if (!hsl || hsl.s < 0.08) {
    // 无法解析，或接近灰色（没有可旋转的 hue）：退回固定色板。
    return isDark ? FALLBACK_PALETTE : FALLBACK_PALETTE_LIGHT;
  }
  // 沿用主题自己的 accent 调校：亮度原样透传，只对旋转出来的支线压低饱和度。
  const palette: string[] = [hslToCss(hsl.h, hsl.s, hsl.l)];
  // h 归一化在 0..1；其余车道绕它均匀旋转。
  const step = 1 / LANE_COLOR_COUNT;
  const sideS = Math.max(hsl.s * 0.55, 0.25);
  for (let i = 1; i < LANE_COLOR_COUNT; i++) {
    palette.push(hslToCss((hsl.h + i * step) % 1, sideS, hsl.l));
  }
  return palette;
}
