"use client";

import { useEffect, useState } from "react";

/**
 * fork:beautifului-02 — 等待态：像素网格 + 等宽计时器。
 *
 * 移植自 beautifului.dev/#loading-state 的 `Drive` 变体（只取这一个；上游的
 * Dots/Orbit/Surfer 是展示页的玩法）。等首个 token、跑 bash、跑工具时，以前只有
 * 一行裸文字，用户看不出"到底在动还是卡住了"；现在是 3×3 网格按 V 形波前逐格
 * 点亮，右边跟一个 tabular-nums 的计时。
 *
 * **计时器的 state 必须留在这一层**：放进 ChatWindow 会让那棵 2600 行的消息树
 * 每秒重渲染 10 次。现在每秒重渲染的只有这 9 个 span。
 *
 * 上游是自跑时序（`useSequence([...])`）的 demo，这里全部由真实状态驱动：
 * 组件挂载即开始计时，卸载即结束。
 */

/**
 * 3×3 网格的相位：`(列 + |行 − 1|) * 90ms`。
 * 每列比前一列晚 90ms（波前向右推进），中间行比上下两行早 90ms（所以推的是个箭头形）。
 * 650ms 的循环比整个波前的总时长（270ms + 一格）还长，屏幕上永远同时有两条波前在跑。
 */
const CHEVRON_DELAYS = Array.from(
  { length: 9 },
  (_, index) => ((index % 3) + Math.abs(Math.floor(index / 3) - 1)) * 90,
);

function PixelGrid() {
  return (
    <span aria-hidden="true" className="fork-pixel-grid">
      {CHEVRON_DELAYS.map((delay, index) => (
        <span key={index} className="fork-pixel" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

/**
 * 从挂载起计时：60 秒以内 `12.4s`，超过后 `1m 03.2s`。
 * 100ms 一跳是上游的刻度；再快没有意义（最末位本来就在抖）。
 */
function useElapsed(): string {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTicks((value) => value + 1), 100);
    return () => clearInterval(timer);
  }, []);
  const total = ticks / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export function AgentPhaseLine({ label }: { label: string | null }) {
  const elapsed = useElapsed();
  if (!label) return null;
  return (
    <div className="fork-phase-line break-words py-2 text-xs text-text-muted" role="status" aria-live="polite">
      <PixelGrid />
      <span className="fork-live-label fork-phase-label" data-live="true">{label}</span>
      <span className="fork-phase-timer">{elapsed}</span>
    </div>
  );
}
