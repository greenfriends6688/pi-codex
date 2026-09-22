"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * fork:zm-01 — two-phase *collapse* presence for grid-row height animations.
 *
 * Why: every collapsible body used to be conditionally rendered
 * (`{expanded && <Body/>}`), so the browser had nothing to animate — removing
 * the node jumps the layout instantly. The fix is a permanently mounted
 * `display: grid` wrapper whose `grid-template-rows` goes `0fr ↔ 1fr`, but that
 * must not turn every collapsed body into permanent DOM: `ThinkingBlock` bodies
 * are lazily fetched precisely so a 50-message page does not materialise every
 * reasoning trace (`lib/chat-lazy-load.ts`, `VISIBLE_PAGE_SIZE = 50`). This
 * helper keeps the grid content mounted for exactly as long as the animation
 * needs it:
 *
 *   1. `expanded` → render right away (the grid must grow into real content on
 *      the first frame — waiting for an effect would animate an empty row);
 *   2. `expanded` goes false → keep rendering and arm a settle watcher on the
 *      grid element;
 *   3. the watcher fires on the `grid-template-rows` `transitionend`, or after
 *      `durationMs + 50` when that event never arrives (reduced motion,
 *      `display: none` ancestor, jsdom) → stop rendering.
 *
 * Net contract: a body that was never expanded is still absent from the DOM,
 * and an expanded-then-collapsed body leaves the DOM one transition after the
 * click. Keep `COLLAPSE_DURATION_MS` in sync with `--fork-collapse-duration`
 * in app/fork-ui.css.
 */

export const COLLAPSE_DURATION_MS = 260;

/** Grace after the CSS duration before the fallback gives up on `transitionend`. */
export const COLLAPSE_FALLBACK_GRACE_MS = 50;

export function collapseFallbackMs(durationMs: number = COLLAPSE_DURATION_MS): number {
  return durationMs + COLLAPSE_FALLBACK_GRACE_MS;
}

/**
 * The grid wrapper is only finished collapsing when its own
 * `grid-template-rows` transition ends. Other transitions (hover colours,
 * banners) bubble through the same element, so filter on element *and*
 * property; a null grid (no ref attached by the caller) never matches and lets
 * the fallback timer decide.
 */
export function isCollapseTransitionEnd(
  event: Pick<Event, "target"> & { propertyName?: string },
  grid: EventTarget | null,
): boolean {
  return grid !== null && event.target === grid && event.propertyName === "grid-template-rows";
}

/**
 * Render decision: expanded now, or still inside the collapse animation.
 * Extracted so the "keep the collapsed body in the DOM" contract is unit
 * tested without a DOM renderer.
 */
export function shouldRenderCollapsedBody(expanded: boolean, mountedForCollapse: boolean): boolean {
  return expanded || mountedForCollapse;
}

/**
 * Arms the settle watcher for one collapse and returns its cleanup, so an
 * interrupted collapse (re-expand) can never unmount a body that is animating
 * back open, and the fallback timer cannot fire after unmount.
 */
export function watchCollapseSettle(
  grid: EventTarget | null,
  durationMs: number,
  onSettled: () => void,
): () => void {
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onSettled();
  };
  const onTransitionEnd = (event: Event) => {
    if (isCollapseTransitionEnd(event, grid)) settle();
  };
  grid?.addEventListener("transitionend", onTransitionEnd);
  const timer = setTimeout(settle, collapseFallbackMs(durationMs));
  return () => {
    if (grid) grid.removeEventListener("transitionend", onTransitionEnd);
    clearTimeout(timer);
  };
}

/**
 * @param expanded the block's intended visibility
 * @param durationMs must match the `grid-template-rows` transition in
 *   app/fork-ui.css (`--fork-collapse-duration`)
 * @param gridRef the `.fork-collapse` wrapper, used for the early
 *   `transitionend`; omit it and the fallback timer still unmounts correctly
 * @returns whether the collapsible body should be rendered right now
 */
export function useCollapsePresence(
  expanded: boolean,
  durationMs: number = COLLAPSE_DURATION_MS,
  gridRef?: RefObject<HTMLElement | null>,
): boolean {
  // Only tracks "a collapse animation is still in flight". `expanded` alone is
  // always enough to render, so expanding mounts the body in the same commit
  // the grid becomes `1fr` — no frame where the row animates empty.
  const [mountedForCollapse, setMountedForCollapse] = useState(expanded);

  useEffect(() => {
    if (expanded) {
      setMountedForCollapse(true);
      return;
    }
    if (!mountedForCollapse) return;
    return watchCollapseSettle(gridRef?.current ?? null, durationMs, () => {
      setMountedForCollapse(false);
    });
    // gridRef is a stable ref object; its identity never changes, so listing it
    // only documents the dependency for the linter.
  }, [expanded, mountedForCollapse, durationMs, gridRef]);

  return shouldRenderCollapsedBody(expanded, mountedForCollapse);
}
