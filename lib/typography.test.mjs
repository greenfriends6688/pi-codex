/**
 * lib/typography.test.mjs 对应的被测模块见 ./typography.ts。
 * 中文注释：类型梯度常量的单测（档位映射 + 梯度外归并）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { TEXT, TEXT_PX, TEXT_STEPS, nearestTextStep, nearestTextStepName, textStepPx } =
  await jiti.import("./typography.ts");

test("TEXT 映射到对应的 CSS 变量", () => {
  assert.equal(TEXT.md, "var(--text-md)");
  assert.equal(TEXT["2xs"], "var(--text-2xs)");
  assert.equal(TEXT["3xl"], "var(--text-3xl)");
  assert.equal(Object.keys(TEXT).length, 8);
});

test("TEXT_PX 与 globals.css 的梯度一致", () => {
  assert.deepEqual({ ...TEXT_PX }, {
    "2xs": 10, xs: 11, sm: 12, md: 13, lg: 14, xl: 15, "2xl": 18, "3xl": 24,
  });
  assert.deepEqual([...TEXT_STEPS], ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"]);
});

test("梯度上的值精确命中", () => {
  assert.equal(nearestTextStep(13), "var(--text-md)");
  assert.equal(nearestTextStep(10), "var(--text-2xs)");
  assert.equal(nearestTextStep(24), "var(--text-3xl)");
  assert.equal(nearestTextStepName(15), "xl");
});

test("梯度外的值归并到最近档", () => {
  assert.equal(nearestTextStep(9), "var(--text-2xs)"); // 低于最小值钳到最小档
  assert.equal(nearestTextStep(20), "var(--text-2xl)"); // |20-18|=2 < |20-24|=4
  assert.equal(nearestTextStep(30), "var(--text-3xl)"); // 高于最大值钳到最大档
  assert.equal(nearestTextStep(16.5), "var(--text-xl)"); // 距 15/18 都是 1.5→并列取小
});

test("并列距离收敛到较小档", () => {
  assert.equal(nearestTextStepName(11.5), "xs"); // 距 11/12 都是 0.5
  assert.equal(nearestTextStepName(12.5), "sm");
  assert.equal(nearestTextStepName(13.5), "md");
  assert.equal(nearestTextStepName(16.5), "xl"); // 距 15/18 都是 1.5
  assert.equal(nearestTextStepName(21), "2xl"); // 距 18/24 都是 3
});

test("非法输入不抛异常并回退到 md", () => {
  assert.equal(nearestTextStep(NaN), "var(--text-md)");
  assert.equal(nearestTextStep(Infinity), "var(--text-md)");
  assert.equal(nearestTextStepName(NaN), "md");
  assert.equal(textStepPx("md"), 13);
  assert.equal(textStepPx("nope"), undefined);
});
