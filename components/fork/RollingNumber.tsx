"use client";

/**
 * fork:zm-04 — 逐位数字滚动（token / 成本 / 耗时变化时不再整串跳）。
 *
 * 为什么自己写而不用库：本仓没有也**不允许**引入 motion / framer-motion（§8 纪律 3），
 * 而这里需要的只是「新数字从 -90° 翻进来」这一条 WAAPI 动画，`element.animate` 就够。
 *
 * 三个必须守住的约束（照抄 ZCode `flip-metric-value.tsx` 的结论）：
 *   1. **定宽**：数字 `.66em`、`.`/`:` `.34em`，否则翻动时整行宽度在抖；
 *   2. **reduced-motion 返回静态文本**：不只省动画，还保证屏幕阅读器与视觉用户
 *      读到的是同一个完整数值；
 *   3. 非数字字符（单位、分隔符）静态，不参与翻动。
 *
 * 动效纪律：只有显式 `prefers-reduced-motion: no-preference` 才播动画；SSR / jsdom
 * 下偏好未知 → 纯静态，快照里不会出现动画中间态。可访问名走 `role="text"` +
 * `aria-label`，逐字符 span 全部 `aria-hidden`，避免读成「1、2、点、5」。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

export const ROLLING_DURATION_MS = 160;
export const ROLLING_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
export const ROLLING_DIGIT_WIDTH_EM = 0.66;
export const ROLLING_PUNCTUATION_WIDTH_EM = 0.34;
export const ROLLING_OTHER_WIDTH_EM = 0.7;
export const ROLLING_LINE_HEIGHT_EM = 1.15;

/** 动效偏好三态：unknown = SSR / jsdom / 不支持 matchMedia，一律按静态处理。 */
export type MotionPreference = "unknown" | "no-preference" | "reduce";

export function resolveMotionPreference(matches: boolean | null | undefined): MotionPreference {
  if (matches === true) return "reduce";
  if (matches === false) return "no-preference";
  return "unknown";
}

/** 当前动效偏好（只在浏览器里能回答；其它环境返回 unknown）。 */
export function currentMotionPreference(): MotionPreference {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "unknown";
  try {
    return resolveMotionPreference(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return "unknown";
  }
}

/**
 * 订阅 prefers-reduced-motion。ZM-04 / ZM-07 共用，避免每处各写一遍
 * 「未知即静态」的守卫。
 */
export function useMotionPreference(): MotionPreference {
  const [preference, setPreference] = useState<MotionPreference>(() => currentMotionPreference());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPreference(resolveMotionPreference(query.matches));
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return preference;
}

export function isDigitCharacter(character: string): boolean {
  return character >= "0" && character <= "9";
}

/** 固定字宽，保证同一位数字在滚动前后占同一格。 */
export function characterWidthEm(character: string): number {
  if (isDigitCharacter(character)) return ROLLING_DIGIT_WIDTH_EM;
  if (character === "." || character === ":") return ROLLING_PUNCTUATION_WIDTH_EM;
  return ROLLING_OTHER_WIDTH_EM;
}

export function formatRollingValue(value: string | number): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return value;
}

function RollingCharacter({
  character,
  animate,
  firstRenderRef,
  animateInitial,
}: {
  character: string;
  animate: boolean;
  /** 当前 RollingNumber 的首帧标志；首帧不播动画（除非 animateInitial）。 */
  firstRenderRef: RefObject<boolean>;
  animateInitial: boolean;
}) {
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const isDigit = isDigitCharacter(character);

  const setNode = useCallback((node: HTMLSpanElement | null) => {
    innerRef.current = node;
    if (!node || !animate || !isDigit) return;
    // 首帧静默：首屏数字不应该在加载时集体翻滚。
    if (firstRenderRef.current && !animateInitial) return;
    if (typeof node.animate !== "function") return;
    node.animate(
      [
        { transform: "rotateX(-90deg) translateY(-0.45em)", opacity: 0 },
        { transform: "rotateX(0deg) translateY(0)", opacity: 1 },
      ],
      { duration: ROLLING_DURATION_MS, easing: ROLLING_EASING },
    );
  }, [animate, animateInitial, firstRenderRef, isDigit]);

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        width: `${characterWidthEm(character)}em`,
        height: `${ROLLING_LINE_HEIGHT_EM}em`,
        overflow: "hidden",
        perspective: "8em",
        lineHeight: 1,
      }}
    >
      <span
        ref={setNode}
        aria-hidden="true"
        data-fork-roll-char={isDigit ? "digit" : "static"}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", transformOrigin: "50% 50%" }}
      >
        {character}
      </span>
    </span>
  );
}

export function RollingNumber({
  value,
  className,
  style,
  animateInitial = false,
  reducedMotion,
}: {
  value: string | number;
  className?: string;
  style?: CSSProperties;
  /** 首次挂载也播动画（默认 false：首屏不闪）。 */
  animateInitial?: boolean;
  /**
   * 强制按 reduced-motion 渲染静态文本。用于 SSR 断言 / 无障碍回归测试，
   * 避免测试环境里 matchMedia 不存在导致断言依赖「未知」分支。
   */
  reducedMotion?: boolean;
}) {
  const preference = useMotionPreference();
  const motion: MotionPreference = reducedMotion === true ? "reduce" : preference;
  const text = formatRollingValue(value);
  const characters = Array.from(text);
  // 首帧标志：挂在 ref 上而不是 state，避免为「是否首帧」多一次渲染。
  const firstRenderRef = useRef(true);
  useEffect(() => {
    firstRenderRef.current = false;
  }, []);

  return (
    <span
      role="text"
      aria-label={text}
      title={text}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: "100%",
        overflow: "hidden",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {characters.map((character, index) => (
        <RollingCharacter
          key={`${index}:${character}`}
          character={character}
          firstRenderRef={firstRenderRef}
          animateInitial={animateInitial}
          animate={motion === "no-preference"}
        />
      ))}
    </span>
  );
}
