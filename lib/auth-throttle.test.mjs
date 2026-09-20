import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  backoffDelayMs,
  getAuthRetryAfterMs,
  recordAuthFailure,
  recordAuthSuccess,
} = await jiti.import("./auth-throttle.ts");

test("backoff doubles from a base delay up to a one-minute cap", () => {
  assert.equal(backoffDelayMs(1), 1_000);
  assert.equal(backoffDelayMs(2), 2_000);
  assert.equal(backoffDelayMs(3), 4_000);
  assert.equal(backoffDelayMs(60), 60_000);
  assert.equal(backoffDelayMs(0), 0);
});

test("failed attempts impose an increasing retry-after", () => {
  const now = 0;
  const state = { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
  assert.equal(recordAuthFailure(now, state), 1_000);
  assert.equal(getAuthRetryAfterMs(now, state), 1_000);
  assert.equal(recordAuthFailure(now + 1, state), 2_000);
  assert.equal(getAuthRetryAfterMs(now + 1, state), 2_000);
});

test("a success resets the counter immediately", () => {
  const now = 0;
  const state = { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
  recordAuthFailure(now, state);
  recordAuthFailure(now + 1, state);
  assert.ok(getAuthRetryAfterMs(now + 1, state) > 0);
  recordAuthSuccess(state);
  assert.equal(getAuthRetryAfterMs(now + 100, state), 0);
});

test("an idle window longer than the max delay forgets the counter", () => {
  const now = 0;
  const state = { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
  recordAuthFailure(now, state);
  assert.equal(getAuthRetryAfterMs(now, state), 1_000);
  // 空闲满 5 分钟（重置窗口）后封禁解除。
  assert.equal(getAuthRetryAfterMs(now + 5 * 60_000, state), 0);
});

test("the reset window stays longer than the maximum delay", async () => {
  const { AUTH_THROTTLE_RESET_AFTER_MS, AUTH_THROTTLE_MAX_DELAY_MS } = await jiti.import("./auth-throttle.ts");
  assert.ok(
    AUTH_THROTTLE_RESET_AFTER_MS > AUTH_THROTTLE_MAX_DELAY_MS,
    "否则「等完一次封禁」会立刻重置退避，攻击者又能重新连打",
  );
});
