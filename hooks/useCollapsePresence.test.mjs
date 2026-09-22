import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  COLLAPSE_DURATION_MS,
  COLLAPSE_FALLBACK_GRACE_MS,
  collapseFallbackMs,
  isCollapseTransitionEnd,
  shouldRenderCollapsedBody,
  watchCollapseSettle,
} = await jiti.import("@/hooks/useCollapsePresence");

/*
 * fork:zm-01 — the contract this file pins down.
 *
 * The collapse animation only works if the body outlives `expanded === false`
 * for one transition, and the lazy-load guarantee only holds if it leaves the
 * DOM afterwards. `watchCollapseSettle` is that half of the hook: the grid's
 * own `grid-template-rows` transitionend ends it, and `durationMs + 50` is the
 * fallback for environments where transitionend never fires (reduced motion,
 * display:none ancestors, jsdom).
 */

function makeTransitionEnd(propertyName) {
  const event = new Event("transitionend");
  Object.defineProperty(event, "propertyName", { value: propertyName });
  return event;
}

test("fallback waits the CSS duration plus one frame of grace", () => {
  assert.equal(collapseFallbackMs(), COLLAPSE_DURATION_MS + COLLAPSE_FALLBACK_GRACE_MS);
  assert.equal(collapseFallbackMs(260), 310);
  assert.equal(collapseFallbackMs(0), 50);
});

test("body stays rendered through the collapse and leaves after it", () => {
  assert.equal(shouldRenderCollapsedBody(true, false), true, "expanded renders");
  assert.equal(shouldRenderCollapsedBody(true, true), true, "expanded wins");
  assert.equal(shouldRenderCollapsedBody(false, true), true, "still animating: keep the body");
  assert.equal(shouldRenderCollapsedBody(false, false), false, "collapse settled: drop the body");
});

test("only the grid's own grid-template-rows transition end counts", () => {
  const grid = new EventTarget();
  const other = new EventTarget();

  const matching = makeTransitionEnd("grid-template-rows");
  grid.dispatchEvent(matching);
  assert.equal(isCollapseTransitionEnd(matching, grid), true);

  const wrongProperty = makeTransitionEnd("background-color");
  grid.dispatchEvent(wrongProperty);
  assert.equal(isCollapseTransitionEnd(wrongProperty, grid), false);

  const wrongTarget = makeTransitionEnd("grid-template-rows");
  other.dispatchEvent(wrongTarget);
  assert.equal(isCollapseTransitionEnd(wrongTarget, grid), false);
  assert.equal(isCollapseTransitionEnd(wrongTarget, null), false);
});

test("a matching transitionend settles the collapse exactly once", () => {
  const grid = new EventTarget();
  let calls = 0;
  const cleanup = watchCollapseSettle(grid, 10_000, () => { calls += 1; });

  grid.dispatchEvent(makeTransitionEnd("grid-template-rows"));
  assert.equal(calls, 1);
  // A second event (the row can transition again after the body is dropped)
  // must not unmount a second time.
  grid.dispatchEvent(makeTransitionEnd("grid-template-rows"));
  assert.equal(calls, 1);

  cleanup();
});

test("other transitions do not settle; the fallback timer does", async () => {
  const grid = new EventTarget();
  let calls = 0;
  const cleanup = watchCollapseSettle(grid, 40, () => { calls += 1; });

  grid.dispatchEvent(makeTransitionEnd("background-color"));
  await delay(30);
  assert.equal(calls, 0, "background-color transitionend must be ignored");

  await delay(80);
  assert.equal(calls, 1, "fallback fires at duration + 50");
  cleanup();
});

test("cleanup cancels a pending fallback (interrupted collapse)", async () => {
  let calls = 0;
  const cleanup = watchCollapseSettle(null, 5, () => { calls += 1; });
  cleanup();
  await delay(80);
  assert.equal(calls, 0);

  // Without a ref the watcher is timer-only, which is the documented fallback.
  const timerOnly = watchCollapseSettle(null, 5, () => { calls += 1; });
  await delay(80);
  assert.equal(calls, 1);
  timerOnly();
});
