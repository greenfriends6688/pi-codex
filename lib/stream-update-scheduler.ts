type TimerHandle = number | ReturnType<typeof setTimeout>;

export interface StreamUpdateSchedulerOptions {
  /** 流式输出期间 UI 提交的频率上限，默认 30 次/秒。 */
  maxUpdatesPerSecond?: number;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export interface StreamUpdateScheduler<T> {
  /** 替换任何已排队的值；最终只会提交最近一次的完整快照。 */
  enqueue(value: T): void;
  /** 立即提交已排队快照，忽略帧率上限（同步提交）。 */
  flush(): void;
  /** 丢弃已排队快照并取消所有已安排的调度。 */
  reset(): void;
  /** 永久停止该调度器。 */
  destroy(): void;
}

const DEFAULT_MAX_UPDATES_PER_SECOND = 30;

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * fork:stream-update-scheduler — 把追加型流式快照合并成「每动画帧最多一次」
 * 的 React 更新，并带显式 FPS 上限。
 *
 * 三个必须保留的设计点（都是血泪）：
 *
 * 1. **保留完整最新快照，而不是重建 delta。**
 *    每次 `enqueue` 覆盖上一个排队值，最终提交的是调用方给的完整快照。
 *    这样 tool-call / thinking-block 的中间变更不会因为只攒文本增量而丢。
 *
 * 2. **真正 setState 的提交走 `queueMicrotask`。**
 *    直接在 rAF / setTimeout 回调里 dispatch，会在大批量流式会话里嵌进
 *    React 的并发渲染流程，触发 "Maximum update depth exceeded"。
 *
 * 3. **帧 + 定时器混合限速。**
 *    帧率超过上限时不丢帧，而是排一个 `setTimeout` 补齐剩余间隔；
 *    没有 rAF 的环境（或测试注入）则完全走定时器。
 */
export function createStreamUpdateScheduler<T>(
  commit: (value: T) => void,
  options: StreamUpdateSchedulerOptions = {},
): StreamUpdateScheduler<T> {
  const maxUpdatesPerSecond = Math.max(1, options.maxUpdatesPerSecond ?? DEFAULT_MAX_UPDATES_PER_SECOND);
  const minIntervalMs = 1000 / maxUpdatesPerSecond;
  const now = options.now ?? defaultNow;
  const requestFrame = options.requestFrame
    ?? (typeof requestAnimationFrame === "function" ? requestAnimationFrame : undefined);
  const cancelFrame = options.cancelFrame
    ?? (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : undefined);
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;

  let destroyed = false;
  let pending = false;
  let pendingValue: T | undefined;
  let frameHandle: number | null = null;
  let timerHandle: TimerHandle | null = null;
  let lastCommitAt: number | null = null;

  const cancelScheduledWork = () => {
    if (frameHandle !== null) {
      cancelFrame?.(frameHandle);
      frameHandle = null;
    }
    if (timerHandle !== null) {
      clearTimer(timerHandle);
      timerHandle = null;
    }
  };

  const commitPending = (timestamp: number, deferToMicrotask: boolean) => {
    if (!pending || destroyed) return;
    const value = pendingValue as T;
    pending = false;
    pendingValue = undefined;
    lastCommitAt = timestamp;
    const doCommit = () => {
      if (!destroyed) commit(value);
    };
    if (deferToMicrotask && typeof queueMicrotask === "function") {
      // 血泪点 2：不要在 rAF/setTimeout 回调里直接 setState —— 那会嵌进
      // React 的并发渲染流程，在大型流式会话里触发 "Maximum update depth exceeded"。
      queueMicrotask(doCommit);
    } else {
      doCommit();
    }
  };

  const scheduleFrame = () => {
    if (destroyed || !pending || frameHandle !== null || timerHandle !== null) return;
    if (!requestFrame) {
      const elapsed = lastCommitAt === null ? minIntervalMs : now() - lastCommitAt;
      timerHandle = setTimer(() => {
        timerHandle = null;
        commitPending(now(), true);
        scheduleFrame();
      }, Math.max(0, minIntervalMs - elapsed));
      return;
    }
    frameHandle = requestFrame((timestamp) => {
      frameHandle = null;
      if (destroyed || !pending) return;

      const elapsed = lastCommitAt === null ? minIntervalMs : timestamp - lastCommitAt;
      if (elapsed < minIntervalMs) {
        // 血泪点 3：帧来得太早（超过帧率上限）时不丢帧，用定时器补齐剩余间隔。
        timerHandle = setTimer(() => {
          timerHandle = null;
          scheduleFrame();
        }, minIntervalMs - elapsed);
        return;
      }

      commitPending(timestamp, true);
      scheduleFrame();
    });
  };

  return {
    enqueue(value) {
      if (destroyed) return;
      pendingValue = value;
      pending = true;
      scheduleFrame();
    },
    flush() {
      if (destroyed || !pending) return;
      cancelScheduledWork();
      commitPending(now(), false);
      scheduleFrame();
    },
    reset() {
      cancelScheduledWork();
      pending = false;
      pendingValue = undefined;
      lastCommitAt = null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelScheduledWork();
      pending = false;
      pendingValue = undefined;
    },
  };
}
