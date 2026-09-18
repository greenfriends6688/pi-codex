import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { splitVisibleTabs } = await jiti.import("@/lib/tab-overflow");

const widths = (count, width = 120) => Array.from({ length: count }, () => width);

test("everything stays visible while it fits", () => {
  const { visible, hidden } = splitVisibleTabs({ widths: widths(3), containerWidth: 500, moreWidth: 34, activeIndex: 0 });
  assert.deepEqual(visible, [0, 1, 2]);
  assert.deepEqual(hidden, []);
});

test("the overflow button itself is budgeted for", () => {
  // 4 x 120 + gaps = 486 > 400, so folding starts; the "…" needs its own 34px.
  const { visible, hidden } = splitVisibleTabs({ widths: widths(4), containerWidth: 400, moreWidth: 34, activeIndex: 0 });
  assert.ok(visible.length >= 2);
  assert.equal(visible.length + hidden.length, 4);
  const used = visible.length * 120 + (visible.length - 1) * 2;
  assert.ok(used + 34 <= 400, "visible tabs plus the overflow button fit");
});

test("the active tab is never hidden", () => {
  const { visible, hidden } = splitVisibleTabs({ widths: widths(6), containerWidth: 300, moreWidth: 34, activeIndex: 5 });
  assert.ok(visible.includes(5), "active tab stayed visible");
  assert.ok(!hidden.includes(5), "and it is not in the fold list either");
  assert.equal(hidden.length, 4, "the tab that lost its slot to the active one is folded");
  assert.equal(visible.length + hidden.length, 6);
});

test("unknown widths fall back instead of collapsing the bar", () => {
  // Two 80px tabs plus a 34px button do not fit in 100px, so exactly one stays.
  const { visible, hidden } = splitVisibleTabs({ widths: [0, 0], containerWidth: 100, moreWidth: 34, activeIndex: -1, fallbackWidth: 80 });
  assert.deepEqual(visible, [0]);
  assert.deepEqual(hidden, [1]);
});

test("no tabs means no work", () => {
  assert.deepEqual(splitVisibleTabs({ widths: [], containerWidth: 300, moreWidth: 34, activeIndex: -1 }), { visible: [], hidden: [] });
});
