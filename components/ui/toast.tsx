"use client";

// fork:ds-toast（DS-12）—— 应用级 toast：shadcn 的 add/close/promise manager 语义 + BoardUI notification 卡片视觉。
// 来源：BoardUI components/base/notification/notification.tsx（MIT）。改动：去 motion（CSS transition 进出场、
// WAAPI 倒计时条）、去 remixicon（内联 stroke-1.5 SVG）、去 Avatar/Button/CloseButton 依赖；manager API 取自
// shadcn/ui 的语义（toast.add / toast.close / toast.promise），状态是模块级订阅 + useSyncExternalStore，无外部状态库。

import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/utils/cx";

/* ---------------------------------- types --------------------------------- */

export type ToastType = "success" | "info" | "warning" | "error" | "loading";
export type ToastPriority = "low" | "normal" | "high";

export type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** shadcn 同名形状：children 是按钮文案，altText 给纯图标按钮兜底无障碍名。 */
export interface ToastActionProps {
  children: ReactNode;
  onClick?: () => void;
  altText?: string;
}

export interface ToastOptions {
  title?: ReactNode;
  description?: ReactNode;
  type?: ToastType;
  /** high：常驻，直到 close() / 点操作按钮 / 点关闭。 */
  priority?: ToastPriority;
  /** 自动关闭毫秒数；0、type=loading 或 priority=high 都表示不自动关。 */
  duration?: number;
  actionProps?: ToastActionProps;
  closeLabel?: string;
}

export interface ToastRecord extends ToastOptions {
  id: string;
  type: ToastType;
  priority: ToastPriority;
  duration: number;
  createdAt: number;
  dismissing: boolean;
}

export interface ToastPromiseMessages<T> {
  loading: ToastOptions | ReactNode;
  success: ToastOptions | ReactNode | ((value: T) => ToastOptions | ReactNode);
  error: ToastOptions | ReactNode | ((error: unknown) => ToastOptions | ReactNode);
}

export interface ToastHostProps {
  /** 堆叠锚点，默认右下（上游 NotificationViewport 的默认）。 */
  position?: ToastPosition;
  className?: string;
}

/* ------------------------- module-level toast store ----------------------- */
/* 需求：最多 5 条可见，其余排队；add/close/promise 都只改数组快照并通知订阅者。 */

const MAX_VISIBLE = 5;
const DEFAULT_DURATION = 5000;
const EXIT_MS = 200; // 必须与卡片 transition 的 duration-200 一致

let records: ToastRecord[] = [];
let seed = 0;
const listeners = new Set<() => void>();
const EMPTY: ToastRecord[] = [];

