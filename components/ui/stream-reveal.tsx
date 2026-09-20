// fork:ds-chat-motion（DS-24）—— 流式文本逐行入场 + 进行中 shimmer + 揭示节拍器。
// 来源：BoardUI components/application/agent-chat/agent-chat-message.tsx（StreamedText /
//       Line）与 components/application/agent-log/agent-log.tsx（ShimmerText /
//       useRevealTicker）（MIT）。
// 改动：去 motion/react——行入场改为 CSS transition + Tailwind `starting:` 挂载过渡，
//       并用 `motion-safe:` 在 CSS 侧兜底减少动态（JS 侧 animate 为 false 时类名直接不挂）；
//       去 remixicon（本文件上游相关片段本就没有图标）。保留：逐行而非逐词、模块级
//       动画常量、Line 的 memo 只在挂载时动画一次、ShimmerText 的
//       `.agent-progress-loading-text`、节拍器的 controlled/revealed 优先级、delayFor
//       节奏与 onComplete 的 ref 防重入。

"use client";

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "@/utils/cx";

/* --------------------------------------------------------- reduced motion */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onStoreChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION_QUERY).matches;
}

/**
 * 服务端快照固定 false：SSR 与首次水合都按“允许动画”输出，useSyncExternalStore
 * 在水合后立刻用真实偏好做一次同步重渲染，所以既不会水合告警，也不会拖到首帧之后。
 */
function getReducedMotionServerSnapshot() {
  return false;
}

/** 读取系统“减少动态”偏好，并跟随系统设置变化。 */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

/* ------------------------------------------------------------ streamed text */

export interface StreamedLinesProps {
  /** 原始文本；按 `\n` 拆行，纯空白行丢弃。 */
  text: string;
  className?: string;
}

/**
 * 常量放在模块作用域，身份保持稳定。一行在回复的每个 token 到达时都会重渲染
 * （一秒几十次），每次渲染都传新对象/新字符串只会让浏览器重复比较没变的目标值。
 *
 * 入场用 CSS transition + `starting:`（@starting-style）而不是关键帧：起始态只在
 * 元素首次参与样式计算时生效，天然就是“只在挂载时动画一次”，行内后续追加的文本
 * 不会重播。`motion-safe:` 是 CSS 侧的第二道锁；JS 侧 animate 为 false 时这些类
 * 根本不会被挂上，两层都尊重 prefers-reduced-motion。
 */
const LINE_BASE_CLASSES = "text-body-regular break-words text-text-primary";
const LINE_ENTER_CLASSES = [
  "motion-safe:transition-[opacity,filter,translate]",
  "motion-safe:duration-[420ms]",
  "motion-safe:ease-[cubic-bezier(0.22,0.61,0.36,1)]",
  "motion-safe:starting:opacity-0",
  "motion-safe:starting:blur-[5px]",
  "motion-safe:starting:translate-y-1",
].join(" ");

/**
 * 已落定的行在 Motion 版本里保留 `filter: blur(0px)` 而不是丢掉 filter——Motion 一旦
 * 动画过这个属性就由它接管，外部 style 抢不回来。换成本项目的 CSS 过渡后不需要这层
 * 兼容：`filter: none` 与 blur(5px) 可以正常插值，过渡结束 filter 整体消失，静止时
 * 不再多一个合成层。逐行一个 filter 元素的代价本来就看不见；只有逐词各自带 filter
 * 时才会成为问题。
 *
 * memo 很重要：没有它，回复每到达一个 token 每个段落都会重渲染，已完成的行纯属白算。
 */
const Line = memo(function Line({ text, animate }: { text: string; animate: boolean }) {
  return <p className={cx(LINE_BASE_CLASSES, animate && LINE_ENTER_CLASSES)}>{text}</p>;
});

/**
 * 逐行渲染流式文本，每行只在首次出现时做一次入场。
 *
 * 动画刻意放在“行”而不是“词”上。逐词在实践中更差：一个 token 到达时只是一个片段，
 * 模糊入场在这个片段上播放，随后片段又变成完整单词而没有过渡——看起来像卡顿；而且
 * 流结束时还得把动画 span 换回纯文本，飞行中的元素会一起跳变。
 *
 * 一行挂载一次，之后只增长，所以已经上屏的内容永远不会重播或跳变。文本自身的均匀
 * 节奏来自服务端（`smoothStream` 按稳定节拍放出完整单词）。
 */
