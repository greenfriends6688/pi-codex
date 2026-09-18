import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  shouldInviteMemoryRefresh,
  MEMORY_TIDY_STALE_MS,
  MEMORY_INVITE_COOLDOWN_MS,
} = await jiti.import("./memory-refresh.ts");

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

test("记忆文件从未建立时不邀请（由安装引导负责，不算该整理）", () => {
  const d = shouldInviteMemoryRefresh({ state: {}, now: NOW });
  assert.equal(d.invite, false);
  assert.equal(d.reason, "no-tidy-marker");
  assert.equal(d.daysSinceTidied, null);
});

test("3 天内整理过 → 不邀请", () => {
  const d = shouldInviteMemoryRefresh({
    state: {},
    memoryTidiedAt: NOW - 2 * DAY,
    latestSessionAt: NOW - 1000,
    now: NOW,
  });
  assert.equal(d.invite, false);
  assert.equal(d.reason, "recently-tidied");
});

test("超 3 天未整理但之后没有新会话 → 不邀请（没有值得记的新东西）", () => {
  const d = shouldInviteMemoryRefresh({
    state: {},
    memoryTidiedAt: NOW - 10 * DAY,
    latestSessionAt: NOW - 15 * DAY,
    now: NOW,
  });
  assert.equal(d.invite, false);
  assert.equal(d.reason, "no-new-sessions");
});

test("超 3 天未整理且之后有新会话 → 邀请", () => {
  const d = shouldInviteMemoryRefresh({
    state: {},
    memoryTidiedAt: NOW - 10 * DAY,
    latestSessionAt: NOW - 5 * DAY,
    now: NOW,
  });
  assert.equal(d.invite, true);
  assert.equal(d.reason, "stale-with-new-sessions");
  assert.equal(d.daysSinceTidied, 10);
});

test("冷却期内不重复邀请", () => {
  const d = shouldInviteMemoryRefresh({
    state: { lastInviteAt: new Date(NOW - 2 * DAY).toISOString() },
    memoryTidiedAt: NOW - 10 * DAY,
    latestSessionAt: NOW - 5 * DAY,
    now: NOW,
  });
  assert.equal(d.invite, false);
  assert.equal(d.reason, "invite-cooldown");
});

test("冷却期过后再次满足条件则再邀请", () => {
  const d = shouldInviteMemoryRefresh({
    state: { lastInviteAt: new Date(NOW - MEMORY_INVITE_COOLDOWN_MS - 1000).toISOString() },
    memoryTidiedAt: NOW - 10 * DAY,
    latestSessionAt: NOW - 5 * DAY,
    now: NOW,
  });
  assert.equal(d.invite, true);
});

test("state 里记录的 lastTidiedAt 可作 MEMORY.md 缺失时的兜底", () => {
  const d = shouldInviteMemoryRefresh({
    state: { lastTidiedAt: new Date(NOW - 10 * DAY).toISOString() },
    latestSessionAt: NOW - 5 * DAY,
    now: NOW,
  });
  assert.equal(d.invite, true);
  assert.equal(d.daysSinceTidied, 10);
});

test("阈值边界：正好 3 天不算久", () => {
  const d = shouldInviteMemoryRefresh({
    state: {},
    memoryTidiedAt: NOW - MEMORY_TIDY_STALE_MS,
    latestSessionAt: NOW - 1000,
    now: NOW,
  });
  assert.equal(d.invite, false);
});
