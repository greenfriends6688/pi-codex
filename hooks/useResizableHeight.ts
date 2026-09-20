"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
} from "react";

interface DragState {
  pointerId: number;
  startY: number;
  startHeight: number;
  moved: boolean;
  previousCursor: string;
  previousUserSelect: string;
}

interface UseResizableHeightOptions {
  /** 分隔条（拖拽手柄）的 aria-label */
  ariaLabel: string;
  /** 手动高度的硬下限（px） */
  minHeight: number;
  /** 跟随视口变化的上限（px） */
  getMaxHeight: () => number;
  /** 手动高度的 localStorage 持久化 key */
  storageKey: string;
  /** 被控制高度的元素（composer 卡片） */
  targetRef: MutableRefObject<HTMLDivElement | null>;
}

/**
 * 拖拽激活死区（px）：手柄上的普通点击不应把手动高度钉在当前自动高度上。
 * 只有指针真正移动超过这个距离，才进入手动模式。
 */
const DRAG_ACTIVATE_THRESHOLD_PX = 3;

function readStoredHeight(storageKey: string): number | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return null;
    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredHeight(storageKey: string, height: number): void {
  try {
    window.localStorage.setItem(storageKey, String(height));
  } catch {
    // 存储不可用时拖拽依然生效，只是刷新后不保留。
  }
}

function clearStoredHeight(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // 忽略存储失败 —— 本次挂载内手动高度照常重置。
  }
}

function clampHeight(candidate: number, minHeight: number, maxHeight: number): number {
  const finiteHeight = Number.isFinite(candidate) ? candidate : minHeight;
  const effectiveMax = Math.max(minHeight, maxHeight);
  return Math.round(Math.max(minHeight, Math.min(effectiveMax, finiteHeight)));
}

/**
 * fork:pr23-resize — `useResizablePanel` 的竖向对照版。
 *
 * 手柄放在目标元素**上边缘**，向上拖变大、向下拖变小。对外契约：
 * `height === null` 表示保持内容驱动的「自动」高度，数字表示用户已经接管为手动
 * 高度（挂在目标元素的内联 `height` 上）。
 *
 * 与「自动增高」的互斥：调用方在手动模式下必须给卡片加 `.is-manual-height`，
 * 并由 CSS 把 textarea 的 height 强制成 `100% !important` —— CSS `!important`
 * 优先级高于行内 style，因此 textarea 每次输入仍会写的 `style.height` 不会把
 * 手柄拖出来的高度顶回去；调用方在自动模式下则完全不接管。两边各管一个方向。
 *
 * 手动高度会持久化到 localStorage，跨会话/刷新保留；`Enter` 或双击手柄重置回
 * 自动模式并清掉存储值。
 */
