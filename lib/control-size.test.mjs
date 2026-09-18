/**
 * lib/control-size.test.mjs 对应的被测模块见 ./control-size.ts。
 * 中文注释：控件梯度常量的单测（档位映射 + 梯度外归并）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { CONTROL, CONTROL_PX, CONTROL_STEPS, nearestControlStep, nearestControlStepName } =
  await jiti.import("./control-size.ts");

test("CONTROL 映射到对应的 CSS 变量", () => {
  assert.equal(CONTROL.md, "var(--control-md)");
  assert.equal(CONTROL.touch, "var(--control-touch)");
  assert.equal(Object.keys(CONTROL).length, 6);
});

test("CONTROL_PX 与 globals.css 的梯度一致", () => {
  assert.deepEqual({ ...CONTROL_PX }, {
    xs: 22, sm: 26, md: 28, lg: 32, xl: 36, touch: 44,
  });
  assert.deepEqual([...CONTROL_STEPS], ["xs", "sm", "md", "lg", "xl", "touch"]);
});

test("梯度上的值精确命中", () => {
  assert.equal(nearestControlStep(28), "var(--control-md)");
  assert.equal(nearestControlStep(44), "var(--control-touch)");
  assert.equal(nearestControlStepName(22), "xs");
});

test("梯度外的值归并到最近档", () => {
  assert.equal(nearestControlStep(30), "var(--control-md)"); // |30-28|=2 < |30-32|=2? 否→并列取小
  assert.equal(nearestControlStep(33), "var(--control-lg)");
  assert.equal(nearestControlStep(40), "var(--control-xl)"); // |40-36|=4 = |40-44|=4→取小
  assert.equal(nearestControlStep(100), "var(--control-touch)");
  assert.equal(nearestControlStep(10), "var(--control-xs)");
});

test("并列距离收敛到较小档", () => {
  assert.equal(nearestControlStepName(30), "md"); // 距 28/32 都是 2
  assert.equal(nearestControlStepName(27), "sm"); // 距 26/28 都是 1
  assert.equal(nearestControlStepName(40), "xl"); // 距 36/44 都是 4
});

test("非法输入不抛异常并回退到 md", () => {
  assert.equal(nearestControlStep(NaN), "var(--control-md)");
  assert.equal(nearestControlStep(Infinity), "var(--control-md)");
  assert.equal(nearestControlStepName(NaN), "md");
});
