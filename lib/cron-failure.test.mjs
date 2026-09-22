import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/*
 * fork:zc-19 — failure classification + backoff.
 *
 * The classification decides whether a failed run gets retried; a wrong
 * "permanent" would drop a recoverable run, a wrong "retryable" would hammer an
 * auth error five times. Both sides are pinned below.
 */

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  CRON_MAX_ATTEMPTS,
  CRON_RETRY_BASE_MS,
  CRON_RETRY_CAP_MS,
  classifyCronFailure,
  nextRetryAtIso,
  retryDelayMs,
  retryPatchFor,
  shouldRetryFailure,
} = await jiti.import("@/lib/cron-failure");

test("transient failures are retryable", () => {
  const cases = [
    new Error("Request timed out"),
    new Error("ETIMEDOUT connecting to api.example.com"),
    new Error("429 Too Many Requests"),
    new Error("fetch failed"),
    new Error("socket hang up"),
    new Error("502 Bad Gateway"),
    new Error("运行超时（120 分钟）"),
  ];
  for (const error of cases) {
    assert.equal(classifyCronFailure(error).kind, "retryable", error.message);
  }
});

test("permanent failures are not retried", () => {
  const cases = [
    new Error("401 Unauthorized"),
    new Error("Invalid API key"),
    new Error("insufficient_quota: you exceeded your current quota"),
    new Error("model not found: gpt-99"),
    new Error("400 invalid request: messages is required"),
    new Error("context length exceeded"),
    new Error("用户拒绝了这次工具调用"),
    new Error("User aborted"),
  ];
  for (const error of cases) {
    assert.equal(classifyCronFailure(error).kind, "permanent", error.message);
  }
});

test("an unclassifiable error is retried rather than silently dropped", () => {
  const info = classifyCronFailure(new Error("kaboom"));
  assert.equal(info.kind, "retryable");
  assert.equal(info.code, "unclassified");
});

test("string and non-error inputs are handled", () => {
  assert.equal(classifyCronFailure("request timeout").kind, "retryable");
  assert.equal(classifyCronFailure(undefined).message, "");
  assert.equal(classifyCronFailure(null).kind, "retryable");
});

test("backoff is 30s · 2^(n-1), capped at 15 minutes", () => {
  assert.equal(CRON_RETRY_BASE_MS, 30_000);
  assert.equal(CRON_RETRY_CAP_MS, 15 * 60_000);
  assert.deepEqual([1, 2, 3, 4, 5].map(retryDelayMs), [30_000, 60_000, 120_000, 240_000, 480_000]);
  assert.equal(retryDelayMs(6), CRON_RETRY_CAP_MS);
  assert.equal(retryDelayMs(99), CRON_RETRY_CAP_MS);
  // Bad input falls back to the base delay instead of NaN.
  assert.equal(retryDelayMs(0), CRON_RETRY_BASE_MS);
});

test("at most 5 attempts: the fifth failure is final", () => {
  assert.equal(CRON_MAX_ATTEMPTS, 5);
  const retryable = classifyCronFailure("timeout");
  const permanent = classifyCronFailure("401 unauthorized");
  assert.equal(shouldRetryFailure(retryable, 1), true);
  assert.equal(shouldRetryFailure(retryable, 4), true);
  assert.equal(shouldRetryFailure(retryable, 5), false);
  assert.equal(shouldRetryFailure(permanent, 1), false);
});

test("retry time is computed from the injected clock", () => {
  const now = new Date("2026-09-21T09:00:00.000Z");
  assert.equal(nextRetryAtIso(now, 1), "2026-09-21T09:00:30.000Z");
  assert.equal(nextRetryAtIso(now, 3), "2026-09-21T09:02:00.000Z");
});

test("retryPatchFor only schedules retries for retryable failures", () => {
  const now = new Date("2026-09-21T09:00:00.000Z");
  assert.deepEqual(retryPatchFor(classifyCronFailure("timeout"), 2, now), {
    retryAt: "2026-09-21T09:01:00.000Z",
    retryAttempt: 2,
  });
  assert.deepEqual(retryPatchFor(classifyCronFailure("timeout"), 5, now), {}, "attempts exhausted");
  assert.deepEqual(retryPatchFor(classifyCronFailure("401 unauthorized"), 1, now), {});
});
