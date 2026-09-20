// fork:ds-small-parts（DS-07/DS-08）—— 12px 状态点：6px 实心点居中在 tinted halo 上，green / yellow / indigo。
// 来源：BoardUI components/base/badges/status-dot.tsx（MIT）。改动：点心的 bg-green-500 等原始色板类改为
// 主题变量 bg-(--color-green-500) 等 —— 仓库没有对应的语义 token，不为小件新增 token 时保持上游取色不变。
import type { HTMLAttributes, Ref } from "react";
import { cx, sortCx } from "@/utils/cx";

/**
 * Figma source: Board UI → dashboard 1 status dropdown dots (node 3731:3266).
 *
 * 12×12 status indicator: a 6px solid dot centered on a tinted halo.
 * Color pairs from Figma variables:
 *   green  → halo color/green/100,  dot color/green/500
 *   yellow → halo color/yellow/200, dot color/yellow/500
 *   indigo → halo color/indigo/100, dot color/indigo/500
 * In dark mode only the halo drops to 40% opacity; the center dot stays solid.
 */

type StatusDotColor = "green" | "yellow" | "indigo";

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  color?: StatusDotColor;
  ref?: Ref<HTMLSpanElement>;
}

const styles = sortCx({
  base: "inline-flex size-3 shrink-0 items-center justify-center rounded-full",
  halo: {
    green: "bg-status-dot-green-halo",
    yellow: "bg-status-dot-yellow-halo",
    indigo: "bg-status-dot-indigo-halo",
  },
  dot: {
    green: "bg-(--color-green-500)",
    yellow: "bg-(--color-yellow-500)",
    indigo: "bg-(--color-indigo-500)",
  },
});

export function StatusDot({ color = "green", className, ref, ...props }: StatusDotProps) {
  return (
    <span
      ref={ref}
      aria-hidden
      className={cx(styles.base, styles.halo[color], className)}
      {...props}
    >
      <span className={cx("size-1.5 rounded-full", styles.dot[color])} />
    </span>
  );
}
