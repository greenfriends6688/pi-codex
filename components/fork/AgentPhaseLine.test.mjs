import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { AgentPhaseLine } = await jiti.import("./AgentPhaseLine.tsx");

const render = (label) => renderToStaticMarkup(React.createElement(AgentPhaseLine, { label }));

test("renders the phase text as a live status line", () => {
  const html = render("正在运行工具 read");
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /正在运行工具 read/);
});

test("renders a nine-cell loader with one staggered delay per cell", () => {
  const html = render("waiting");
  assert.equal((html.match(/class="fork-pixel"/g) ?? []).length, 9);
  // 波前相位 (列 + |行 − 1|) * 90ms：每一列比前一列晚 90ms（向右推进），中间行比上下两行早 90ms。
  assert.deepEqual(
    [...html.matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1])),
    [90, 180, 270, 0, 90, 180, 90, 180, 270],
  );
});

test("starts the elapsed timer at zero", () => {
  assert.match(render("waiting"), /class="fork-phase-timer">0\.0s</);
});

test("renders nothing without a label", () => {
  assert.equal(render(null), "");
});
