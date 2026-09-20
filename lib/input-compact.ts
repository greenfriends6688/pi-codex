/**
 * fork:pr14-compact — 阅读态输入框塌陷的状态机。
 *
 * 用户向上翻阅会话（离开底部）时，composer 收成一行文本、隐藏工具栏，把视口
 * 让给消息；回到消息底部或聚焦输入框时立刻展开。
 *
 * ## 振荡坑（REF 血泪，必须方向跟踪）
 *
 * 塌陷会让 composer 变矮、消息容器的 `scrollHeight` 随之变小，浏览器为了保住
 * 原来的 `scrollTop` 会把视口**向下夹回底部** —— 这在 `scrollTop` 上表现为一次
 * 负 delta，看起来像「用户向上滚了一下」。如果状态机只看「是否到底」，就会：
 *
 *   塌陷 → 被夹回底部 → 判定「到底了」→ 展开 → 容器变高 → 内容又离开底部
 *        → 再次塌陷 → …… 每个 scroll tick 来回翻转一次。
 *
 * 因此这里把「方向」和「是否真实用户意图」都纳入判定：
 *   - 只有「真实用户意图 + 方向向上 + 离底 > 120px」才允许收起；
 *   - 到底恢复只认方向向下（浏览器夹回底部是向上或 none，绝不会误导展开）；
 *   - `ResizeObserver` 复算一律传 direction = "none"，不产生任何方向；
 *   - focus 一定展开。
 *
 * 纯函数（不碰 DOM），触发逻辑可以直接单测。
 */

/** 离底 ≤ 该像素数即视为「在底部」—— 这是恢复展开的位置。留 8px 容忍亚像素
 *  舍入和 smooth-scroll 差几像素才停住的情况。 */
export const COMPACT_RESTORE_TRIGGER = 8;

/** 用户必须离底超过该像素数才允许塌陷。塌陷本身大约省下一行输入框的高度
 *  （空草稿约 66px），120px 留出了「塌陷后容器变小、浏览器不会再把你夹回
 *  底部」的余量，也给了阅读一点舒适区。 */
export const COMPACT_COLLAPSE_TRIGGER = 120;

/** 视口下边缘离内容末尾还有多少像素。内容短于容器时为负值（永远不塌陷）。 */
export function scrollRemaining(container: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return container.scrollHeight - container.scrollTop - container.clientHeight;
}

export type InputCompactScrollDirection = "up" | "down" | "none";

export type InputCompactAction =
  /** 消息容器的一次 scroll 事件。`remaining` 是离底的剩余距离，`direction`
   *  由 scrollTop delta 求出（塌陷引起的浏览器夹回底部表现为 "up"），
   *  `userIntent` 区分真实用户滚动（wheel / touch / 键盘 / 拖滚动条）与
   *  程序化定位（打开会话锚点、懒加载前插、完成后自动滚动）。 */
  | { kind: "scroll"; remaining: number; direction: InputCompactScrollDirection; userIntent: boolean }
  /** composer 的 textarea 获得焦点 —— 一定展开。 */
  | { kind: "focus" };

/**
 * 下一帧的塌陷状态：
 * - 在底部：只有「正在向下滚」才恢复 —— 塌陷引起的夹回（up / none）绝不能
 *   反向触发展开，否则离开底部就会闪烁；
 * - 离底：只有「真实用户意图 + 向上 + 足够远」才收起；
 * - focus 永远展开。
 */
export function nextInputCompactState(prev: boolean, action: InputCompactAction): boolean {
  switch (action.kind) {
    case "focus":
      return false;
    case "scroll": {
      if (action.remaining <= COMPACT_RESTORE_TRIGGER) {
        return action.direction === "down" ? false : prev;
      }
      return action.userIntent && action.direction === "up" && action.remaining > COMPACT_COLLAPSE_TRIGGER ? true : prev;
    }
  }
}
