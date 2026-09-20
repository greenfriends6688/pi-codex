// fork:ds-chat-motion（DS-24）—— Agent 思考态：四种指示器 + shimmer 标签 + 已用时长。
// 来源：BoardUI components/application/agent-thinking/agent-thinking.tsx（MIT）。
// 改动：无 motion / remixicon 需要替换（上游本来就只用 CSS 关键帧 + 内联 SVG）；
//       accent 色调从裸色 --color-blue-500 换成语义 token --color-accent-500；
//       dots 轮询与已用时长在 prefers-reduced-motion 下都不启动。保留：SSR 确定性
//       首帧、role="status" + aria 语义、shimmer/星火/彗尾的关键帧类、100ms 计时节奏。

"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { cx } from "@/utils/cx";

/**
 * Agent Thinking —— 工作期间停在输入框上方的“思考中”状态。
 *
 * 四种形态：
 * - `wave`     点阵上一条对角线波前从左上滑向右下
 * - `spin`     点阵上一个亮点顺时针绕圈
 * - `stars`    火花交错闪烁
 * - `infinity` 彗尾扫过 8 字
 *
 * 每种形态都配 shimmer 文案与挂载后开始计时的已用时长。减少动态偏好下，
 * shimmer 与 CSS 动画退回静态渲染（关键帧在 app/boardui/globals-subset.css）。
 */

/** 四种指示器形态，按声明顺序导出，供菜单/测试遍历。 */
export const THINKING_VARIANTS = ["wave", "spin", "stars", "infinity"] as const;
export type ThinkingVariant = (typeof THINKING_VARIANTS)[number];
export type ThinkingTone = "subtle" | "default" | "primary" | "accent";

export interface ThinkingIndicatorProps {
  variant?: ThinkingVariant;
  /** 状态文案，例如 "Thinking" 或 "Searching the docs"。 */
  label?: string;
  /** 指示器 + 文案的色调，每种 variant 有默认值（`stars` 默认 subtle）。 */
  tone?: ThinkingTone;
  /** 扫过标签的高光。 */
  shimmer?: boolean;
  /** 挂载后的已用秒数，跟在标签后面。 */
  showTimer?: boolean;
  className?: string;
}

const TONE_COLORS: Record<ThinkingTone, string> = {
  subtle: "var(--color-text-tertiary)",
  default: "var(--color-text-secondary)",
  primary: "var(--color-text-primary)",
  // 上游此处是 --color-blue-500；换成同值的语义槽位，主题切换时组件不必再动。
  accent: "var(--color-accent-500)",
};

