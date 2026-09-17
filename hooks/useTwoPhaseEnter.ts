"use client";

import { useEffect, useState } from "react";

/**
 * fork:ui-two-phase — two-phase enter for floating layers.
 *
 * Why: a layer that mounts directly in its final state never plays its enter
 * transition (the browser has nothing to transition *from*), and a layer that
 * starts an animation on the mount frame makes Chromium skip `backdrop-filter`
 * sampling, so glass layers render as plain translucency until the animation
 * ends (a bug that CDP screenshots do not show — see MusePi
 * `docs/gui-design.md` §"两段式"). The contract is therefore:
 *
 *   1. render the base class at `opacity: 0` (no animation on that frame),
 *   2. add the `--entered` modifier one double-rAF later, which starts the
 *      transition.
 *
 * Class-name rule (named after five separate regressions in the reference
 * implementation): the modifier must be appended to the *complete* base class —
 * `base + " " + base + "--entered"`. Writing `base + (entered ? "--entered" : "")`
 * drops the base class (the layer falls into document flow), and
 * `base + " --entered"` matches no selector (the layer stays invisible forever).
 * `enteredClass()` is the single place that composes it, and it is unit tested.
 */
export function enteredClass(base: string, entered: boolean): string {
  return entered ? `${base} ${base}--entered` : base;
}

/**
 * @param active whether the layer is mounted/visible
 * @returns whether the enter transition may start
 */
export function useTwoPhaseEnter(active: boolean): boolean {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!active) {
      setEntered(false);
      return;
    }
    // Reset first: a second open must replay the enter transition even though
    // the previous close left `entered` true for a frame.
    setEntered(false);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, [active]);

  return entered;
}
