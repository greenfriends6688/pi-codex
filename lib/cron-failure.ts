/**
 * fork:zc-19 — cron failure classification and retry backoff (pure).
 *
 * WHY: `cron-runner.ts` used to treat every failure the same way: record it,
 * count it, and wait for the next scheduled occurrence. A flaky network call
 * then burned an entire day of the schedule (and could auto-pause the task)
 * even though a retry 30 seconds later would have worked. This module is the
 * missing policy layer:
 *
 *   retryable  → 30s · 2^(n-1), capped at 15 min, at most 5 attempts
 *   permanent  → no retry; the failure counts immediately
 *
 * Classification is intentionally conservative about *permanent*: a rate limit,
 * timeout, or 5xx is retryable, while auth/permission/quota/invalid-input
 * failures are not (retrying those just multiplies the error). Everything the
 * classifier cannot place is retried — a scheduled run that silently never
 * happens is worse than one extra attempt.
 *
 * The constants mirror the reference's `automationRepo.ts:31-41` because they
 * are good defaults, not because we copied their ledger: no SQLite, no separate
 * scheduler process, no 200-unit interval cap.
 */

export const CRON_RETRY_BASE_MS = 30_000;
export const CRON_RETRY_CAP_MS = 15 * 60_000;
export const CRON_MAX_ATTEMPTS = 5;

export type CronFailureKind = "retryable" | "permanent";

export interface CronFailureInfo {
  kind: CronFailureKind;
  /** Short machine-ish code for logs/tests (`timeout`, `rate-limit`, `auth`, …). */
  code: string;
  message: string;
}

interface FailureRule {
  id: string;
  kind: CronFailureKind;
  pattern: RegExp;
}

/**
 * Order matters: the first matching rule wins. Permanent rules are listed
 * first so an error message that mentions both (e.g. "429 … but also invalid
 * API key") does not get retried forever.
 */
const FAILURE_RULES: readonly FailureRule[] = [
  // ---- permanent (retrying cannot help) ----
  { id: "auth", kind: "permanent", pattern: /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid api key|authentication|api key|credential|认证|未授权|密钥|鉴权/i },
  { id: "quota", kind: "permanent", pattern: /\b(402|quota|insufficient[_ -]?quota|billing|payment|credit)\b|余额|配额|欠费|额度/i },
  { id: "model-missing", kind: "permanent", pattern: /no such model|unknown model|model not found|invalid model|模型.*(不存在|无效)/i },
  { id: "bad-request", kind: "permanent", pattern: /\b400\b|invalid request|validation (error|failed)|bad request|参数.*(无效|错误)|请求.*无效/i },
  { id: "context-overflow", kind: "permanent", pattern: /context (length|window)|too many tokens|maximum context|上下文.*(超|满)/i },
  { id: "approval-denied", kind: "permanent", pattern: /approval|permission denied|审批|拒绝/i },
  { id: "cancelled", kind: "permanent", pattern: /\babort(ed)?\b|\bcancel(l)?ed\b|user stop|已停止|已取消|中止/i },
  // ---- retryable (transient) ----
  { id: "timeout", kind: "retryable", pattern: /timeout|timed out|etimedout|deadline|超时/i },
  { id: "rate-limit", kind: "retryable", pattern: /\b429\b|rate ?limit|too many requests|overloaded|capacity|限流|频率/i },
  { id: "network", kind: "retryable", pattern: /econnreset|econnrefused|epipe|ehostunreach|enetunreach|eai_again|socket hang up|fetch failed|network|连接.*(重置|中断|失败)|网络/i },
  { id: "server-error", kind: "retryable", pattern: /\b5\d\d\b|internal server error|bad gateway|service unavailable|gateway timeout|server error|服务.*(不可用|错误)/i },
];

/** Classify an error (Error, string, or anything else). Unknown → retryable. */
export function classifyCronFailure(error: unknown): CronFailureInfo {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error ?? "");
  for (const rule of FAILURE_RULES) {
    if (rule.pattern.test(message)) return { kind: rule.kind, code: rule.id, message };
  }
  return { kind: "retryable", code: "unclassified", message };
}

/** `min(30s · 2^(attempt-1), 15min)` for the given 1-based attempt. */
export function retryDelayMs(attempt: number): number {
  const step = Math.max(0, Math.floor(attempt) - 1);
  return Math.min(CRON_RETRY_BASE_MS * 2 ** step, CRON_RETRY_CAP_MS);
}

/** ISO timestamp of the next retry after `now` (1-based attempt). */
export function nextRetryAtIso(now: Date, attempt: number): string {
  return new Date(now.getTime() + retryDelayMs(attempt)).toISOString();
}

/**
 * Should this failure be retried? `attemptsMade` counts attempts already made
 * (including the one that just failed): 5 attempts max, so the fifth failure is
 * final.
 */
export function shouldRetryFailure(info: CronFailureInfo, attemptsMade: number): boolean {
  if (info.kind !== "retryable") return false;
  return attemptsMade < CRON_MAX_ATTEMPTS;
}

/** Retry state to write back onto a task (all fields optional in the store). */
export function retryPatchFor(info: CronFailureInfo, attemptsMade: number, now: Date): {
  retryAt?: string;
  retryAttempt?: number;
} {
  if (!shouldRetryFailure(info, attemptsMade)) return {};
  return { retryAt: nextRetryAtIso(now, attemptsMade), retryAttempt: attemptsMade };
}