const VARIANT_TONE: Record<ThinkingVariant, ThinkingTone> = {
  wave: "default",
  spin: "default",
  stars: "subtle",
  infinity: "default",
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 只在 effect 里调用，服务端渲染不会走到这里。 */
function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/* ------------------------------------------------------------------- dots */

const DOTS_GRID = 3;
const DOTS_SIZE = 4;
const DOTS_GAP = 2;
const DOTS_TICK_MS = 80;
const DOTS_FADE_MS = 220;
const DOTS_TRAIL = 0.3;
const DOTS_MIN_OPACITY = 0.12;
const DOTS_PHASE_STEP = 1 / 8;

// 静态首帧：服务端与客户端逐像素一致，也是 prefers-reduced-motion 下的静止状态。
const DOTS_SEED = [0.55, 0.3, 0.15, 0.85, 0.55, 0.3, 1, 0.85, 0.55];

/**
 * 每个格子在图案行进方向上的位置，落在 [0, 1)。wave 的相位被压到 1 以下，
 * 这样相位回卷时读起来是波前离开网格再从另一头进来；spin 的极角天然循环。
 */
function dotScalar(variant: "wave" | "spin", col: number, row: number) {
  const m = DOTS_GRID - 1;
  if (variant === "wave") {
    return ((col + row) / (2 * m)) * (DOTS_GRID / (DOTS_GRID + 1));
  }
  const center = m / 2;
  return (Math.atan2(row - center, col - center) / (2 * Math.PI) + 1) % 1;
}

function dotOpacities(variant: "wave" | "spin", phase: number) {
  return Array.from({ length: DOTS_GRID * DOTS_GRID }, (_, i) => {
    const s = dotScalar(variant, i % DOTS_GRID, Math.floor(i / DOTS_GRID));
    // 彗星：相位最前端是亮头，后面拖着渐暗的尾巴。
    const behind = (phase - s + 1) % 1;
    const lit = Math.max(0, 1 - behind / DOTS_TRAIL) ** 1.5;
    return DOTS_MIN_OPACITY + (1 - DOTS_MIN_OPACITY) * lit;
  });
}

function DotsIndicator({ variant }: { variant: "wave" | "spin" }) {
  const [opacities, setOpacities] = useState<number[]>(DOTS_SEED);

  useEffect(() => {
    // 减少动态偏好下保持 DOTS_SEED 的静止帧，不启动 80ms 轮询。
    if (prefersReducedMotion()) return;
    let phase = 0;
    const id = window.setInterval(() => {
      phase = (phase + DOTS_PHASE_STEP) % 1;
      setOpacities(dotOpacities(variant, phase));
    }, DOTS_TICK_MS);
    return () => window.clearInterval(id);
  }, [variant]);

  return (
    <span
      aria-hidden
      className="grid shrink-0"
      style={{
        gridTemplateColumns: `repeat(${DOTS_GRID}, ${DOTS_SIZE}px)`,
        gap: DOTS_GAP,
      }}
    >
      {opacities.map((opacity, i) => (
        <span
          key={i}
          className="rounded-[1px] bg-current"
          style={{
            width: DOTS_SIZE,
            height: DOTS_SIZE,
            opacity,
            transition: `opacity ${DOTS_FADE_MS}ms ease`,
          }}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ stars */

const STAR_PERIOD_S = 1.4;
const STAR_SIZE = 14;
const STAR_COUNT = 5;
const STAR_LAYOUT = [
  { x: 50, y: 46, scale: 1 },
  { x: 18, y: 22, scale: 0.55 },
  { x: 82, y: 26, scale: 0.45 },
  { x: 78, y: 76, scale: 0.55 },
  { x: 22, y: 78, scale: 0.4 },
];
const STAR_PATH = "M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z";

function StarsIndicator() {
  const box = STAR_SIZE * 1.5;
  return (
    <span
      aria-hidden
      className="bui-agent-thinking-stars relative block shrink-0"
      style={{ width: box, height: box }}
    >
      {STAR_LAYOUT.slice(0, STAR_COUNT).map((star, i) => {
        const size = STAR_SIZE * star.scale;
        return (
          <svg
            key={i}
            viewBox="0 0 24 24"
            className="bui-agent-thinking-star absolute"
            style={{
              width: size,
              height: size,
              left: `${star.x}%`,
              top: `${star.y}%`,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              animationDuration: `${STAR_PERIOD_S}s`,
              animationDelay: `${(i * STAR_PERIOD_S * 0.7) / STAR_COUNT}s`,
            }}
          >
            <path d={STAR_PATH} fill="currentColor" />
          </svg>
        );
      })}
    </span>
  );
}

/* --------------------------------------------------------------- infinity */

const INFINITY_WIDTH = 32;
const INFINITY_TRAIL = 11;
const INFINITY_STROKE = 2.75;
const INFINITY_DURATION_S = 1.2;
const INFINITY_PATH =
  "M28 14C33 5 47 5 47 14C47 23 33 23 28 14C23 5 9 5 9 14C9 23 23 23 28 14Z";

function InfinityIndicator() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 56 28"
      className="shrink-0"
      // 8 字横跨 56 宽 viewBox 的 x 9-47，这个宽度下左右各有约 4px 死区；
      // 收回来才能让标签落在与其他 variant 相同的间距上。
      style={{ width: INFINITY_WIDTH, height: INFINITY_WIDTH / 2, margin: "0 -4px" }}
    >
      <path
        d={INFINITY_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={INFINITY_STROKE}
        opacity={0.15}
      />
      <path
        d={INFINITY_PATH}
        pathLength={100}
        fill="none"
        stroke="currentColor"
        strokeWidth={INFINITY_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${INFINITY_TRAIL} ${100 - INFINITY_TRAIL}`}
        className="bui-agent-thinking-comet"
        style={{ animationDuration: `${INFINITY_DURATION_S}s` }}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ timer */

function ElapsedTimer() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // 减少动态偏好下不启动 100ms 轮询：跳动的秒数本身就是动态。
    // 首帧固定 0.0s，与服务端输出一致，因此没有水合差异。
    if (prefersReducedMotion()) return;
    const started = performance.now();
    const id = window.setInterval(() => setElapsed((performance.now() - started) / 1000), 100);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="font-mono text-caption-1-regular text-text-tertiary tabular-nums">
      {elapsed.toFixed(1)}s
    </span>
  );
}

/* ----------------------------------------------------------------- loader */

export function ThinkingIndicator({
  variant = "wave",
  label = "Thinking",
  tone,
  shimmer = true,
  showTimer = true,
  className,
}: ThinkingIndicatorProps) {
  const color = TONE_COLORS[tone ?? VARIANT_TONE[variant]];

  return (
    <div
      role="status"
      className={cx("flex items-center gap-2.5", className)}
      style={{ color, "--bui-agent-thinking-tone": color } as CSSProperties}
    >
      {(variant === "wave" || variant === "spin") && <DotsIndicator variant={variant} />}
      {variant === "stars" && <StarsIndicator />}
      {variant === "infinity" && <InfinityIndicator />}
      <span
        aria-label={label}
        className={cx("text-body-medium", shimmer && "bui-agent-thinking-label")}
      >
        {label}
      </span>
      {showTimer && <ElapsedTimer />}
    </div>
  );
}
