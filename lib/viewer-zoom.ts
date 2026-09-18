/**
 * fork:gap-viewer-zoom — 图片/PDF 预览的缩放计算（纯逻辑，可在 Node 里单测）。
 *
 * 背景（`docs/proma-feature-matrix-2026-09-18.md` §3.3）：本仓库的图片预览只有
 * `maxWidth/maxHeight: 100%` 自适应、**没有任何缩放**；PDF 用浏览器原生 viewer，
 * 连缩放控件都没有（只能靠浏览器自己的 UI）。对照项目是 0.1x–5x + 拖拽平移。
 *
 * 这里只放比例计算：步进档位、夹取范围、百分比显示、以及"ctrl/⌘+滚轮"的换算。
 * DOM 部分（wheel 监听、拖拽平移、贴到 iframe fragment）留在组件里。
 */

/** 缩放档位：与对照项目的 0.1–5x 同量级，但档位取整便于按钮步进。 */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 5;
export const ZOOM_STEP = 0.25;

/** 滚轮每格的缩放系数（指数缩放，视觉上比线性加减更均匀）。 */
export const WHEEL_ZOOM_FACTOR = 0.0015;

export function clampZoom(value: number): number {
  // NaN 表示"未知"，回落到 1:1；±Infinity 是可比较的大小，照常夹取。
  if (Number.isNaN(value)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** 按档位前进/后退。`direction` 为正表示放大。 */
export function stepZoom(current: number, direction: number): number {
  const stepped = clampZoom(current) + Math.sign(direction) * ZOOM_STEP;
  // 避免浮点误差累积成 1.0000000000000002 这类值。
  return clampZoom(Math.round(stepped / ZOOM_STEP) * ZOOM_STEP);
}

/**
 * ctrl/⌘ + 滚轮的增量：向上滚（`deltaY < 0`）放大。
 * 指数缩放（`exp`）保证"每一格的视觉变化量相同"，线性加减在大比例时会显得忽快忽慢。
 */
export function wheelZoom(current: number, deltaY: number): number {
  return clampZoom(clampZoom(current) * Math.exp(-deltaY * WHEEL_ZOOM_FACTOR));
}

/** 是否已经偏离 1:1（用于决定要不要显示"重置"和启用手势平移）。 */
export function isZoomed(value: number): boolean {
  return Math.abs(value - 1) > 0.001;
}

export function formatZoomPercent(value: number): string {
  return `${Math.round(clampZoom(value) * 100)}%`;
}

/**
 * 给 PDF 的 iframe URL 贴上缩放 fragment。
 * Chromium 内置 PDF 阅读器认 `#zoom=<percent>`，所以不需要自建 viewer。
 * 容器 URL 里可能已经带 query（`?type=read`），fragment 必须追加在最后。
 */
export function withPdfZoom(url: string, zoom: number): string {
  const base = url.split("#")[0];
  return `${base}#zoom=${Math.round(clampZoom(zoom) * 100)}`;
}
