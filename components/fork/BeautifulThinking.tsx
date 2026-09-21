"use client";

import { useMemo } from "react";
import ThinkingState from "@/components/primitives/ThinkingState";

/**
 * 试装：把 BeautifulUI 的**原版** `ThinkingState` 直接接上 pi 的真实数据。
 *
 * 原版组件一行没改（`components/primitives/ThinkingState.tsx`，来自
 * https://www.beautifului.dev/r/thinking-state.json），这里只做数据适配：
 * 它接受 `rows` / `active` / `done` / `icon` 四个覆盖口子，正好够用。
 *
 * 与原版 demo 的差异（都是它自己的设计，不是我们改的）：
 *  - 展开/收起由它内部的 `useSequence(STAGES)` 假时序驱动（800/600/1800…ms），
 *    不跟真实的流式状态走；`variant="Reasoning"` 时每一行是一段推理正文。
 *  - 工作/落定文案由我们喂 `active` / `done`。
 *
 * 回滚：把 MessageView 里那个 `USE_BEAUTIFUL_THINKING` 分支删掉即可
 * （本文件与 `components/primitives/` 可一并删除）。
 */

/** 真实推理文本 → 它要的 rows：按空行切段，空串丢掉。 */
function toRows(text: string): { primary: string }[] {
  return text
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((primary) => ({ primary }));
}

export function BeautifulThinking({
  text,
  working,
  seconds,
}: {
  text: string;
  working: boolean;
  /** 已知的思考耗时（秒）；未知时不显示落定文案里的数字。 */
  seconds?: number;
}) {
  const rows = useMemo(() => toRows(text), [text]);
  return (
    <ThinkingState
      variant="Reasoning"
      rows={rows}
      active="思考"
      done={seconds === undefined ? "已思考" : `思考了 ${seconds} 秒`}
      icon={<span className="text-[14px] leading-none">{working ? "✦" : "✧"}</span>}
    />
  );
}
