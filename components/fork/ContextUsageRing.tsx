"use client";

/*
 * fork:ui-context-ring — context-window gauge for the composer.
 *
 * The percentage already existed, but only in the top-bar stats pill, far away
 * from where the user types. Wegent's desktop composer (`ContextUsageIndicator`)
 * puts the same number next to the send controls as a conic-gradient ring, so
 * this adopts that placement: a 13px ring whose filled arc is the used share,
 * coloured by the usual 70/90 thresholds, with the numbers in its tooltip.
 *
 * Rendered inside the existing compact button, so the ring doubles as that
 * control's icon: hover reads the usage, click compacts. No new button is added
 * to the control row, which keeps the phone layout untouched.
 */

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function contextUsageColor(percent: number | null): string {
  if (percent === null) return "var(--text-muted)";
  if (percent > 90) return "var(--danger)";
  if (percent > 70) return "var(--warning)";
  return "var(--text-muted)";
}

export function ContextUsageRing({ usage, size = 13 }: { usage: ContextUsage; size?: number }) {
  const percent = usage.percent;
  const color = contextUsageColor(percent);
  const hole = Math.max(4, Math.round(size * 0.54));

  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        // Unreported usage (no stats yet) stays an empty track instead of
        // pretending the window is at 0%.
        background: percent === null
          ? "transparent"
          : `conic-gradient(${color} ${Math.max(0, Math.min(100, percent)) * 3.6}deg, color-mix(in srgb, var(--border) 75%, transparent) 0deg)`,
        boxShadow: percent === null ? `inset 0 0 0 1.5px color-mix(in srgb, var(--border) 75%, transparent)` : undefined,
      }}
    >
      <span
        style={{
          width: hole,
          height: hole,
          borderRadius: "50%",
          background: "var(--bg-elev)",
        }}
      />
    </span>
  );
}

/** Tooltip body shared by the ring's button, so both stay in step. */
export function contextUsageTitle(usage: ContextUsage, actionLabel: string): string {
  const lines: string[] = [];
  if (usage.percent !== null) {
    lines.push(`${usage.percent.toFixed(0)}% used`);
  }
  if (usage.tokens !== null) {
    lines.push(`${formatCompact(usage.tokens)} / ${formatCompact(usage.contextWindow)} tokens`);
  } else {
    lines.push(`${formatCompact(usage.contextWindow)} tokens`);
  }
  lines.push(actionLabel);
  return lines.join("\n");
}
