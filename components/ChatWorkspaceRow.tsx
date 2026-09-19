"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";

/**
 * 聊天 分区标题行（fork feature: `docs/patches/0001-chat-workspace.md`）。
 *
 * 与「项目」标题行同款排版（14px / 500 / text-dim + 右侧 28×28 图标按钮，
 * fork:zn-02：hover 前隐藏动作组），
 * 让 聊天 与 项目 在侧栏里读起来是两个平级分区，而不是「项目」下面的一行。
 *
 * 交互分工：
 * - 点标题      -> 切到聊天工作区（文件树、标签、每工作区会话记忆一起跟着走）
 * - `+`         -> 在聊天工作区直接开新对话
 * - 齿轮        -> 换聊天目录
 * - 折叠箭头    -> 展开/收起它下面的会话列表
 */
export function ChatWorkspaceRow({
  label,
  title,
  selected,
  expanded,
  activity,
  onSelect,
  onToggle,
  onNewChat,
  onConfigure,
  busy = false,
}: {
  label: string;
  title: string;
  selected: boolean;
  expanded: boolean;
  activity?: { running: number; unread: number };
  onSelect: () => void;
  onToggle: () => void;
  onNewChat: () => void;
  onConfigure: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);

  const iconButtonStyle = {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    background: "transparent",
    border: "none",
    borderRadius: "var(--radius-md)",
    color: "var(--text-dim)",
    cursor: busy ? "progress" : "pointer",
  } as const;

  // fork:zn-02 — 14px medium section head (Zeno group label); actions hide
  // until hover/focus via .fork-section-actions (touch keeps them visible).
  return (
    <div
      className="fork-section-head"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        marginTop: 2,
        marginBottom: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: "var(--zn-row)",
        paddingLeft: 10,
        paddingRight: 4,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        title={title}
        aria-current={selected ? "page" : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: 0,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: TEXT.lg,
            fontWeight: 500,
            color: selected || hovered ? "var(--text)" : "var(--text-dim)",
            transition: "color 0.12s",
          }}
        >
          {label}
        </span>
        {activity && (activity.running > 0 || activity.unread > 0) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, color: "var(--accent)", fontSize: TEXT["2xs"], fontFamily: "var(--font-mono)" }}>
            {activity.running > 0 && <span title={t("sidebar.agentRunning")}>{activity.running}</span>}
            {activity.unread > 0 && <span title={t("sidebar.newSessionActivity")}>{activity.unread}</span>}
          </span>
        )}
      </button>

      <div className="fork-section-actions" style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          type="button"
          onClick={onNewChat}
          disabled={busy}
          title={t("sidebar.newChat")}
          aria-label={t("sidebar.newChat")}
          style={iconButtonStyle}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onConfigure}
          disabled={busy}
          title={t("sidebar.setChatWorkspace")}
          aria-label={t("sidebar.setChatWorkspace")}
          style={iconButtonStyle}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? t("sidebar.collapseSubagents") : t("sidebar.expandSubagents")}
          style={iconButtonStyle}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
