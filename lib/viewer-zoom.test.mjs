import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampZoom,
  formatZoomPercent,
  isZoomed,
  stepZoom,
  wheelZoom,
  withPdfZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from "./viewer-zoom.ts";

test("clampZoom 夹取到 [0.25, 5]，非法值回落到 1", () => {
  assert.equal(clampZoom(0.1), ZOOM_MIN);
  assert.equal(clampZoom(99), ZOOM_MAX);
  assert.equal(clampZoom(2), 2);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(clampZoom(Number.POSITIVE_INFINITY), ZOOM_MAX);
});

test("stepZoom 按档位前进后退并在边界停住", () => {
  assert.equal(stepZoom(1, 1), 1 + ZOOM_STEP);
  assert.equal(stepZoom(1, -1), 1 - ZOOM_STEP);
  assert.equal(stepZoom(ZOOM_MAX, 1), ZOOM_MAX, "到上限不再增加");
  assert.equal(stepZoom(ZOOM_MIN, -1), ZOOM_MIN, "到下限不再减少");
});

test("stepZoom 不产生浮点毛刺", () => {
  let value = 1;
  for (let i = 0; i < 4; i++) value = stepZoom(value, 1);
  assert.equal(value, 2, `四步后应正好是 2，实际 ${value}`);
});

test("wheelZoom：向上滚（deltaY<0）放大，向下滚缩小", () => {
  assert.ok(wheelZoom(1, -100) > 1);
  assert.ok(wheelZoom(1, 100) < 1);
});

test("wheelZoom 同样受上下限约束", () => {
  assert.equal(wheelZoom(ZOOM_MAX, -10_000), ZOOM_MAX);
  assert.equal(wheelZoom(ZOOM_MIN, 10_000), ZOOM_MIN);
});

test("isZoomed 判定 1:1 附近为未缩放", () => {
  assert.equal(isZoomed(1), false);
  assert.equal(isZoomed(1.0000001), false);
  assert.equal(isZoomed(1.25), true);
});

test("formatZoomPercent 取整显示", () => {
  assert.equal(formatZoomPercent(1), "100%");
  assert.equal(formatZoomPercent(1.25), "125%");
  assert.equal(formatZoomPercent(9), "500%", "越界值先夹取");
});

test("withPdfZoom 追加 fragment，并保留已有 query", () => {
  const base = "/api/files/x.pdf?type=read";
  assert.equal(withPdfZoom(base, 1.5), `${base}#zoom=150`);
  // 重复调用不会叠加 fragment
  assert.equal(withPdfZoom(`${base}#zoom=150`, 2), `${base}#zoom=200`);
});