export function useResizableHeight(options: UseResizableHeightOptions) {
  const { ariaLabel, minHeight, getMaxHeight, storageKey, targetRef } = options;
  const dragRef = useRef<DragState | null>(null);
  const restoredRef = useRef(false);
  // null = 自动高度（内容驱动）；数字 = 手动固定高度。
  const [height, setHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const heightRef = useRef<number | null>(null);
  heightRef.current = height;

  const effectiveMaxHeight = useCallback(
    () => Math.max(minHeight, getMaxHeight()),
    [getMaxHeight, minHeight],
  );

  const restoreBodyState = useCallback((drag: DragState) => {
    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;
  }, []);

  const finishResize = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    restoreBodyState(drag);
    setIsResizing(false);
    const current = heightRef.current;
    if (current !== null) writeStoredHeight(storageKey, current);
  }, [restoreBodyState, storageKey]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const activeDrag = dragRef.current;
    if (activeDrag) finishResize(activeDrag.pointerId);

    const target = event.currentTarget;
    target.focus({ preventScroll: true });
    // pointer capture：指针移出手柄甚至移出窗口后，move/up 仍回到这里。
    target.setPointerCapture(event.pointerId);

    // 手动模式要等指针真正移动后才进入（见 onPointerMove 的死区），但起手高度
    // 现在就记下来，保证切换无跳变。
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: clampHeight(
        targetRef.current?.offsetHeight ?? minHeight,
        minHeight,
        effectiveMaxHeight(),
      ),
      moved: false,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    setIsResizing(true);
  }, [effectiveMaxHeight, finishResize, minHeight, targetRef]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishResize(event.pointerId);
      return;
    }
    event.preventDefault();
    const deltaY = event.clientY - drag.startY;
    // 3px 死区：轻微抖动不算拖拽。
    if (!drag.moved && Math.abs(deltaY) < DRAG_ACTIVATE_THRESHOLD_PX) return;
    drag.moved = true;
    // 手柄在上边缘：向上拖（clientY 变小）变大，向下拖变小。
    const nextHeight = drag.startHeight - deltaY;
    const clamped = clampHeight(nextHeight, minHeight, effectiveMaxHeight());
    setHeight(clamped);
    event.currentTarget.setAttribute("aria-valuenow", String(clamped));
    event.currentTarget.setAttribute("aria-valuetext", `${clamped} px`);
  }, [effectiveMaxHeight, finishResize, minHeight]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const onLostPointerCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const resetHeight = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
    setHeight(null);
    clearStoredHeight(storageKey);
  }, [storageKey]);

  const setHeightTo = useCallback((next: number) => {
    const clamped = clampHeight(next, minHeight, effectiveMaxHeight());
    setHeight(clamped);
    writeStoredHeight(storageKey, clamped);
  }, [effectiveMaxHeight, minHeight, storageKey]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 24;
    const current = heightRef.current ?? targetRef.current?.offsetHeight ?? minHeight;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHeightTo(current + step);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHeightTo(current - step);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHeightTo(minHeight);
    } else if (event.key === "End") {
      event.preventDefault();
      setHeightTo(effectiveMaxHeight());
    } else if (event.key === "Enter") {
      event.preventDefault();
      resetHeight();
    }
  }, [effectiveMaxHeight, minHeight, resetHeight, setHeightTo, targetRef]);

  // 挂载时恢复持久化的手动高度一次，并按当前视口上限重夹。
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const stored = readStoredHeight(storageKey);
    if (stored !== null) {
      setHeight(clampHeight(stored, minHeight, effectiveMaxHeight()));
    }
  }, [effectiveMaxHeight, minHeight, storageKey]);

  // 视口变化导致上限变化时，重新夹住手动高度（窗口缩小时不留出屏高度）。
  useEffect(() => {
    const onResize = () => {
      if (heightRef.current === null) return;
      const clamped = clampHeight(heightRef.current, minHeight, effectiveMaxHeight());
      if (clamped !== heightRef.current) setHeight(clamped);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [effectiveMaxHeight, minHeight]);

  // 拖拽途中窗口失焦 / 标签页隐藏：取消这次拖拽，避免 cursor 卡在 row-resize。
  useEffect(() => {
    if (!isResizing) return;
    const cancelResize = () => {
      const drag = dragRef.current;
      if (drag) finishResize(drag.pointerId);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelResize();
    };
    window.addEventListener("blur", cancelResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", cancelResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [finishResize, isResizing]);

  // 卸载时也清理 body 上的拖拽副作用。
  useEffect(() => () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    restoreBodyState(drag);
  }, [restoreBodyState]);

  return {
    height,
    isResizing,
    resetHeight,
    separatorProps: {
      "aria-label": ariaLabel,
      "aria-orientation": "horizontal" as const,
      "aria-valuemax": effectiveMaxHeight(),
      "aria-valuemin": minHeight,
      "aria-valuenow": height ?? minHeight,
      "aria-valuetext": height !== null ? `${height} px` : undefined,
      onDoubleClick: resetHeight,
      onKeyDown,
      onLostPointerCapture,
      onPointerCancel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      role: "separator" as const,
      tabIndex: 0,
    },
    setHeight: setHeightTo,
  };
}