export function StreamedLines({ text, className }: StreamedLinesProps) {
  const reduceMotion = usePrefersReducedMotion();
  const lines = useMemo(() => text.split("\n").filter((line) => line.trim() !== ""), [text]);

  return (
    <div className={cx("flex flex-col gap-3", className)}>
      {lines.map((line, index) => (
        // index 在这里是稳定的：行只追加、不重排、不删除。
        <Line key={index} text={line} animate={!reduceMotion} />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- shimmer */

export interface ShimmerTextProps {
  children: string;
  className?: string;
}

/**
 * 仍在进行中的一行：高光扫过文字。
 *
 * 减少动态偏好下退回纯 `text-text-secondary`。`.agent-progress-loading-text` 内部
 * 已经有一条同款 CSS 兜底；这里再做一次 JS 判定，是为了让 DOM 里根本不出现 shimmer
 * 类，而不是依赖媒体查询去覆盖它。
 */
export function ShimmerText({ children, className }: ShimmerTextProps) {
  const reduceMotion = usePrefersReducedMotion();

  if (reduceMotion) {
    return <span className={cx("text-text-secondary", className)}>{children}</span>;
  }

  return (
    <span aria-label={children} className={cx("agent-progress-loading-text", className)}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- ticker */

export interface RevealTickerOptions {
  /** 日志共有多少个单元。 */
  total: number;
  /** 暂停 / 恢复；再次打开从当前进度继续，要重播就换 `key`。 */
  run?: boolean;
  stepInterval?: number;
  startDelay?: number;
  /** 由真实事件驱动；传了它就禁用内部计时器。 */
  revealed?: number;
  /**
   * 逐单元节奏：给定即将揭示的 index，先等多久。提供后覆盖
   * `startDelay` / `stepInterval`，让日志能在真正更耗时的单元上多停留，
   * 而不是按固定节拍齐步走。
   */
  delayFor?: (index: number) => number;
  onComplete?: () => void;
}

/**
 * 每 tick 揭示一个单元，最后一个落位后触发一次 `onComplete`。
 *
 * 计时用单一 setTimeout 而不是每单元一个时长：真实的 Agent 步骤耗时并不相等，
 * 假装相等正是进度 UI 显得假的原因——所以一旦拿到真实事件，就把 `revealed`
 * 传进来自己驱动。
 *
 * 注意：这个 ticker 是“内容到达节拍”，不是装饰动画；减少动态偏好下它照常工作，
 * 因为它决定文本何时出现，而不是文本如何动。
 */
export function useRevealTicker({
  total,
  run = true,
  stepInterval = 850,
  startDelay = 320,
  revealed: controlled,
  delayFor,
  onComplete,
}: RevealTickerOptions): number {
  const isControlled = controlled !== undefined;
  const [ticked, setTicked] = useState(0);
  const revealed = isControlled ? Math.max(0, Math.min(controlled, total)) : ticked;

  useEffect(() => {
    if (isControlled || !run || revealed >= total) return;
    const delay = delayFor ? delayFor(revealed) : revealed === 0 ? startDelay : stepInterval;
    const id = window.setTimeout(() => setTicked((n) => n + 1), delay);
    return () => window.clearTimeout(id);
  }, [isControlled, run, revealed, total, startDelay, stepInterval, delayFor]);

  // 用 ref 而不是把 onComplete 放进上面的依赖来防重入：内联 `onComplete` 闭包每次
  // 渲染都是新函数，作为依赖会让 effect 重跑，从而把完成回调触发两次。
  const firedRef = useRef(false);

  useEffect(() => {
    if (total === 0 || revealed < total) {
      firedRef.current = false;
      return;
    }
    if (firedRef.current) return;
    firedRef.current = true;
    onComplete?.();
  }, [revealed, total, onComplete]);

  return revealed;
}
