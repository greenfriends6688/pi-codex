/**
 * lib/time-groups.test.mjs 对应的被测模块见 ./time-groups.ts。
 * 中文注释：钉住“本地日历日”分桶、DST 23/25 小时日的 Math.round 边界、
 * 未来时间戳落入 today，以及分组头摊平后的虚拟槽位口径。
 */
import assert from "node:assert/strict";
import test from "node:test";

// 固定时区才能确定性地复现 DST：美东 2026-03-08（23h 日历日）与
// 2026-11-01（25h 日历日）。POSIX 上运行时设置 TZ 有效；若运行环境
// 不生效（如 Windows），下面的 DST 用例会自动跳过。
process.env.TZ = "America/New_York";

const { bucketOf, groupByTimeBucket, TIME_BUCKET_ORDER } = await import("./time-groups.ts");

/**
 * 构造 reference 前/后 `days` 个本地日历日的 ISO 时间戳。
 * 用本地日期分量构造，测试与机器时区/DST 无关（除非显式断言 DST）。
 */
function atDayOffset(reference, days, hour = 12) {
  const d = new Date(reference);
  const shifted = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour, 0, 0, 0);
  return shifted.toISOString();
}

const now = new Date(2026, 5, 15, 18, 30, 0, 0); // 本地 2026-06-15

test("bucketOf buckets by local calendar day", () => {
  assert.equal(bucketOf(atDayOffset(now, 0), now), "today");
  assert.equal(bucketOf(atDayOffset(now, -1), now), "yesterday");
  assert.equal(bucketOf(atDayOffset(now, -3), now), "week");
  assert.equal(bucketOf(atDayOffset(now, -15), now), "month");
  assert.equal(bucketOf(atDayOffset(now, -60), now), "earlier");
});

test("bucketOf boundary days are inclusive", () => {
  assert.equal(bucketOf(atDayOffset(now, -7), now), "week");
  assert.equal(bucketOf(atDayOffset(now, -8), now), "month");
  assert.equal(bucketOf(atDayOffset(now, -30), now), "month");
  assert.equal(bucketOf(atDayOffset(now, -31), now), "earlier");
});

test("bucketOf ignores the time-of-day portion (a session at 23:59 yesterday still buckets as yesterday)", () => {
  assert.equal(bucketOf(atDayOffset(now, -1, 23), now), "yesterday");
  assert.equal(bucketOf(atDayOffset(now, 0, 0), now), "today");
});

test("bucketOf tolerates future timestamps and unparseable input", () => {
  assert.equal(bucketOf(atDayOffset(now, 1), now), "today");
  assert.equal(bucketOf("not-a-date", now), "earlier");
  assert.equal(bucketOf("", now), "earlier");
});

test("TIME_BUCKET_ORDER is pinned-first, oldest last", () => {
  assert.deepEqual([...TIME_BUCKET_ORDER], ["pinned", "today", "yesterday", "week", "month", "earlier"]);
});

const tzApplied = new Date(2026, 2, 9, 12).getTimezoneOffset() === 240; // EDT = UTC-4

test("bucketOf survives DST days (23h/25h) because it rounds the calendar-day diff", { skip: !tzApplied }, () => {
  // 2026-03-08 是美东夏令时开始日：那天只有 23 小时。
  const springNow = new Date(2026, 2, 9, 12, 0, 0, 0);
  assert.equal((new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime()) / 3600000, 23);
  // floor(23/24h) = 0 会错误落进 today；Math.round 才是正确的 yesterday。
  assert.equal(bucketOf(atDayOffset(springNow, -1), springNow), "yesterday");
  // 23h 日之后，7/30 天边界同样要靠 round 兜住。
  assert.equal(bucketOf(atDayOffset(springNow, -7), springNow), "week");
  assert.equal(bucketOf(atDayOffset(springNow, -31), springNow), "earlier");

  // 2026-11-01 是美东夏令时结束日：那天有 25 小时，仍应归入前一日。
  const fallNow = new Date(2026, 10, 2, 12, 0, 0, 0);
  assert.equal((new Date(2026, 10, 2).getTime() - new Date(2026, 10, 1).getTime()) / 3600000, 25);
  assert.equal(bucketOf(atDayOffset(fallNow, -1), fallNow), "yesterday");
});

const groupedItems = [
  { id: "a", bucket: "today" },
  { id: "pinned-1", bucket: "pinned" },
  { id: "b", bucket: "week" },
  { id: "c", bucket: "today" },
  { id: "pinned-2", bucket: "pinned" },
  { id: "d", bucket: "earlier" },
];

const entryLabel = (entry) => (entry.type === "header" ? `#${entry.bucket}:${entry.count}` : entry.item.id);

test("groupByTimeBucket keeps pinned first and preserves stable in-bucket order", () => {
  const entries = groupByTimeBucket(groupedItems, (item) => item.bucket);
  assert.deepEqual(entries.map(entryLabel), [
    "#pinned:2", "pinned-1", "pinned-2",
    "#today:2", "a", "c",
    "#week:1", "b",
    "#earlier:1", "d",
  ]);
});

test("groupByTimeBucket emits only the headers of collapsed buckets", () => {
  const entries = groupByTimeBucket(groupedItems, (item) => item.bucket, { earlier: true, today: true });
  assert.deepEqual(entries.map(entryLabel), [
    "#pinned:2", "pinned-1", "pinned-2",
    "#today:2",
    "#week:1", "b",
    "#earlier:1",
  ]);
});

test("every grouped entry is exactly one virtual slot with a unique key", () => {
  const entries = groupByTimeBucket(groupedItems, (item) => item.bucket);
  const nonEmptyBuckets = new Set(groupedItems.map((item) => item.bucket)).size;
  // 头部也占一个槽位，虚拟列表才能直接用 entries.length 作为窗口总数。
  assert.equal(entries.length, groupedItems.length + nonEmptyBuckets);
  const keys = entries.map((entry) => (entry.type === "header" ? `header-${entry.bucket}` : entry.item.id));
  assert.equal(new Set(keys).size, keys.length);
});
