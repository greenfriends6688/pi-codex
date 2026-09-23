/**
 * fork:zn-16 — 通知偏好（Zeno 设置 →「通知」的开关矩阵）。
 *
 * Zeno 的通知页是一张开关矩阵：一个总开关 + 四个事件开关 + 声音。
 * 本仓此前只有隐式行为（有权限就发），没有任何开关，也没有「只在窗口没聚焦时
 * 才弹」这条 —— 而 `shouldShowBrowserNotification` 恰恰已经在做这件事，只是
 * 写死为「永远这样」。这里把两件事拆开：
 *
 *   - `enabled`      : 总开关，关掉就完全不发。
 *   - `onlyWhenUnfocused`: 关掉它，前台也会弹（原来的行为）。
 *   - `onComplete`   : `agent_end` 完成通知。
 *   - `onError`      : 一轮运行以错误收场时的通知。
 *
 * **没有 `onHostCrash`**：Zeno 那条接的是 Electron `utilityProcess` 宿主崩掉，
 * 本仓是 Next 进程内直接跑 AgentSession，没有第二层进程可崩。加一个永远不触发的
 * 开关比不加更糟，所以刻意缺这一行。
 *
 * 声音不在这里：它和 composer 上那个声音按钮是**同一个**偏好
 * （`hooks/useAudio.ts` 的 `pi-sound-enabled`），不另开一份。
 *
 * 纯数据模块，服务端可 import。
 */

export const NOTIFICATION_PREFS_STORAGE_KEY = "pi-notification-prefs";

export interface NotificationPrefs {
  enabled: boolean;
  onComplete: boolean;
  onError: boolean;
  onlyWhenUnfocused: boolean;
}

export const NOTIFICATION_PREFS_DEFAULT: NotificationPrefs = {
  enabled: true,
  onComplete: true,
  onError: true,
  onlyWhenUnfocused: true,
};

const BOOLEAN_KEYS: readonly (keyof NotificationPrefs)[] = [
  "enabled",
  "onComplete",
  "onError",
  "onlyWhenUnfocused",
];

/**
 * 解析存储值。**缺字段回落默认值、坏 JSON 整体回落默认值** —— 这个文件是用户可见
 * 开关的唯一真相，读失败时静默变成「全关」会让人以为通知坏了。
 */
export function parseStoredNotificationPrefs(raw: string | null): NotificationPrefs {
  if (!raw) return NOTIFICATION_PREFS_DEFAULT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NOTIFICATION_PREFS_DEFAULT;
    }
    const record = parsed as Record<string, unknown>;
    const next = { ...NOTIFICATION_PREFS_DEFAULT };
    for (const key of BOOLEAN_KEYS) {
      if (typeof record[key] === "boolean") next[key] = record[key] as boolean;
    }
    return next;
  } catch {
    return NOTIFICATION_PREFS_DEFAULT;
  }
}
