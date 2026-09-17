"use client";

import type { ReactNode } from "react";

/*
 * fork:ui-copyicon — two-state copy button glyph with a real transition.
 *
 * Before: `{copied ? <Check/> : <Copy/>}` swaps the SVG instantly, so the only
 * feedback is the label change. MusePi morphs the glyph (`morphicons`); we do
 * not take that dependency, but stacking both glyphs and cross-fading them
 * (scale + opacity, `fork-copy-glyph` in app/fork-ui.css) gets the same read:
 * the copy shape collapses into the check instead of blinking.
 *
 * Both glyphs are always in the DOM, so the button width never changes and the
 * surrounding action row does not shift on click.
 */

function CopyGlyph(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckGlyph(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function CopyStateIcon({ copied }: { copied: boolean }): ReactNode {
  return (
    <span className="fork-copy-glyph" data-copied={copied ? "true" : "false"} aria-hidden="true">
      <span className="fork-copy-glyph__idle"><CopyGlyph /></span>
      <span className="fork-copy-glyph__done"><CheckGlyph /></span>
    </span>
  );
}