function emit(next: ToastRecord[]) {
  records = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => records;
const getServerSnapshot = () => EMPTY;

function removeToast(id: string) {
  const next = records.filter((record) => record.id !== id);
  if (next.length !== records.length) emit(next);
}

/** 字符串/节点 → `{ title }`；普通对象（带 toast 字段）→ 原样当 options。 */
function toOptions(value: ToastOptions | ReactNode): ToastOptions {
  if (
    value !== null &&
    typeof value === "object" &&
    !isValidElement(value) &&
    ("title" in value || "description" in value || "type" in value || "actionProps" in value)
  ) {
    return value as ToastOptions;
  }
  return { title: value as ReactNode };
}

function addToast(options: ToastOptions): string {
  const id = `bui-toast-${++seed}`;
  emit([
    ...records,
    {
      type: "info",
      priority: "normal",
      duration: DEFAULT_DURATION,
      ...options,
      id,
      createdAt: Date.now(),
      dismissing: false,
    },
  ]);
  return id;
}

function updateToast(id: string, patch: ToastOptions): void {
  if (!records.some((record) => record.id === id)) return;
  // 不透传 dismissing：更新内容不会把正在退场的 toast 拉回来（promise 解析晚于用户关闭时）。
  emit(records.map((record) => (record.id === id ? { ...record, ...patch } : record)));
}

function closeToast(id: string): void {
  const index = records.findIndex((record) => record.id === id);
  if (index === -1 || records[index].dismissing) return;
  // 排队中的条目没有卡片，直接删；可见的先进退场动画。
  if (index >= MAX_VISIBLE) {
    removeToast(id);
    return;
  }
  emit(records.map((record) => (record.id === id ? { ...record, dismissing: true } : record)));
  // 兜底：即使卡片因极端堆叠被卸载，也保证 store 不残留。
  if (typeof window !== "undefined") {
    window.setTimeout(() => removeToast(id), EXIT_MS + 80);
  }
}

function resolveMessage<T>(
  message: ToastOptions | ReactNode | ((value: T) => ToastOptions | ReactNode),
  value: T,
): ToastOptions {
  return toOptions(typeof message === "function" ? message(value) : message);
}

function promiseToast<T>(input: Promise<T>, messages: ToastPromiseMessages<T>): Promise<T> {
  const id = addToast({ ...toOptions(messages.loading), type: "loading", duration: 0, priority: "high" });
  input.then(
    (value) =>
      updateToast(id, {
        ...resolveMessage(messages.success, value),
        type: "success",
        duration: DEFAULT_DURATION,
        priority: "normal",
      }),
    (error) =>
      updateToast(id, {
        ...resolveMessage(messages.error, error),
        type: "error",
        duration: DEFAULT_DURATION,
        priority: "normal",
      }),
  );
  return input;
}

/** 命令式 manager。`toast.add(...)` 返回 id，形状对齐 shadcn 的新 Toast API。 */
export const toast = {
  add: addToast,
  update: updateToast,
  close: closeToast,
  promise: promiseToast,
  success: (options: ToastOptions | ReactNode) => addToast({ ...toOptions(options), type: "success" }),
  info: (options: ToastOptions | ReactNode) => addToast({ ...toOptions(options), type: "info" }),
  warning: (options: ToastOptions | ReactNode) => addToast({ ...toOptions(options), type: "warning" }),
  error: (options: ToastOptions | ReactNode) => addToast({ ...toOptions(options), type: "error" }),
  loading: (options: ToastOptions | ReactNode) =>
    addToast({ ...toOptions(options), type: "loading", duration: 0, priority: "high" }),
};

/* ---------------------------------- visuals -------------------------------- */

const STATUS_DISC: Record<ToastType, string> = {
  info: "bg-notification-information-background text-notification-information-foreground",
  success: "bg-notification-success-background text-notification-success-foreground",
  error: "bg-notification-error-background text-notification-error-foreground",
  warning: "bg-status-yellow-background text-status-yellow-text",
  loading: "bg-background-secondary-default text-foreground-icon-secondary",
};

const POSITION_CLASSES: Record<ToastPosition, string> = {
  "top-left": "top-3 left-3 items-start sm:top-6 sm:left-6",
  "top-center": "top-3 left-1/2 -translate-x-1/2 items-center sm:top-6",
  "top-right": "top-3 right-3 items-end sm:top-6 sm:right-6",
  "bottom-left": "bottom-3 left-3 items-start sm:bottom-6 sm:left-6",
  "bottom-center": "bottom-3 left-1/2 -translate-x-1/2 items-center sm:bottom-6",
  "bottom-right": "right-3 bottom-3 items-end sm:right-6 sm:bottom-6",
};

const GLYPH = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function ToastGlyph({ type }: { type: ToastType }) {
  return (
    <svg {...GLYPH} className={type === "loading" ? "animate-spin motion-reduce:animate-none" : undefined}>
      {type === "loading" ? (
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      ) : type === "success" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.5 2.5 2.5 5-5.5" />
        </>
      ) : type === "warning" ? (
        <>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </>
      ) : type === "error" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5" />
          <path d="M12 16.5h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </>
      )}
    </svg>
  );
}

/* ----------------------------------- card ---------------------------------- */

