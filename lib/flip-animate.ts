/**
 * fork:zm-06 — 无依赖 FLIP 列表重排。
 *
 * WHY：侧栏项目行在拖拽排序、分组折叠/展开时会被 React 直接重排到新位置，视觉上是
 * 「瞬移」。FLIP（First-Last-Invert-Play）在变更前记下每个元素的 `getBoundingClientRect`，
 * 变更后计算位移，用 WAAPI 从旧位置飞回新位置。纯计算与 DOM 应用分开：
 *
 * - 纯函数（`diffFlip` / `flipKeyframes`）接收最小的矩形形状，不碰 DOM，可以在 node
 *   里直接单测；
 * - `animateFlip` 才接触元素，并在 reduced-motion / 偏好未知（SSR、jsdom）时整体跳过。
 *
 * 纪律：只动 `transform`（位移）与例外允许的 `height`（仅在同元素高度真的变了时），
 * 缓动与时长与 ZM 批次其余动效一致；先 `cancel` 旧动画，防止连点拖拽时叠加。
 */

/** FLIP 只需要矩形的位置与尺寸；结构化类型让测试传字面量即可。 */
export interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 变更前的快照：data-key → 矩形。 */
export type FlipSnapshot = ReadonlyMap<string, ElementRect>;

/** 动画时长与缓动（§8 全局纪律 3：WAAPI，时长 150ms）。 */
export const FLIP_DURATION_MS = 150;
export const FLIP_EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** 高度差小于该阈值就不做高度动画（亚像素抖动不值得动）。 */
export const FLIP_HEIGHT_DELTA_THRESHOLD = 0.5;

export interface FlipDelta {
  key: string;
  /** 旧位置 → 新位置的位移（正向 = 向右/向下）。 */
  dx: number;
  dy: number;
  previousHeight: number;
  nextHeight: number;
  /** 高度差 ≥ 0.5px 时才动画 height。 */
  animateHeight: boolean;
}

export interface FlipDiffOptions {
  /**
   * 纯函数默认按「允许动画」计算；环境判定（`motionAllowed`）由 `animateFlip` 负责，
   * 这样单测可以直接验证 diff 的几何结果，而运行时该跳过的会在应用层跳过。
   */
  reducedMotion?: boolean;
  heightThreshold?: number;
}

/**
 * 比较前后两次快照，产出每个仍在两边的 key 的动画参数。
 *
 * - 只在旧快照里的 key（元素被移除）不产出；
 * - 只在旧快照里的 key（新挂载）没有起点，不产出（不能从 (0,0) 飞出来）；
 * - 位移与高度都没变的 key 不产出，避免无意义的动画对象。
 */
export function diffFlip(
  previous: FlipSnapshot,
  next: FlipSnapshot,
  options: FlipDiffOptions = {},
): FlipDelta[] {
  if (options.reducedMotion) return [];
  const threshold = options.heightThreshold ?? FLIP_HEIGHT_DELTA_THRESHOLD;
  const deltas: FlipDelta[] = [];
  next.forEach((nextRect, key) => {
    const previousRect = previous.get(key);
    if (!previousRect) return;
    const dx = previousRect.left - nextRect.left;
    const dy = previousRect.top - nextRect.top;
    const heightDelta = nextRect.height - previousRect.height;
    const animateHeight = Math.abs(heightDelta) >= threshold;
    if (dx === 0 && dy === 0 && !animateHeight) return;
    deltas.push({
      key,
      dx,
      dy,
      previousHeight: previousRect.height,
      nextHeight: nextRect.height,
      animateHeight,
    });
  });
  return deltas;
}

/**
 * 单个元素的 WAAPI 关键帧。高度键只在 `animateHeight` 时出现——低于阈值时如果仍写
 * `height`，浏览器会把元素从「当前高度」显式动画到同一高度，白白产生一次布局动画。
 */
export function flipKeyframes(delta: FlipDelta): Keyframe[] {
  const from: Keyframe = { transform: `translate(${delta.dx}px, ${delta.dy}px)` };
  const to: Keyframe = { transform: "none" };
  if (delta.animateHeight) {
    from.height = `${delta.previousHeight}px`;
    to.height = `${delta.nextHeight}px`;
  }
  return [from, to];
}

/**
 * 当前环境是否允许动画：**只有显式的 no-preference 才返回 true**。
 * SSR / jsdom / 没有 `matchMedia` 的环境一律视为「偏好未知」→ 不动画（静态终态），
 * 这样单测不会断言到动画中间态。
 */
export function motionAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches === false;
  } catch {
    return false;
  }
}

export interface AnimateFlipOptions {
  duration?: number;
  easing?: string;
  /** 显式指定；缺省时按 `motionAllowed()` 判定（未知环境 = 不动画）。 */
  reducedMotion?: boolean;
}

/**
 * 应用层：对每个 delta 找到元素，先取消其正在跑的动画再播放 FLIP。
 * 返回创建的动画，调用方可借此判断「是否仍在飞行中」。
 */
export function animateFlip(
  deltas: readonly FlipDelta[],
  getElement: (key: string) => Element | null,
  options: AnimateFlipOptions = {},
): Animation[] {
  const reducedMotion = options.reducedMotion ?? !motionAllowed();
  if (reducedMotion) return [];
  const animations: Animation[] = [];
  for (const delta of deltas) {
    const element = getElement(delta.key);
    if (!element || typeof element.animate !== "function") continue;
    if (typeof element.getAnimations === "function") {
      element.getAnimations().forEach((animation) => animation.cancel());
    }
    animations.push(element.animate(flipKeyframes(delta), {
      duration: options.duration ?? FLIP_DURATION_MS,
      easing: options.easing ?? FLIP_EASING,
    }));
  }
  return animations;
}
