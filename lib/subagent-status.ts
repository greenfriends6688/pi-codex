import type { SubagentSessionStatus } from "./types";

/**
 * fork:proma-06-delegation — 子会话的**有效状态**。
 *
 * 会话文件里最后一条 `pi-web:subagent-status` 记的是「上次写下的状态」，不等于「现在在跑」：
 * 进程重启、崩溃、被 OOM 杀掉之后，它仍然是 `running`（或 `queued`）。直接照它显示就会
 * 出现「假装还在跑」的假状态 —— 用户会等一个永远不会来的结果。所以展示层统一走这里。
 *
 * 规则：
 * - 真的在跑（在 `/api/agent/running` 的集合里）→ `running`；
 * - 不在跑，但持久化状态是「活的」（starting / queued / running）→ `interrupted`
 *   （注意不是 `completed`：那次委派并没有产出结果）；
 * - 其余照持久化状态；完全没有状态信息 → `completed`（历史会话的兜底）。
 */
const LIVE_STATUSES: readonly string[] = ["starting", "queued", "running"];

export function effectiveSubagentStatus(
  persisted: SubagentSessionStatus | string | null | undefined,
  options: { running: boolean },
): SubagentSessionStatus {
  if (options.running) return "running";
  if (persisted && LIVE_STATUSES.includes(persisted)) return "interrupted";
  return (persisted as SubagentSessionStatus | undefined) ?? "completed";
}

/** 状态文案的 i18n key：面板与侧栏共用一处，避免两套文案漂移。 */
export function subagentStatusLabelKey(status: SubagentSessionStatus): string {
  return `agentSwitcher.status.${status}`;
}

/** 这次委派是否「没跑完就没了」（重启/崩溃留下的活状态）。 */
export function isInterruptedSubagent(
  persisted: SubagentSessionStatus | string | null | undefined,
  options: { running: boolean },
): boolean {
  return effectiveSubagentStatus(persisted, options) === "interrupted";
}
