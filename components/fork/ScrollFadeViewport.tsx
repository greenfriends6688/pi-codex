"use client";

/**
 * fork:zm-03 — 消息列顶端/底端渐隐遮罩（ZCode `components/ui/scroll-fade-viewport.tsx`）。
 *
 * 为什么需要：原来只有一条底部渐隐（`.fork-scroll-fade-b`，按 `showScrollToBottom`；已在 ZM-03 一并收掉）
 * 切换），顶部没有；而顶部在「加载更早」之后同样会藏着内容。这里改成状态机：
 * `none / top / bottom / both`，两端各自按「那一侧是否真的还有内容」淡出。
 *
 * 为什么是 inline styles：`app/fork-ui.css` 不归本 PR 所有，不能加新 CSS；遮罩值
 * 由纯函数 `scrollMaskImage()` 产出，rAF 批处理 + ResizeObserver 只更新一个
 * `data-*` 与 `maskImage`，不产生布局测量循环。
 *
 * 组件**自己渲染滚动容器**（`overflow-y: auto` 的那个节点），并把 DOM 节点回填给
 * 调用方的 `viewportRef` —— 这样 `useAgentSession` 既有的 scroll 监听、
 * `ChatMinimap` 的 `scrollContainer` 引用都还指向同一个元素。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { computeScrollMaskState, scrollMaskImage, type ScrollMaskState } from "@/lib/scroll-follow";

export interface ScrollFadeViewportProps {
  /** 回填内部滚动节点；沿用 `useRef<HTMLDivElement | null>(null)`。 */
  viewportRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** 渐隐高度（px）。 */
  fadeSizePx?: number;
}

export function ScrollFadeViewport({
  viewportRef,
  className,
  style,
  children,
  fadeSizePx = 24,
}: ScrollFadeViewportProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [maskState, setMaskState] = useState<ScrollMaskState>("none");

  const setViewportNode = useCallback((node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (viewportRef) viewportRef.current = node;
  }, [viewportRef]);

  useEffect(() => {
    const viewport = innerRef.current;
    if (!viewport) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const next = computeScrollMaskState({
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.clientHeight,
        contentHeight: viewport.scrollHeight,
      });
      setMaskState((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (frame !== 0) return;
      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(update);
      } else {
        update();
      }
    };

    update();
    viewport.addEventListener("scroll", schedule, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(viewport);
      const content = viewport.firstElementChild;
      if (content) observer.observe(content);
    }
    window.addEventListener("resize", schedule);

    return () => {
      viewport.removeEventListener("scroll", schedule);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
  }, []);

  const maskImage = scrollMaskImage(maskState, fadeSizePx);

  return (
    <div
      ref={setViewportNode}
      className={className}
      data-fork-scroll-mask={maskState}
      style={{
        ...style,
        ...(maskImage ? { maskImage, WebkitMaskImage: maskImage } : null),
      }}
    >
      {children}
    </div>
  );
}
