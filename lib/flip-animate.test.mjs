/**
 * lib/flip-animate.test.mjs 被测模块见 ./flip-animate.ts。
 *
 * 钉住：快照 diff 的几何结果、未知 key 的双向忽略、height 的 ≥0.5px 阈值、
 * reduced-motion / 偏好未知环境不产生动画，以及 WAAPI 应用层的取消行为。
 */
import assert from "node:assert/strict";
import test from "node:test";

const {
  FLIP_DURATION_MS,
  FLIP_EASING,
  FLIP_HEIGHT_DELTA_THRESHOLD,
  animateFlip,
  diffFlip,
  flipKeyframes,
  motionAllowed,
} = await import("./flip-animate.ts");

const rect = (top, left = 0, width = 100, height = 32) => ({ top, left, width, height });
const snapshot = (entries) => new Map(Object.entries(entries));

test("diffFlip computes the delta between two snapshots", () => {
  const previous = snapshot({ a: rect(0), b: rect(32) });
  const next = snapshot({ a: rect(32), b: rect(0) });
  const deltas = diffFlip(previous, next);
  assert.deepEqual(deltas, [
    { key: "a", dx: 0, dy: -32, previousHeight: 32, nextHeight: 32, animateHeight: false },
    { key: "b", dx: 0, dy: 32, previousHeight: 32, nextHeight: 32, animateHeight: false },
  ]);
});

test("diffFlip ignores keys that only exist on one side", () => {
  const previous = snapshot({ removed: rect(0), kept: rect(0) });
  const next = snapshot({ kept: rect(64), mounted: rect(96) });
  const deltas = diffFlip(previous, next);
  assert.deepEqual(deltas.map((delta) => delta.key), ["kept"]);
  assert.equal(deltas[0].dy, -64);
});

test("diffFlip skips elements that did not move and did not resize", () => {
  const previous = snapshot({ a: rect(0), b: rect(32, 5, 100, 32) });
  const next = snapshot({ a: rect(0), b: rect(32, 5, 100, 32) });
  assert.deepEqual(diffFlip(previous, next), []);
});

test("the height animation only turns on at the 0.5px threshold", () => {
  assert.equal(FLIP_HEIGHT_DELTA_THRESHOLD, 0.5);
  // 0.4px 的高度变化不做任何动画（既不位移也不高度）
  assert.deepEqual(
    diffFlip(snapshot({ a: rect(0, 0, 100, 32) }), snapshot({ a: rect(0, 0, 100, 32.4) })),
    [],
  );
  const at = diffFlip(snapshot({ a: rect(0, 0, 100, 32) }), snapshot({ a: rect(0, 0, 100, 32.5) }));
  assert.equal(at[0].animateHeight, true);
  const shrink = diffFlip(snapshot({ a: rect(0, 0, 100, 32) }), snapshot({ a: rect(0, 0, 100, 31.5) }));
  assert.equal(shrink[0].animateHeight, true, "shrinking counts too");
});

test("reduced motion produces no deltas at the pure layer", () => {
  const previous = snapshot({ a: rect(0) });
  const next = snapshot({ a: rect(32) });
  assert.deepEqual(diffFlip(previous, next, { reducedMotion: true }), []);
});

test("flipKeyframes only carries height when the delta crosses the threshold", () => {
  const moving = {
    key: "a",
    dx: 4,
    dy: -8,
    previousHeight: 40,
    nextHeight: 40,
    animateHeight: false,
  };
  assert.deepEqual(flipKeyframes(moving), [
    { transform: "translate(4px, -8px)" },
    { transform: "none" },
  ]);
  const resizing = { ...moving, animateHeight: true, previousHeight: 40, nextHeight: 64 };
  assert.deepEqual(flipKeyframes(resizing), [
    { transform: "translate(4px, -8px)", height: "40px" },
    { transform: "none", height: "64px" },
  ]);
});

test("motionAllowed is inert when the preference is unknown (node/SSR)", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(motionAllowed(), false);
});

test("animateFlip is inert by default in a no-matchMedia environment", () => {
  const calls = [];
  const element = {
    getAnimations: () => [],
    animate: (keyframes, timing) => {
      calls.push({ keyframes, timing });
      return { cancel() {} };
    },
  };
  const deltas = [{ key: "a", dx: 0, dy: 10, previousHeight: 32, nextHeight: 32, animateHeight: false }];
  assert.deepEqual(animateFlip(deltas, () => element), []);
  assert.equal(calls.length, 0);
});

test("animateFlip cancels running animations, then animates from old to new", () => {
  const cancelled = [];
  const calls = [];
  const element = {
    getAnimations: () => [{ cancel: () => cancelled.push("cancelled") }],
    animate: (keyframes, timing) => {
      calls.push({ keyframes, timing });
      return { cancel() {}, playState: "running" };
    },
  };
  const deltas = [
    { key: "a", dx: 0, dy: 10, previousHeight: 32, nextHeight: 48, animateHeight: true },
    { key: "missing", dx: 0, dy: 10, previousHeight: 32, nextHeight: 32, animateHeight: false },
  ];
  const animations = animateFlip(deltas, (key) => (key === "a" ? element : null), { reducedMotion: false });
  assert.equal(cancelled.length, 1);
  assert.equal(animations.length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].timing, { duration: FLIP_DURATION_MS, easing: FLIP_EASING });
  assert.deepEqual(calls[0].keyframes, [
    { transform: "translate(0px, 10px)", height: "32px" },
    { transform: "none", height: "48px" },
  ]);
});

test("animateFlip honors an explicit reducedMotion override (no calls at all)", () => {
  let called = false;
  const element = {
    getAnimations: () => [],
    animate: () => {
      called = true;
      return { cancel() {} };
    },
  };
  const deltas = [{ key: "a", dx: 0, dy: 10, previousHeight: 32, nextHeight: 32, animateHeight: false }];
  assert.deepEqual(animateFlip(deltas, () => element, { reducedMotion: true }), []);
  assert.equal(called, false);
});
