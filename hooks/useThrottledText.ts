"use client";

import { useEffect, useMemo, useState } from "react";
import { createStreamThrottle, DEFAULT_STREAM_THROTTLE_MS } from "@/lib/stream-throttle";

/**
 * fork:fix-markdown-stream — 流式文本节流 hook。
 *
 * 用于 `MarkdownBody`：流式期间把送进 markdown 管线的文本限制到
 * `intervalMs` 更新一次（默认 120ms），流式结束后立刻交付完整文本。
 *
 * 之所以把纯逻辑放在 `lib/stream-throttle.ts`，是因为 hook 本身难以确定性测试，
 * 而节流语义（最新值优先 / 频率上界 / 最终一定完整）恰恰是最容易写错的部分。
 */
export function useThrottledText(
  text: string,
  options: { active: boolean; intervalMs?: number },
): string {
  const { active, intervalMs = DEFAULT_STREAM_THROTTLE_MS } = options;
  const [visible, setVisible] = useState(text);
  const throttle = useMemo(() => createStreamThrottle(setVisible, { intervalMs }), [intervalMs]);

  useEffect(() => {
    if (active) {
      throttle.push(text);
      return;
    }
    // 流式结束（或本来就不是流式）：取消待执行刷新并把完整文本交出去。
    throttle.push(text);
    throttle.flush();
  }, [active, text, throttle]);

  useEffect(() => () => throttle.dispose(), [throttle]);

  // 非流式时直接返回入参，避免 effect 造成的“最后一帧滞后”。
  return active ? visible : text;
}
