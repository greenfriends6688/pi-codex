import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  ROLLING_DIGIT_WIDTH_EM,
  ROLLING_PUNCTUATION_WIDTH_EM,
  characterWidthEm,
  currentMotionPreference,
  formatRollingValue,
  isDigitCharacter,
  resolveMotionPreference,
  RollingNumber,
} = await jiti.import("./RollingNumber.tsx");

const source = await readFile(new URL("./RollingNumber.tsx", import.meta.url), "utf8");

function render(props) {
  return renderToStaticMarkup(React.createElement(RollingNumber, props));
}

/** 去掉标签后按 DOM 顺序取出的可见字符（aria-label 在属性里，不会混进来）。 */
function visibleText(html) {
  return html.replace(/<[^>]*>/g, "");
}

test("under reduced motion the complete value is rendered as static text", () => {
  const html = render({ value: "1,234.5k", reducedMotion: true });

  // 无障碍回归：屏幕阅读器与视觉用户必须拿到同一个完整数值。
  assert.equal(visibleText(html), "1,234.5k");
  assert.match(html, /role="text"/);
  assert.match(html, /aria-label="1,234\.5k"/);
  assert.match(html, /title="1,234\.5k"/);
});

test("a real prefers-reduced-motion: reduce query also renders the full static text", () => {
  // 不借助测试专用的 reducedMotion prop，直接模拟浏览器的媒体查询结果。
  const fakeWindow = {
    matchMedia: () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  };
  const previousWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    const html = render({ value: "$12.50" });
    assert.equal(visibleText(html), "$12.50");
    assert.match(html, /aria-label="\$12\.50"/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("the rendered characters are aria-hidden while the container owns the label", () => {
  const html = render({ value: "$0.42", reducedMotion: true });

  assert.equal(visibleText(html), "$0.42");
  // 逐字符 span 不参与朗读，避免读成「0 点 4 2」。
  const hidden = html.match(/aria-hidden="true"/g) ?? [];
  assert.equal(hidden.length, "$0.42".length);
});

test("digits and punctuation keep fixed widths so the line cannot jitter", () => {
  assert.equal(characterWidthEm("7"), ROLLING_DIGIT_WIDTH_EM);
  assert.equal(characterWidthEm("."), ROLLING_PUNCTUATION_WIDTH_EM);
  assert.equal(characterWidthEm(":"), ROLLING_PUNCTUATION_WIDTH_EM);
  assert.equal(characterWidthEm("k"), 0.7);
  assert.equal(characterWidthEm("M"), 0.7);
  assert.equal(characterWidthEm("%"), 0.7);
  assert.equal(ROLLING_DIGIT_WIDTH_EM, 0.66);
  assert.equal(ROLLING_PUNCTUATION_WIDTH_EM, 0.34);

  assert.equal(isDigitCharacter("5"), true);
  assert.equal(isDigitCharacter("万"), false);
});

test("formatRollingValue keeps strings and drops non-finite numbers", () => {
  assert.equal(formatRollingValue("12.5k"), "12.5k");
  assert.equal(formatRollingValue(42), "42");
  assert.equal(formatRollingValue(0), "0");
  assert.equal(formatRollingValue(Number.NaN), "");
  assert.equal(formatRollingValue(Number.POSITIVE_INFINITY), "");
});

test("motion preference is inert unless explicitly no-preference", () => {
  assert.equal(resolveMotionPreference(true), "reduce");
  assert.equal(resolveMotionPreference(false), "no-preference");
  // SSR / jsdom / 不支持 matchMedia：未知即静态。
  assert.equal(resolveMotionPreference(undefined), "unknown");
  assert.equal(resolveMotionPreference(null), "unknown");
  assert.equal(currentMotionPreference(), "unknown"); // node 里没有 window
});

test("the WAAPI roll only runs for explicit no-preference", () => {
  assert.match(source, /animate=\{motion === "no-preference"\}/);
  assert.match(source, /rotateX\(-90deg\)/);
  assert.match(source, /typeof node\.animate !== "function"/);
  assert.match(source, /firstRenderRef\.current && !animateInitial/);
  // 不允许引入 motion / framer-motion。
  assert.doesNotMatch(source, /from "framer-motion"|from "motion\/react"/);
});
