/**
 * fork:zm-03 — 滚动跟随状态机 + prepend 锚定 + 渐隐遮罩判定（纯函数）。
 *
 * 为什么独立成文件：`lib/chat-scroll-position.ts` / `lib/chat-lazy-load.ts` 只做
 * 「位置采样 / 距离补偿」，而这次要修的是**滚动权的归属**：`following` 只能由
 * 用户滚动输入改变，程序化滚动（流式贴底、窗口 resize、加载更早）不得抢走用户位置。
 * 参考 ZCode `v4/timelineScrollAnchor.ts` 的 `resolveFollowingAfterScroll` + 48px epsilon：
 * 每个来源显式标注，非用户来源一律原样返回。
 *
 * 这里只放纯逻辑；DOM 读写留在 ChatWindow / ScrollFadeViewport 里，方便单测覆盖
 * 「程序化滚动 ×100 不改 following」「用户上滑立即失效」「prepend 后像素不动」。
 */

/** 离底判定容差：小于该距离视为「在底部」（覆盖亚像素滚动与最后一行 padding）。 */
export const BOTTOM_ANCHOR_EPSILON_PX = 48;
/** 遮罩边界容差：1px 内的滚动位置不算「有内容被藏住」。 */
export const SCROLL_MASK_EPSILON_PX = 1;
/** 程序化「滚到底」判定容差。 */
export const PROGRAMMATIC_TAIL_EPSILON_PX = 1;

export interface ScrollMetrics {
  scrollTop: number;
  /** 可视高度（clientHeight）。 */
  viewportHeight: number;
  /** 内容总高度（scrollHeight）。 */
  contentHeight: number;
}

/** 滚动事件的来源：只有 `user` 有资格改变跟随态。 */
export type ScrollEventSource = "user" | "programmatic" | "layout";

/** 用户滚动意图（wheel / touch / 键盘统一成同一枚举）。 */
export type ScrollIntent = "none" | "awayFromBottom" | "towardBottom" | "unknown";

export function distanceToBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.contentHeight - metrics.viewportHeight - metrics.scrollTop);
}

export function isAtBottom(
  metrics: ScrollMetrics,
  epsilonPx: number = BOTTOM_ANCHOR_EPSILON_PX,
): boolean {
  return distanceToBottom(metrics) <= epsilonPx;
}

/** 首次绑定 / 会话切换：重置为跟随（打开会话定位到最新消息）。 */
export function initialFollowing(): boolean {
  return true;
}

/**
 * scroll 事件后的跟随态。规则：**只有用户来源**按最终落点裁决 —— 落点在底部 ⇔ 跟随。
 * 程序化/布局来源原样保持，这样流式贴底、resize、prepend 都不会改变用户意图。
 */
export function resolveFollowingAfterScroll(input: {
  following: boolean;
  metrics: ScrollMetrics;
  source: ScrollEventSource;
  epsilonPx?: number;
}): boolean {
  if (input.source !== "user") return input.following;
  return isAtBottom(input.metrics, input.epsilonPx);
}

/**
 * 用户输入到达时的即时裁决（不等 scroll 事件）。
 *
 * 上滑在任何位置都立即解除跟随（哪怕只滑了 10px、仍在 48px 容差内）；
 * 下滑只有落到容差内才恢复跟随。`none`/`unknown` 保持原值。
 */
export function nextFollowingAfterIntent(input: {
  following: boolean;
  intent: ScrollIntent;
  metrics: ScrollMetrics;
  epsilonPx?: number;
}): boolean {
  if (input.intent === "awayFromBottom") return false;
  if (input.intent === "towardBottom") return isAtBottom(input.metrics, input.epsilonPx);
  return input.following;
}

/** wheel 的 deltaY 与 scrollTop 同向：负值阅读更早内容，正值靠近底部。 */
export function wheelScrollIntent(deltaY: number): ScrollIntent {
  if (deltaY < 0) return "awayFromBottom";
  if (deltaY > 0) return "towardBottom";
  return "none";
}

/** touch 手指位移与 scrollTop 反向：手指下移表示阅读更早内容。 */
export function touchScrollIntent(previousClientY: number, nextClientY: number): ScrollIntent {
  if (nextClientY > previousClientY) return "awayFromBottom";
  if (nextClientY < previousClientY) return "towardBottom";
  return "none";
}

/** 键盘滚动意图；输入控件内的光标按键不属于消息列滚动。 */
export function keyboardScrollIntent(input: {
  key: string;
  shiftKey: boolean;
  editableTarget: boolean;
}): ScrollIntent {
  if (input.editableTarget) return "none";
  if (input.key === "ArrowUp" || input.key === "PageUp" || input.key === "Home") {
    return "awayFromBottom";
  }
  if (input.key === "ArrowDown" || input.key === "PageDown" || input.key === "End") {
    return "towardBottom";
  }
  if (input.key === " ") {
    return input.shiftKey ? "awayFromBottom" : "towardBottom";
  }
  return "none";
}

