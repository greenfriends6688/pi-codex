/**
 * fork:fix-markdown-stream — 流式文本节流器（纯逻辑，可在 Node 里单测）。
 *
 * 为什么需要它：`components/MarkdownBody.tsx` 的整条管线
 * （`normalizeDisplayMath` + `react-markdown` + rehype 插件组）是**逐字符全量重算**的。
 * 流式回答每来一个 delta 都会重跑一遍，长回答因此越到尾越卡；
 * 而超长消息又会被 `MAX_MARKDOWN_CHARS` 兜底成 `<pre>`，
 * 所以“中等长度反而最慢”这个观感正是全量重解析的特征。
 *
 * 这里的责任只有一个：把**正在流式时**对外暴露的文本限制到 `intervalMs` 更新一次，
 * 同时保证：
 *   - 流式结束后调用方一定会拿到最终完整文本（`flush()`）；
 *   - 不丢中间状态（`push()` 永远记录最新值，而不是排队每一帧）；
 *   - 时钟与定时器可注入，便于确定性测试。
 *
 * 消费方：`hooks/useThrottledText.ts`。
 */

export const DEFAULT_STREAM_THROTTLE_MS = 120;

export interface StreamThrottleOptions {
  /** 流式期间的最小更新间隔，默认 120ms。 */
  intervalMs?: number;
  /** 当前时间来源，默认 `Date.now`（测试注入假时钟）。 */
  now?: () => number;
  /** 定时器实现，默认 `setTimeout`（测试注入可控句柄）。 */
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface StreamThrottle {
  /** 记录最新文本；必要时安排一次刷新。 */
  push(text: string): void;
  /** 取消待执行的刷新并把最新文本立即交给回调。 */
  flush(): void;
  /** 已经交付给回调的文本。 */
  value(): string;
  /** 是否还有待执行的刷新。 */
  pending(): boolean;
  /** 清理定时器，不再回调。 */
  dispose(): void;
}

/**
 * 创建一个“最新值优先”的节流器。
 *
 * 与常见的 debounce 不同：这里**不会**因为持续 push 而无限推迟刷新——
 * 定时器一旦排下就不再重置，因此刷新频率上界是 `intervalMs`。
 */
export function createStreamThrottle(
  onUpdate: (text: string) => void,
  options: StreamThrottleOptions = {},
): StreamThrottle {
  const intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_STREAM_THROTTLE_MS);
  const now = options.now ?? (() => Date.now());
  const setTimeoutFn = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let emitted = "";
  let latest = "";
  let timer: unknown = null;
  let lastFlushAt = 0;
  let disposed = false;

  const run = () => {
    timer = null;
    if (disposed) return;
    lastFlushAt = now();
    if (latest === emitted) return;
    emitted = latest;
    onUpdate(emitted);
  };

  const schedule = () => {
    if (disposed || timer !== null) return;
    const elapsed = now() - lastFlushAt;
    timer = setTimeoutFn(run, Math.max(0, intervalMs - elapsed));
  };

  return {
    push(text: string) {
      if (disposed) return;
      latest = text;
      // 首个值不等待：否则流式开始时会白等一个间隔。
      if (emitted === "" && lastFlushAt === 0 && text !== "") {
        emitted = text;
        lastFlushAt = now();
        onUpdate(text);
        return;
      }
      schedule();
    },
    flush() {
      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
      if (disposed) return;
      if (latest === emitted) return;
      emitted = latest;
      lastFlushAt = now();
      onUpdate(emitted);
    },
    value: () => emitted,
    pending: () => timer !== null,
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
    },
  };
}
