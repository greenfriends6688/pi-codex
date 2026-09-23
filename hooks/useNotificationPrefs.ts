"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  NOTIFICATION_PREFS_DEFAULT,
  NOTIFICATION_PREFS_STORAGE_KEY,
  parseStoredNotificationPrefs,
  type NotificationPrefs,
} from "@/lib/notification-prefs";

/**
 * fork:zn-16 — 通知偏好（持久化 + 跨组件共享），与 `useUiDensity` 同形。
 *
 * 没有 DOM 副作用：这一层只存值，取值方（`AppShell` 的三处投递判定）自己决定
 * 怎么用。这样「什么情况下该弹」的规则留在调用点旁边，而不是藏进一个 hook。
 */

const listeners = new Set<() => void>();
let prefs: NotificationPrefs | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStored(): NotificationPrefs {
  if (typeof window === "undefined") return NOTIFICATION_PREFS_DEFAULT;
  try {
    return parseStoredNotificationPrefs(window.localStorage.getItem(NOTIFICATION_PREFS_STORAGE_KEY));
  } catch {
    return NOTIFICATION_PREFS_DEFAULT;
  }
}

function ensurePrefs(): NotificationPrefs {
  if (prefs === null) prefs = readStored();
  return prefs;
}

/** 命令式读取，给非 React 调用点（事件回调）用。 */
export function getNotificationPrefs(): NotificationPrefs {
  return ensurePrefs();
}

export function useNotificationPrefs() {
  const current = useSyncExternalStore(subscribe, ensurePrefs, () => NOTIFICATION_PREFS_DEFAULT);

  const setPref = useCallback(<K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
    prefs = { ...ensurePrefs(), [key]: value };
    try {
      window.localStorage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // 存储不可用时本次会话仍然生效
    }
    emit();
  }, []);

  return { notificationPrefs: current, setNotificationPref: setPref };
}
