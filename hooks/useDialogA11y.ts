"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  FOCUSABLE_SELECTOR,
  isDialogCloseKey,
  isFocusableCandidate,
  isTabKey,
  nextFocusIndex,
} from "@/lib/dialog-focus";

/**
 * fork:dsn-dialog-a11y — 自绘弹层的焦点约束。
 *
 * 解决的问题（见 docs/design-audit-impeccable-2026-09-18.md A11y-2）：
 * `ConfigPanelShell` 与 `ModelsConfig` 已经声明了 `role="dialog" aria-modal="true"`，
 * 但对焦点没有任何约束——Tab 能走到弹层背后、Esc 依赖焦点恰好落在容器上、
 * 关闭后焦点丢失。这里按原生 `<dialog>` 的行为补齐四件事：
 *
 *   1. 打开时把焦点移进弹层（优先 `initialFocusRef`，否则第一个可聚焦元素）；
 *   2. Tab / Shift+Tab 在弹层内循环；
 *   3. Esc 关闭（调用方给 onClose；与服务端阻塞型弹层无关）；
 *   4. 打开期间把弹层的**兄弟节点**设为 `inert`，关闭后还原，
 *      并把焦点还给打开它的那个元素。
 *
 * 为什么用 inert 而不是给背景加 aria-hidden：`inert` 同时屏蔽焦点与读屏，
 * 而 aria-hidden 只屏蔽读屏（键盘仍会走进去）。
 *
 * 注意：不做点击外部关闭（那是产品行为，各弹层自己决定），
 * 也不接管滚动锁定。
 */
export interface DialogA11yOptions {
  /** 弹层是否打开。 */
  open: boolean;
  /** Esc 时调用；不传则不接管 Esc。 */
  onClose?: () => void;
  /** 打开时优先聚焦的元素（例如标题或第一个输入框）。 */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function useDialogA11y({ open, onClose, initialFocusRef }: DialogA11yOptions) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const candidates = useCallback((): HTMLElement[] => {
    const root = dialogRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
      const style = typeof window !== "undefined" ? window.getComputedStyle(element) : null;
      return isFocusableCandidate({
        disabled: element.hasAttribute("disabled") || (element as HTMLButtonElement).disabled === true,
        tabIndex: element.tabIndex,
        hidden: element.getAttribute("aria-hidden") === "true" || element.hasAttribute("hidden"),
        invisible: style ? style.display === "none" || style.visibility === "hidden" : false,
      });
    });
  }, []);

  // 打开：记住来源焦点 → 移焦进弹层 → 兄弟节点 inert。
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialogRef.current;

    // 让浏览器先把弹层画出来再移焦，否则部分布局下 focus() 会落在 body 上。
    const focusTimer = setTimeout(() => {
      const target = initialFocusRef?.current ?? candidates()[0] ?? root;
      target?.focus?.({ preventScroll: true });
    }, 0);

    const changed: HTMLElement[] = [];
    if (root && root.parentElement) {
      for (const sibling of Array.from(root.parentElement.children)) {
        if (sibling === root || !(sibling instanceof HTMLElement)) continue;
        if ((sibling as HTMLElement & { inert?: boolean }).inert === true) continue;
        // 只对尚未 inert 的兄弟下手，并记录，避免覆盖调用方自己设的 inert。
        (sibling as HTMLElement & { inert?: boolean }).inert = true;
        changed.push(sibling);
      }
    }

    return () => {
      clearTimeout(focusTimer);
      for (const element of changed) (element as HTMLElement & { inert?: boolean }).inert = false;
      // 焦点还原：只在焦点仍在弹层内部（或落到 body）时还原，
      // 避免抢走用户已经移到别处的焦点。
      const active = document.activeElement;
      const insideDialog = root?.contains(active ?? null) ?? false;
      if (insideDialog || active === document.body || active === null) {
        previouslyFocusedRef.current?.focus?.({ preventScroll: true });
      }
      previouslyFocusedRef.current = null;
    };
  }, [candidates, initialFocusRef, open]);

  // 键盘：Tab 循环 + Esc。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isDialogCloseKey(event.key) && onClose) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (!isTabKey(event)) return;
      const list = candidates();
      if (list.length === 0) return;
      const current = list.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(current, list.length, event.shiftKey);
      if (next < 0) return;
      // 只有越界时才拦截：中间的 Tab 交给浏览器，保留原生顺序与滚动行为。
      if (current === -1 || (next === 0 && !event.shiftKey) || (next === list.length - 1 && event.shiftKey)) {
        event.preventDefault();
        list[next].focus({ preventScroll: true });
      }
    };
    // capture：弹层内部可能自己 stopPropagation，用捕获阶段保证一定拿到。
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [candidates, onClose, open]);

  return {
    dialogRef,
    /** 展开到弹层根元素上的属性；嵌在页面里的模式不要用。 */
    dialogProps: {
      role: "dialog" as const,
      "aria-modal": true as const,
    },
  };
}
