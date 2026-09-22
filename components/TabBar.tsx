"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getFileIcon } from "./FileIcons";
import { TabOverview } from "./fork/TabOverview";
import { useI18n } from "@/hooks/useI18n";
import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";
import type { RestorableTab } from "@/lib/recent-closed-tabs";
import { splitVisibleTabs } from "@/lib/tab-overflow";
import { TEXT } from "@/lib/typography";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  /** fork:git-graph-tab — `git-graph` 是工作区单例视图 tab（无 filePath）。 */
  kind?: "terminal" | "browser" | "session" | "git-graph";
  closing?: boolean;
  sourceSessionId?: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  /**
   * fork:zc-06 — tab 概览（全部 tab + 最近关闭）。不传就不渲染入口按钮，
   * 这样 TabBar 在没有 tab 状态所有者的场景（测试、静态渲染）里仍然可用。
   */
  overview?: {
    recentClosed: RestorableTab[];
    onCloseAll: () => void;
    onCloseOthers: () => void;
    onRestore: (tab: RestorableTab) => void;
    onClearRecent: () => void;
  };
}

// fork:ui-12 — width of the "…" fold button (kept in sync with its style below).
const TAB_OVERFLOW_BUTTON_WIDTH = 34;

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, overview }: Props) {
  const { t } = useI18n();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  // fork:ui-14 — the close control stays out of the way until the tab is
  // active, hovered or keyboard-focused (reference implementations reveal it
  // on hover; keeping it in the layout avoids jitter).
  const [focusedClose, setFocusedClose] = useState<string | null>(null);
  // fork:ui-12 — fold trailing tabs into a "…" menu when the bar runs out of room.
  // Widths are measured per tab (content-derived), the split itself is pure.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthsRef = useRef(new Map<string, number>());
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowPos, setOverflowPos] = useState<{ top: number; left: number } | null>(null);
  // fork:zc-06 — tab 概览浮层。锚点仍然按 fixed 计算，理由与「…」菜单相同
  // （这条 tab 栏横向裁切，in-flow 下拉会被切掉）。
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewPos, setOverviewPos] = useState<{ top: number; left: number } | null>(null);
  // fork:zm-05 — sliding active-tab indicator. The pill is absolutely positioned
  // and lives outside the flex flow, so none of the measurements below see it.
  const tabElementsRef = useRef(new Map<string, HTMLElement>());
  const pendingTabFocusRef = useRef<string | null>(null);
  const pillFrameRef = useRef<number | null>(null);
  const [pillState, setPillState] = useState<{ x: number; width: number; ready: boolean }>({
    x: 0,
    width: 0,
    ready: false,
  });

  useEffect(() => {
    // tab 全关光时浮层无事可做，留着只会悬在空栏上。
    if (tabs.length === 0 && overviewOpen) setOverviewOpen(false);
  }, [overviewOpen, tabs.length]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setContainerWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const measureTab = (id: string) => (element: HTMLElement | null) => {
    if (!element) {
      tabElementsRef.current.delete(id);
      return;
    }
    tabElementsRef.current.set(id, element);
    const width = element.offsetWidth;
    if (widthsRef.current.get(id) === width) return;
    widthsRef.current.set(id, width);
    setLayoutVersion((current) => current + 1);
  };

  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);

  // fork:zm-05 — measure the active tab and move the pill. `offsetLeft` is
  // relative to the positioned tab bar (`.fork-tabbar`), so transform and width
  // can be applied verbatim. Measurement is batched through rAF when it comes
  // from observers; a commit (tab switch, keyboard navigation) updates in the
  // layout phase so the pill and the content move in the same frame.
  const updatePill = useCallback(() => {
    const element = tabElementsRef.current.get(activeTabId);
    if (!element) return;
    const x = element.offsetLeft;
    const width = element.offsetWidth;
    setPillState((current) => (
      current.ready && current.x === x && current.width === width
        ? current
        : { x, width, ready: true }
    ));
  }, [activeTabId]);

  const schedulePillUpdate = useCallback(() => {
    if (typeof window === "undefined" || pillFrameRef.current !== null) return;
    pillFrameRef.current = window.requestAnimationFrame(() => {
      pillFrameRef.current = null;
      updatePill();
    });
  }, [updatePill]);

  // Runs after every commit: covers click/keyboard selection, and restores focus
  // to a tab that was folded into the overflow menu until it became visible.
  useLayoutEffect(() => {
    updatePill();
    const pendingFocusId = pendingTabFocusRef.current;
    if (!pendingFocusId) return;
    pendingTabFocusRef.current = null;
    tabElementsRef.current.get(pendingFocusId)?.focus();
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedulePillUpdate);
    observer?.observe(container);
    for (const element of tabElementsRef.current.values()) observer?.observe(element);
    window.addEventListener("resize", schedulePillUpdate);
    return () => {
      if (pillFrameRef.current !== null) {
        window.cancelAnimationFrame(pillFrameRef.current);
        pillFrameRef.current = null;
      }
      observer?.disconnect();
      window.removeEventListener("resize", schedulePillUpdate);
    };
  }, [activeTabId, containerWidth, layoutVersion, schedulePillUpdate, tabs.length]);
  // `layoutVersion` is the re-measure signal: widths live in a ref, and this state
  // value is what re-runs the split after a tab reports a new width.
  const measuredWidths = useMemo(
    () => tabs.map((tab) => widthsRef.current.get(tab.id) ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, layoutVersion],
  );
  const { visible, hidden } = splitVisibleTabs({
    widths: measuredWidths,
    containerWidth: containerWidth || 100_000,
    moreWidth: TAB_OVERFLOW_BUTTON_WIDTH,
    activeIndex,
  });
  const visibleSet = new Set(visible);
  const hiddenTabs = hidden.map((index) => tabs[index]!).filter(Boolean);

  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-tab-overflow-menu]")) return;
      setOverflowOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overflowOpen]);

  const tabAccessibleName = (tab: Tab) => (
    tab.kind === "terminal"
      ? t("terminal.tabLabel", { name: tab.label })
      : tab.kind === "browser"
        ? t("browser.tabLabel", { name: tab.label })
        : tab.label
  );

  return (
    <div
      ref={containerRef}
      role="tablist"
      className="fork-tabbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "0 4px",
        background: "transparent",
        overflowX: "hidden",
        flexShrink: 0,
        height: 36,
        minWidth: 0,
      }}
    >
      {/* fork:zm-05 — the highlight pill. Absolutely positioned (out of flow) so
          the per-tab offsetWidth measurements that drive the "…" fold are
          unaffected; opacity stays 0 until the first measurement lands, which
          prevents a flash at (0,0). */}
      <span
        aria-hidden="true"
        className="fork-tab-pill"
        style={{
          transform: `translateX(${pillState.ready ? pillState.x : 0}px)`,
          width: pillState.ready ? pillState.width : 0,
          opacity: pillState.ready && activeIndex >= 0 && tabs.length > 0 ? 1 : 0,
        }}
      />
      {tabs.map((tab, index) => {
        if (!visibleSet.has(index)) return null;
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            ref={measureTab(tab.id)}
            role="tab"
            className="fork-tab"
            aria-label={tabAccessibleName(tab)}
            aria-selected={isActive}
            tabIndex={isActive || (!activeTabId && tabs[0].id === tab.id) ? 0 : -1}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const index = tabs.findIndex((item) => item.id === tab.id);
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                const nextId = tabs[next].id;
                onSelectTab(nextId);
                // fork:zm-05 — the pill is the tab bar's first child, so the old
                // positional `children[next]` lookup would land one node early.
                // Focus by id after the selection re-renders (the tab may have
                // been folded into the overflow menu before this keypress).
                pendingTabFocusRef.current = nextId;
              }
            }}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              if (!tab.closing) onCloseTab(tab.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              paddingLeft: 10,
              paddingRight: 4,
              border: "none",
              borderRadius: "var(--radius-md)",
              // fork:zm-05 — the active surface now lives on `.fork-tab-pill`;
              // the tab itself stays transparent so the pill can slide beneath it.
              background: "transparent",
              cursor: "pointer",
              fontSize: TEXT.sm,
              color: isActive ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 180,
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              transition: "color 0.1s, transform 120ms var(--ease-out)",
            }}
          >
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              {tab.kind === "terminal" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              ) : tab.kind === "browser" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
                  <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
                </svg>
              ) : getFileIcon(tab.label, 13)}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={tab.filePath}
            >
              {tab.label}
            </span>
            <button
              disabled={tab.closing}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              onFocus={() => setFocusedClose(tab.id)}
              onBlur={() => setFocusedClose(null)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22,
                background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                border: "none",
                borderRadius: "var(--radius-sm)",
                color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                opacity: isActive || hoveredClose === tab.id || focusedClose === tab.id ? 1 : 0,
                transition: "background 0.1s, color 0.1s, opacity 0.12s",
              }}
               title={t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")}
               aria-label={`${t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")} ${tab.label}`}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}
      {/* fork:ui-12 — the folded tabs. The menu is fixed-positioned because the
          bar itself clips on the x axis (overflow-x: hidden), which would cut off
          any in-flow dropdown. */}
      {hiddenTabs.length > 0 && (
        <button
          type="button"
          className="fork-tab-more"
          onClick={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            setOverflowPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 240) });
            setOverflowOpen((current) => !current);
          }}
          title={t("tabs.more", { count: hiddenTabs.length })}
          aria-label={t("tabs.more", { count: hiddenTabs.length })}
          aria-expanded={overflowOpen}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
            height: 28, width: TAB_OVERFLOW_BUTTON_WIDTH, flexShrink: 0,
            background: overflowOpen ? "var(--bg-selected)" : "transparent",
            border: "none", borderRadius: "var(--radius-md)",
            color: "var(--text-muted)", cursor: "pointer", fontSize: TEXT.xs,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" />
          </svg>
          {hiddenTabs.length}
        </button>
      )}
      {/* fork:zc-06 — 概览入口。始终存在（只要还有 tab），因为溢出菜单只在
          放不下时才出现 —— 那正是「tab 少的时候看不到全部 tab」的成因。 */}
      {overview && tabs.length > 0 && (
        <button
          type="button"
          data-tab-overview-trigger="true"
          className="fork-tab-overview"
          onClick={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            setOverviewPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 300) });
            setOverviewOpen((current) => !current);
          }}
          title={t("tabs.overview")}
          aria-label={t("tabs.overview")}
          aria-expanded={overviewOpen}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 28, width: 28, flexShrink: 0,
            background: overviewOpen ? "var(--bg-selected)" : "transparent",
            border: "none", borderRadius: "var(--radius-md)",
            color: overviewOpen ? "var(--text)" : "var(--text-muted)", cursor: "pointer",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" />
          </svg>
        </button>
      )}
      {overview && (
        <TabOverview
          open={overviewOpen}
          anchor={overviewPos}
          tabs={tabs}
          activeTabId={activeTabId}
          recentClosed={overview.recentClosed}
          onClose={() => setOverviewOpen(false)}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          onCloseAll={overview.onCloseAll}
          onCloseOthers={overview.onCloseOthers}
          onRestore={overview.onRestore}
          onClearRecent={overview.onClearRecent}
        />
      )}
      {overflowOpen && overflowPos && hiddenTabs.length > 0 && (
        <div
          data-tab-overflow-menu="true"
          role="menu"
          style={{
            position: "fixed",
            top: overflowPos.top,
            left: overflowPos.left,
            zIndex: 400,
            width: 240,
            maxHeight: "min(60vh, 420px)",
            overflowY: "auto",
            padding: 4,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {hiddenTabs.map((tab) => (
            <div key={tab.id} style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOverflowOpen(false);
                  onSelectTab(tab.id);
                }}
                title={tab.filePath}
                style={{
                  display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, height: 30,
                  padding: "0 8px", background: "none", border: "none",
                  borderRadius: "var(--radius-md)", color: "var(--text)",
                  cursor: "pointer", fontSize: TEXT.sm, textAlign: "left",
                }}
                onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "none"; }}
              >
                <span style={{ flexShrink: 0, opacity: 0.75, display: "flex", alignItems: "center" }}>
                  {tab.kind === "terminal" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  ) : tab.kind === "browser" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
                    </svg>
                  ) : getFileIcon(tab.label, 12)}
                </span>
                <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.label}</span>
              </button>
              <button
                type="button"
                disabled={tab.closing}
                onClick={() => {
                  setOverflowOpen(false);
                  onCloseTab(tab.id);
                }}
                title={t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")}
                aria-label={`${t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")} ${tab.label}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, flexShrink: 0, background: "none",
                  border: "none", borderRadius: "var(--radius-sm)",
                  color: "var(--text-dim)", cursor: "pointer", padding: 0,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
