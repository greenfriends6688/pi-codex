/**
 * 会话列表的时间分组桶。
 *
 * `pinned` 由界面根据 localStorage 里的置顶标记赋值；其余桶由会话的
 * `modified` 时间戳（ISO 字符串）按“本地日历日”计算，最新在前。
 */
export type TimeBucket = "pinned" | "today" | "yesterday" | "week" | "month" | "earlier";

/** 分桶顺序：pinned 永远最前，earlier 最后。 */
export const TIME_BUCKET_ORDER: readonly TimeBucket[] = [
  "pinned",
  "today",
  "yesterday",
  "week",
  "month",
  "earlier",
];

/**
 * 把 `modified`（ISO 字符串）按**本地日历日**分桶。
 *
 * 边界是日历日，不是滚动 24 小时窗口：
 *   today     — 与 now 同一个本地日历日（未来时间戳也落在这里，容忍时钟偏差/时区差异）
 *   yesterday — 前一个本地日历日
 *   week      — 2..7 个日历日之前
 *   month     — 8..30 个日历日之前
 *   earlier   — 更早，或无法解析的时间戳
 *
 * DST 关键坑：下面两个值都是“本地零点”对应的 UTC 毫秒。夏令时切换那一天的
 * 日历日只有 23 或 25 小时，差值不是 24 小时的整数倍，因此必须用
 * `Math.round` 而不是 `Math.floor`，否则 23 小时那天会被错分到 today
 * （0.958 天 floor 成 0），而不是 yesterday。
 */
export function bucketOf(modified: string, now: Date = new Date()): TimeBucket {
  const date = new Date(modified);
  if (Number.isNaN(date.getTime())) return "earlier";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDay) / 86400000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "week";
  if (diffDays <= 30) return "month";
  return "earlier";
}

/** 分组头文案的 i18n key（命名与现有 session.* 对齐）。 */
export function timeBucketKey(bucket: TimeBucket): string {
  switch (bucket) {
    case "pinned": return "session.groupPinned";
    case "today": return "session.groupToday";
    case "yesterday": return "session.groupYesterday";
    case "week": return "session.groupWeek";
    case "month": return "session.groupMonth";
    case "earlier": return "session.groupEarlier";
  }
}

/** 扁平化后的“分组头”条目，渲染成一行可点击的表头。 */
export interface TimeGroupHeaderEntry {
  type: "header";
  bucket: TimeBucket;
  /** 该桶内的条目数（折叠时也显示，方便知道里面有多少条）。 */
  count: number;
}

/** 扁平化后的普通条目，`item` 由调用方决定（侧栏里是 SessionFamily）。 */
export interface TimeGroupItemEntry<T> {
  type: "item";
  item: T;
}

export type TimeGroupEntry<T> = TimeGroupHeaderEntry | TimeGroupItemEntry<T>;

/**
 * 把已排好序的条目按时间桶摊平成"扁平条目数组"。
 *
 * 虚拟列表关键坑：返回数组就是滚动虚拟化的槽位来源——头部和条目各占一个槽位，
 * 且调用方会把槽位高度统一成同一个值。于是
 * `getSessionListIndices(entries.length, ...)` 的 index 口径与渲染出的槽位一一对应，
 * 插入分组头不会造成偏移或越界。不要在头部上再做“不占槽位”的特殊布局。
 *
 * 同一桶内保持输入顺序（稳定分桶）：因此 `applySessionFlags` 的 pinned 分区、
 * `sessionSort` 的 created/modified 排序结果都不会被打乱。pinned 必须由调用方
 * 映射到 "pinned" 桶，从而始终置顶。
 *
 * 折叠的桶只输出头部、不输出条目——行不渲染即“按需加载”。
 */
export function groupByTimeBucket<T>(
  items: readonly T[],
  bucketOfItem: (item: T) => TimeBucket,
  collapsed: Partial<Record<TimeBucket, boolean>> = {},
): TimeGroupEntry<T>[] {
  const byBucket = new Map<TimeBucket, T[]>();
  for (const bucket of TIME_BUCKET_ORDER) byBucket.set(bucket, []);
  for (const item of items) byBucket.get(bucketOfItem(item))!.push(item);

  const entries: TimeGroupEntry<T>[] = [];
  for (const bucket of TIME_BUCKET_ORDER) {
    const bucketItems = byBucket.get(bucket)!;
    if (bucketItems.length === 0) continue;
    entries.push({ type: "header", bucket, count: bucketItems.length });
    if (collapsed[bucket]) continue;
    for (const item of bucketItems) entries.push({ type: "item", item });
  }
  return entries;
}