function ToastCard({ record }: { record: ToastRecord }) {
  const {
    id,
    title,
    description,
    type,
    priority,
    duration,
    actionProps,
    closeLabel = "Dismiss notification",
    dismissing,
  } = record;

  const [entered, setEntered] = useState(false);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(duration);
  const pausedRef = useRef(false);
  const barRef = useRef<HTMLSpanElement>(null);
  const barAnimationRef = useRef<Animation | null>(null);

  const sticky = priority === "high" || type === "loading";
  const autoDismiss = !sticky && duration > 0;
  const isError = type === "error";

  // enter（CSS transition；reduced-motion 由 motion-reduce:transition-none 关掉）
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // promise 从 loading 更新为 success/error（duration 变化）时重置计时。
  useEffect(() => {
    remainingRef.current = duration;
  }, [duration]);

  // JS 计时是自动关闭的唯一依据；paused 时停表，恢复后接着走剩余时长。
  useEffect(() => {
    if (!autoDismiss || dismissing || paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => closeToast(id), Math.max(0, remainingRef.current));
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [autoDismiss, dismissing, paused, id]);

  // 倒计时条：CSS transition 不能暂停，用 WAAPI；reduced-motion 下不跑动画，保留静态色条。
  useEffect(() => {
    if (!autoDismiss) return;
    const bar = barRef.current;
    if (!bar || typeof bar.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = bar.animate(
      [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
      { duration, easing: "linear", fill: "forwards" },
    );
    if (pausedRef.current) animation.pause();
    barAnimationRef.current = animation;
    return () => {
      animation.cancel();
      barAnimationRef.current = null;
    };
  }, [autoDismiss, duration]);

  useEffect(() => {
    pausedRef.current = paused;
    const animation = barAnimationRef.current;
    if (!animation) return;
    if (paused) animation.pause();
    else animation.play();
  }, [paused]);

  // 退场：先播 200ms 的淡出/位移，再从 store 删除（上游 AnimatePresence 的等价物）。
  useEffect(() => {
    if (!dismissing) return;
    const timer = window.setTimeout(() => removeToast(id), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [dismissing, id]);

  return (
    <div
      data-slot="toast"
      data-state={dismissing ? "closed" : "open"}
      data-type={type}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      className={cx(
        "pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden p-4 pr-11",
        "rounded-2xl border border-border-button-default bg-background-primary-default shadow-dropdown",
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        entered && !dismissing ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.97] opacity-0",
      )}
    >
      <span
        data-slot="toast-icon"
        aria-hidden
        className={cx(
          "relative flex size-10 shrink-0 items-center justify-center rounded-full",
          STATUS_DISC[type],
        )}
      >
        <ToastGlyph type={type} />
      </span>

      <div data-slot="toast-content" className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="text-body-medium text-text-primary">{title}</p> : null}
        {description ? (
          // 超长内容的内部滚动上限：标题与操作按钮不跟着滚。
          <div className="max-h-40 overflow-y-auto overscroll-contain text-body-regular break-words text-text-secondary">
            {description}
          </div>
        ) : null}

        {actionProps ? (
          <div data-slot="toast-action" className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label={actionProps.altText}
              onClick={() => {
                actionProps.onClick?.();
                closeToast(id);
              }}
              className="inline-flex h-7 items-center rounded-md border border-border-button-default bg-background-primary-default px-2.5 text-body-2-medium text-text-primary transition-colors hover:bg-background-secondary-default focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:outline-none"
            >
              {actionProps.children}
            </button>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        data-slot="toast-close"
        aria-label={closeLabel}
        onClick={() => closeToast(id)}
        className="absolute top-3 right-3 inline-flex size-6 items-center justify-center rounded-md text-foreground-icon-secondary transition-colors hover:bg-background-secondary-default hover:text-foreground-icon-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:outline-none"
      >
        <svg {...GLYPH} width={16} height={16}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>

      {autoDismiss ? (
        <span
          ref={barRef}
          data-slot="toast-countdown"
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-border-focus-ring"
        />
      ) : null}
    </div>
  );
}

/* ----------------------------------- host ---------------------------------- */

const subscribeNoop = () => () => {};

export function ToastHost({ position = "bottom-right", className }: ToastHostProps) {
  const records = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    // 区域只负责堆叠；aria 语义在每条卡片上（普通 status/polite，错误 alert）。
    <div
      data-slot="toast-host"
      aria-label="Notifications"
      className={cx(
        "pointer-events-none fixed z-[1200] flex w-[min(400px,calc(100vw-24px))] flex-col gap-3",
        POSITION_CLASSES[position],
        className,
      )}
    >
      {records.slice(0, MAX_VISIBLE).map((record) => (
        <ToastCard key={record.id} record={record} />
      ))}
    </div>,
    document.body,
  );
}
