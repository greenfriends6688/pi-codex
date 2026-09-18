/**
 * lib/memory-refresh.ts
 *
 * 用途：FIX-11 记忆周检邀请的**纯判定逻辑**（可在 Node 里单测）。
 *
 * 参考 Proma 的 agent-memory-refresh-service：记忆不整理会烂掉，但系统
 * 绝不自动写记忆——只「邀请」用户过一遍。判定规则：
 *   - MEMORY.md（长期记忆，代理 pi-memory 持有）超过 3 天没有动过；
 *   - 且在这之后有新的会话活动（会话文件比上次整理新，说明有新事实可记）；
 *   - 且距上次邀请超过 7 天（冷却，避免每次开会话都烦人）。
 * 满足才邀请，全部为"建议"而非强制，也不自动写任何内容。
 *
 * 纯数据模块：服务端与客户端都可 import，不依赖任何平台 API。
 */

/** 多少天没整理就算"久了"。 */
export const MEMORY_TIDY_STALE_MS = 3 * 24 * 60 * 60 * 1000;
/** 邀请后的冷却期：这段时间内不再重复提醒。 */
export const MEMORY_INVITE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** 落盘的冷却状态（`<agentDir>/memory-refresh.json`）。字段全部可选、容忍缺失。 */
export interface MemoryRefreshState {
  /** 上次向用户发出邀请的时间（ISO）。 */
  lastInviteAt?: string;
  /** 上次用户确认"整理过了"的时间（ISO）。 */
  lastTidiedAt?: string;
}

export interface MemoryRefreshDecision {
  invite: boolean;
  /** 距上次整理的天数（向上取整；从未整理过返回 null）。 */
  daysSinceTidied: number | null;
  /** 判定原因，纯给 UI/测试用。 */
  reason: "stale-with-new-sessions" | "recently-tidied" | "no-new-sessions" | "invite-cooldown" | "never-tidied" | "no-tidy-marker";
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function shouldInviteMemoryRefresh(params: {
  state: MemoryRefreshState;
  /** 最新的会话活动时间（epoch ms）。undefined = 没有会话记录。 */
  latestSessionAt?: number;
  /** MEMORY.md 的 mtime（epoch ms）。undefined = 记忆文件还没建。 */
  memoryTidiedAt?: number;
  now?: number;
}): MemoryRefreshDecision {
  const { state, latestSessionAt, memoryTidiedAt } = params;
  const now = params.now ?? Date.now();

  const tidiedAt = memoryTidiedAt ?? parseTime(state.lastTidiedAt);
  if (tidiedAt == null) {
    // 记忆从未建立：这不是"该整理"，而是"没装/没用过"，由设置页的安装引导负责。
    return { invite: false, daysSinceTidied: null, reason: "no-tidy-marker" };
  }
  const daysSinceTidied = Math.max(0, Math.ceil((now - tidiedAt) / 86_400_000));

  if (now - tidiedAt <= MEMORY_TIDY_STALE_MS) {
    return { invite: false, daysSinceTidied, reason: "recently-tidied" };
  }
  // "有新会话"：最近一次会话活动发生在上次整理之后（有过新内容，才值得翻一遍）。
  if (latestSessionAt == null || latestSessionAt <= tidiedAt) {
    return { invite: false, daysSinceTidied, reason: "no-new-sessions" };
  }
  const lastInvite = parseTime(state.lastInviteAt);
  if (lastInvite != null && now - lastInvite < MEMORY_INVITE_COOLDOWN_MS) {
    return { invite: false, daysSinceTidied, reason: "invite-cooldown" };
  }
  return { invite: true, daysSinceTidied, reason: "stale-with-new-sessions" };
}
