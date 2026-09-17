"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

/*
 * fork:ui-tipline — rotating capability tips under the new-session composer
 * (MusePi `WelcomeComposer.tsx:65-93` parity: 14 tips, random and never the one
 * already on screen).
 *
 * Why it earns its place: most of this app's surface is behind a prefix (`/`,
 * `@`, `!`) or behind a right-click, and the empty state is the one moment
 * where the user has nothing to read yet. A rotating line teaches one thing at
 * a time without adding a control.
 *
 * Rules kept from the reference: every tip must describe something that
 * actually exists *today* (no advertising planned features), the current tip is
 * never repeated back-to-back, and long tips ellipsize instead of wrapping the
 * composer row.
 */

/** i18n keys, in rotation order. Add new tips to all three locales. */
export const TIP_KEYS = [
  "home.tipSlash",
  "home.tipBash",
  "home.tipHistory",
  "home.tipPasteImage",
  "home.tipToolPreset",
  "home.tipContextRing",
  "home.tipPinArchive",
  "home.tipSkills",
  "home.tipThinking",
  "home.tipBranches",
  "home.tipPanels",
  "home.tipAppearance",
] as const;

export const TIP_ROTATE_MS = 20000;

/** Random index, never the current one. Pure so the rule can be unit tested. */
export function nextTipIndex(current: number, count: number = TIP_KEYS.length): number {
  if (count <= 1) return 0;
  const pool = Array.from({ length: count }, (_, i) => i).filter((i) => i !== current);
  return pool[Math.floor(Math.random() * pool.length)] ?? 0;
}

export function ComposerTipLine(): ReactNode {
  const { t } = useI18n();
  const [index, setIndex] = useState(() => Math.floor(Math.random() * TIP_KEYS.length));
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => nextTipIndex(current)), TIP_ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  const key = TIP_KEYS[index] ?? TIP_KEYS[0];
  return (
    // key on the span restarts the fade for each tip; the text is already
    // decorative in the layout (ellipsis, muted), so this stays cheap.
    <span
      key={key}
      className="fork-tipline"
      style={{
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: 11.5,
        lineHeight: 1,
        color: "var(--text-dim)",
      }}
    >
      {t(key)}
    </span>
  );
}
