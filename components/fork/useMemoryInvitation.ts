"use client";

import { useEffect, useRef } from "react";

/**
 * components/fork/useMemoryInvitation.ts
 *
 * 用途：FIX-11 记忆周检邀请的前台触发器。
 *
 * 前台会话挂载后懒检查一次 `/api/memory/refresh`；服务端判定"该邀请"
 * （记忆 >3 天没整理、之后有新会话、且过了 7 天冷却）时弹一条 warning
 * 通知并把邀请时间记录下来（启动下一轮冷却）。
 *
 * 刻意的边界（与 lib/memory-refresh.ts 的原则一致）：
 *   - **绝不自动写记忆**，邀请文案只把人带到 设置 → 记忆；
 *   - 每个应用生命周期最多检查一次（模块级标记），切会话不重复弹
 *     （notice-dedupe 也会兜底）；
 *   - 运行中/自动化会话不触发（调用方传 sessionBusy）。
 */

export function useMemoryInvitation(options: {
  /** false = 不检查（会话运行中 / 还没有会话）。 */
  enabled: boolean;
  /** 收到邀请时由调用方发通知（拿到"距上次整理天数"，可能为 null = 从未记录）。 */
  onInvite: (daysSinceTidied: number | null) => void;
}): void {
  const { enabled, onInvite } = options;
  // onInvite 多为内联函数，用 ref 存避免 effect 反复重跑。
  const onInviteRef = useRef(onInvite);
  onInviteRef.current = onInvite;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/memory/refresh", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { invite?: boolean; daysSinceTidied?: number | null };
        if (!data.invite || cancelled) return;
        onInviteRef.current(typeof data.daysSinceTidied === "number" ? data.daysSinceTidied : null);
        // 发出邀请即启动冷却：7 天内同一台机器不重复弹。
        void fetch("/api/memory/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "invited" }),
        }).catch(() => {});
      } catch {
        // 网络失败就当下次会话再问，不打扰用户。
      }
    })();
    return () => { cancelled = true; };
    // 只在 enabled 翻转时检查一次；addNotice 由调用方保证稳定。
  }, [enabled]);
}
