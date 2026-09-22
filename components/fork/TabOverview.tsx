"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFileIcon } from "../FileIcons";
import { useI18n } from "@/hooks/useI18n";
import type { RestorableTab } from "@/lib/recent-closed-tabs";
import { TEXT } from "@/lib/typography";

/*
 * fork:zc-06 — 右栏 tab 概览。
 *
 * 对照项目（ZCode）把「tab 总览」与「最近关闭的标签页」放在同一个浮层里
 * （`app-shell/SidePaneTabOverview.tsx`）。本仓原来只有一个「…」溢出菜单，且
 * 只在 tab 放不下时才出现 —— 也就是说 tab 少的时候**没有任何地方能看到全部
 * tab**，关错了也没得救。这个浮层补的就是这两件事。
 *
 * 为什么是 fixed 定位：宿主 tab 栏是 `overflow-x: hidden`（横向裁切），
 * 任何 in-flow 的下拉都会被裁掉 —— 与既有「…」菜单同一个理由。
 *
 * 为什么覆盖全部 tab 而不是只列被折叠的：概览的用途是「找」与「批量关」，
 * 只列折叠项时用户还得先判断某个 tab 在不在被折叠的那部分里。
 */

export interface TabOverviewEntry {
  id: string;
  label: string;
  filePath: string;
  kind?: "terminal" | "browser" | "session" | "git-graph";
}

interface Props {
  open: boolean;
  anchor: { top: number; left: number } | null;
  tabs: TabOverviewEntry[];
  activeTabId: string;
  recentClosed: RestorableTab[];
  onClose: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAll: () => void;
  onCloseOthers: () => void;
  onRestore: (tab: RestorableTab) => void;
  onClearRecent: () => void;
}

const PANEL_WIDTH = 300;

function TabGlyph({ tab }: { tab: TabOverviewEntry }) {
  const size = 12;
  if (tab.kind === "terminal") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (tab.kind === "browser") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
      </svg>
    );
  }
  if (tab.kind === "session") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 5h16v10H7l-3 3z" />
      </svg>
    );
  }
  if (tab.kind === "git-graph") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    );
  }
  return <>{getFileIcon(tab.label, size)}</>;
}

export function TabOverview({
  open,
  anchor,
  tabs,
  activeTabId,
  recentClosed,
  onClose,
  onSelectTab,
  onCloseTab,
  onCloseAll,
  onCloseOthers,
  onRestore,
  onClearRecent,
}: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 每次打开都是新的一次查找：留下上一条查询会让人以为列表被过滤坏了。
  useEffect(() => {
    if (!open) return;
    setQuery("");
    // 焦点进搜索框，打开就能直接打字。
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-tab-overview]")) return;
      // 触发按钮自己负责开关，否则一次点击会「关掉又打开」。
      if (target?.closest("[data-tab-overview-trigger]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, onClose]);

  const needle = query.trim().toLowerCase();
  const visibleTabs = useMemo(() => {
    if (!needle) return tabs;
    return tabs.filter((tab) => (
      tab.label.toLowerCase().includes(needle) || tab.filePath.toLowerCase().includes(needle)
    ));
  }, [needle, tabs]);

  if (!open || !anchor) return null;

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, width: "100%",
    padding: "0 8px", height: 30, minWidth: 0,
    background: "none", border: "none", borderRadius: "var(--radius-md)",
    color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: TEXT.sm,
  };

  return (
    <div
      ref={panelRef}
      data-tab-overview="true"
      role="dialog"
      aria-label={t("tabs.overview")}
      style={{
        position: "fixed",
        top: anchor.top,
        left: anchor.left,
        zIndex: 400,
        width: PANEL_WIDTH,
        maxHeight: "min(70vh, 480px)",
        display: "flex",
        flexDirection: "column",
        padding: 6,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px 0" }}>
        <span style={{ flex: 1, fontSize: TEXT.xs, color: "var(--text-muted)", fontWeight: 500 }}>
          {t("tabs.overview")}
        </span>
        <button
          type="button"
          onClick={onCloseOthers}
          disabled={tabs.length < 2}
          style={{
            background: "none", border: "none", padding: "2px 4px",
            color: tabs.length < 2 ? "var(--text-dim)" : "var(--text-muted)",
            cursor: tabs.length < 2 ? "default" : "pointer", fontSize: TEXT.xs,
          }}
        >
          {t("tabs.closeOthers")}
        </button>
        <button
          type="button"
          onClick={onCloseAll}
          style={{
            background: "none", border: "none", padding: "2px 4px",
            color: "var(--text-muted)", cursor: "pointer", fontSize: TEXT.xs,
          }}
        >
          {t("tabs.closeAll")}
        </button>
      </div>

      <div style={{ padding: "6px 4px 4px" }}>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("tabs.overviewSearch")}
          aria-label={t("tabs.overviewSearch")}
          style={{
            width: "100%", height: 26, padding: "0 8px",
            background: "var(--bg-panel)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)", color: "var(--text)", fontSize: TEXT.sm,
          }}
        />
      </div>

      <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
        {visibleTabs.length === 0 && (
          <div role="status" style={{ padding: "10px 8px", fontSize: TEXT.xs, color: "var(--text-muted)" }}>
            {t("tabs.overviewEmpty")}
          </div>
        )}
        {visibleTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div key={tab.id} style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => { onSelectTab(tab.id); onClose(); }}
                title={tab.filePath}
                aria-current={isActive ? "true" : undefined}
                style={{ ...rowStyle, fontWeight: isActive ? 500 : 400 }}
                onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "none"; }}
              >
                <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center", color: isActive ? "var(--accent)" : "inherit" }}>
                  <TabGlyph tab={tab} />
                </span>
                <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tab.label}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(tab.id)}
                title={t("i18n.close")}
                aria-label={`${t("i18n.close")} ${tab.label}`}
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
          );
        })}

        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "6px 4px 2px", borderTop: "1px solid var(--border)", paddingTop: 6 }}>
          <span style={{ flex: 1, fontSize: TEXT.xs, color: "var(--text-muted)", fontWeight: 500 }}>
            {t("tabs.recentlyClosed")}
          </span>
          {recentClosed.length > 0 && (
            <button
              type="button"
              onClick={onClearRecent}
              style={{ background: "none", border: "none", padding: "2px 4px", color: "var(--text-muted)", cursor: "pointer", fontSize: TEXT.xs }}
            >
              {t("tabs.clearRecent")}
            </button>
          )}
        </div>

        {recentClosed.length === 0 ? (
          <div role="status" style={{ padding: "6px 8px 10px", fontSize: TEXT.xs, color: "var(--text-dim)" }}>
            {t("tabs.recentlyClosedEmpty")}
          </div>
        ) : (
          recentClosed.map((tab) => (
            <div key={`recent:${tab.id}`} style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => { onRestore(tab); onClose(); }}
                title={tab.filePath}
                style={{ ...rowStyle, color: "var(--text-muted)" }}
                onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "none"; }}
              >
                <span style={{ flexShrink: 0, opacity: 0.6, display: "flex", alignItems: "center" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 10 9 10" />
                  </svg>
                </span>
                <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tab.label}
                </span>
                <span style={{ flexShrink: 0, fontSize: TEXT.xs, color: "var(--text-dim)" }}>
                  {t("tabs.restore")}
                </span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