/**
 * 程序化「滚到底」的否决权。
 *
 * 用户已经上滑解除跟随后，hook 里的流式贴底仍会调用
 * `container.scrollTo({ top: container.scrollHeight })`。这里把「请求落点 ≥ 内容高度」
 * 认成贴底请求并在不跟随时驳回；其它程序化滚动（prepend 锚定、跳到某条消息）一律放行。
 * 有意不按 `scrollHeight - clientHeight` 判定：`scrollUserMsgToTop` 会精确落到
 * 最大滚动位置，那是一次显式导航，不该被拦。
 */
export function shouldAllowProgrammaticScroll(input: {
  requestedTop: number;
  contentHeight: number;
  following: boolean;
  epsilonPx?: number;
}): boolean {
  if (input.following) return true;
  if (!Number.isFinite(input.requestedTop)) return true;
  return input.requestedTop < input.contentHeight - (input.epsilonPx ?? PROGRAMMATIC_TAIL_EPSILON_PX);
}

// ---------------------------------------------------------------------------
// 渐隐遮罩（ScrollFadeViewport）
// ---------------------------------------------------------------------------

export type ScrollMaskState = "none" | "top" | "bottom" | "both";

/**
 * 哪一端的遮罩该显示：内容不足一屏 → 都不显示；在顶 → 只显示底部；在底 → 只显示顶部。
 * 「两端都到底」（内容刚好一屏）返回 `none`。
 */
export function computeScrollMaskState(input: {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  epsilonPx?: number;
}): ScrollMaskState {
  const epsilon = input.epsilonPx ?? SCROLL_MASK_EPSILON_PX;
  const maxScrollTop = input.contentHeight - input.viewportHeight;
  if (maxScrollTop <= epsilon) return "none";
  const hasHiddenTop = input.scrollTop > epsilon;
  const hasHiddenBottom = input.scrollTop < maxScrollTop - epsilon;
  if (hasHiddenTop && hasHiddenBottom) return "both";
  return hasHiddenTop ? "top" : "bottom";
}

/**
 * 遮罩的 CSS 值。`mask-image` 作用在滚动容器自身上，不会随内容滚动，
 * 所以内容滚到边缘时自然淡出；`undefined` 表示完全不写这个属性。
 */
export function scrollMaskImage(state: ScrollMaskState, sizePx = 24): string | undefined {
  const size = Math.max(0, sizePx);
  switch (state) {
    case "top":
      return `linear-gradient(to bottom, transparent 0, black ${size}px, black 100%)`;
    case "bottom":
      return `linear-gradient(to bottom, black 0, black calc(100% - ${size}px), transparent 100%)`;
    case "both":
      return `linear-gradient(to bottom, transparent 0, black ${size}px, black calc(100% - ${size}px), transparent 100%)`;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// prepend（加载更早）锚定
// ---------------------------------------------------------------------------

export interface ScrollAnchorSample {
  /** 锚点消息的转录条目 id。 */
  entryId: string;
  /** 采样时锚点相对视口顶部的偏移（可为负：锚点顶部在视口上方）。 */
  viewportOffsetPx: number;
}

export function captureScrollAnchor(input: {
  entryId: string;
  elementViewportTop: number;
  viewportTop: number;
}): ScrollAnchorSample {
  return {
    entryId: input.entryId,
    viewportOffsetPx: input.elementViewportTop - input.viewportTop,
  };
}

/**
 * prepend 后把锚点放回原视口偏移所需的 scrollTop。
 *
 * `elementViewportTop` / `viewportTop` / `scrollTop` 都是**插入后**的实时读数：
 *   target = 锚点在内容里的绝对位置 - 采样时的视口偏移
 * 这样无论前面插入多少内容、中间有没有被其它逻辑改过 scrollTop，锚点都保持像素不动
 * （ZCode `prependVirtualAnchorAdjustment` 同一算法）。
 */
export function resolvePrependRestoreScrollTop(
  anchor: ScrollAnchorSample,
  next: { elementViewportTop: number; viewportTop: number; scrollTop: number },
): number | null {
  const values = [anchor.viewportOffsetPx, next.elementViewportTop, next.viewportTop, next.scrollTop];
  if (!values.every(Number.isFinite)) return null;
  const anchorContentTop = next.elementViewportTop - next.viewportTop + next.scrollTop;
  return Math.max(0, anchorContentTop - anchor.viewportOffsetPx);
}

/** 前插导致的内容总高度差（正数 = 内容变高）。 */
export function prependHeightDelta(previousContentHeight: number, nextContentHeight: number): number {
  if (!Number.isFinite(previousContentHeight) || !Number.isFinite(nextContentHeight)) return 0;
  return Math.max(0, nextContentHeight - previousContentHeight);
}

/** 距顶小于该距离视为「到顶」，自动拉取更早一窗。 */
export const LOAD_OLDER_TRIGGER_PX = 64;

/** scroll 事件是否应触发加载更早（到顶 + 可拉 + 非在途）。 */
export function shouldTriggerLoadOlder(input: {
  scrollTop: number;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  triggerPx?: number;
}): boolean {
  return input.canLoadOlder
    && !input.loadingOlder
    && input.scrollTop <= (input.triggerPx ?? LOAD_OLDER_TRIGGER_PX);
}
