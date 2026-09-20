import type { TimeBucket } from "./time-groups";

/**
 * 会话列表时间分组头的折叠状态持久化。
 *
 * `earlier` 默认折叠（里面的行不渲染，相当于按需加载），其余分组默认展开；
 * 状态写入 localStorage，跨刷新保留用户的折叠习惯。与 draft-store /
 * file-explorer-state 使用同一套“解析失败就退回默认值”的兜底策略。
 *
 * 存储 key 与参考实现保持一致：`pi-collapsed-time-groups`。
 */
const STORAGE_KEY = "pi-collapsed-time-groups";

export type CollapsedTimeGroups = Record<TimeBucket, boolean>;

const DEFAULTS: CollapsedTimeGroups = {
  pinned: false,
  today: false,
  yesterday: false,
  week: false,
  month: false,
  earlier: true,
};

export function loadCollapsedTimeGroups(): CollapsedTimeGroups {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<TimeBucket, boolean>>;
    const result = { ...DEFAULTS };
    for (const bucket of Object.keys(DEFAULTS) as TimeBucket[]) {
      if (typeof parsed[bucket] === "boolean") result[bucket] = parsed[bucket];
    }
    return result;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveCollapsedTimeGroups(groups: CollapsedTimeGroups): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // 配额/隐私模式失败无所谓：折叠状态只是体验优化，不影响功能。
  }
}
