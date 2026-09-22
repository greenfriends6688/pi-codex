"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { TEXT } from "@/lib/typography";
import type { SessionStatsInfo } from "@/lib/pi-types";
// fork:zm-04 — token / 成本 / 耗时这些数字变化时逐位滚动，而不是整串跳。
import { RollingNumber } from "./fork/RollingNumber";

/**
 * fork:ui-stats-inline — 会话统计从「聊天区右上角按钮 + 悬浮面板」搬到
 * composer 下方的状态条右侧（用户指定：贴着输入框下面）。
 *
 * 原来那块信息挂在顶栏，离用户视线远，且展开是一个盖住消息区的浮层；
 * 现在折叠态只有一行紧凑数字，展开态在输入框正下方就地铺开，读完就能继续打字。
 */

type SessionCopyField = "file" | "id" | "projectDir" | "gitBranch" | "gitWorktree";

export interface ContextUsageInfo {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

/** 只取面板要展示的字段，避免把整个 SessionInfo 拖进这个纯展示组件。 */
export interface SessionStatsSessionInfo {
  projectRoot?: string | null;
  cwd: string;
  branch?: string | null;
  isWorktree?: boolean;
}

interface SessionStatsBarProps {
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsageInfo | null;
  session: SessionStatsSessionInfo | null;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
}

export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

export function formatStatsDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 缓存命中率 = 缓存读 / (输入 + 缓存写 + 缓存读)，分母覆盖所有输入类 token。 */
export function cacheHitRate(tokens: SessionStatsInfo["tokens"]): number | null {
  const denominator = tokens.cacheRead + tokens.cacheWrite + tokens.input;
  if (tokens.cacheRead + tokens.cacheWrite <= 0 || denominator <= 0) return null;
  return (tokens.cacheRead / denominator) * 100;
}

/**
 * 上下文占用圆环（fork:ui-stats-inline）。
 *
 * 环长 = 占用率，颜色继承当前文字色（由外层的 `contextColor` 按档位给色）；
 * 轨道用同色 25% 透明，所以深浅主题下都不用单独配色。
 */
function ContextRing({ percent, size = 13 }: { percent: number | null; size?: number }) {
  const radius = (size - 3) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, percent ?? 0));
  const center = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}

export function SessionStatsBar({ sessionStats, contextUsage, session, expanded, onToggle }: SessionStatsBarProps) {
  const { t, locale } = useI18n();
  const [copiedField, setCopiedField] = useState<SessionCopyField | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const handleCopy = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopiedField(field);
      copyTimerRef.current = setTimeout(() => setCopiedField(null), 1400);
    });
  }, []);

  const tokens = sessionStats?.tokens;
  const cost = sessionStats?.cost ?? 0;
  const costText = cost > 0 ? (cost >= 0.01 ? `$${cost.toFixed(2)}` : "<$0.01") : null;
  const totalMessages = sessionStats?.totalMessages ?? 0;

  const ctx = contextUsage ?? sessionStats?.contextUsage ?? null;

  const contextColor = useMemo(() => {
    if (ctx?.percent !== null && ctx?.percent !== undefined) {
      if (ctx.percent > 90) return "var(--danger)";
      if (ctx.percent > 70) return "var(--warning)";
    }
    return "var(--text-muted)";
  }, [ctx?.percent]);

  const contextText = ctx?.contextWindow
    ? ctx.percent !== null
      ? `${ctx.percent.toFixed(0)}% / ${formatCompactTokens(ctx.contextWindow)}`
      : `? / ${formatCompactTokens(ctx.contextWindow)}`
    : null;

  // 会话文件随消息数增长；几千条之后打开/切换会肉眼可见变慢，这里把阈值做成颜色提示。
  const messageCountColor = totalMessages > 5000
    ? "var(--danger)"
    : totalMessages > 2000
      ? "var(--warning)"
      : "var(--text-muted)";

  const hitRate = tokens ? cacheHitRate(tokens) : null;

  if (!sessionStats && !ctx) return null;

  const panelId = "session-stats-inline-panel";
  const formatNumber = (value: number) => value.toLocaleString(locale);

  const rows: Array<[string, ReactNode, SessionCopyField | null]> = [];
  if (sessionStats) {
    if (sessionStats.sessionName) rows.push([t("session.name"), sessionStats.sessionName, null]);
    rows.push([t("session.file"), sessionStats.sessionFile ?? t("session.inMemory"), "file"]);
    rows.push([t("session.id"), sessionStats.sessionId, "id"]);
    // fork:zm-04 — 耗时每秒都在变，滚动比跳字更不容易看成「页面在闪」。
    if ((sessionStats.totalActiveMs ?? 0) > 0) {
      rows.push([t("session.totalActive"), <RollingNumber key="active" value={formatStatsDuration(sessionStats.totalActiveMs ?? 0)} />, null]);
    }
    if (session) {
      rows.push([t("session.projectDir"), session.projectRoot ?? session.cwd, "projectDir"]);
      if (session.branch) rows.push([t("session.gitBranch"), session.branch, "gitBranch"]);
      if (session.isWorktree) rows.push([t("session.gitWorktree"), session.cwd, "gitWorktree"]);
    }
  }

  const messageRows: Array<[string, string]> = sessionStats ? [
    [t("session.user"), formatNumber(sessionStats.userMessages)],
    [t("session.assistant"), formatNumber(sessionStats.assistantMessages)],
    [t("session.toolCalls"), formatNumber(sessionStats.toolCalls)],
    [t("session.toolResults"), formatNumber(sessionStats.toolResults)],
    [t("session.total"), formatNumber(sessionStats.totalMessages)],
  ] : [];

  const tokenRows: Array<[string, string]> = tokens ? [
    [t("session.input"), formatNumber(tokens.input)],
    [t("session.output"), formatNumber(tokens.output)],
    ...(tokens.cacheRead > 0 ? [[t("session.cacheRead"), formatNumber(tokens.cacheRead)] as [string, string]] : []),
    ...(tokens.cacheWrite > 0 ? [[t("session.cacheWrite"), formatNumber(tokens.cacheWrite)] as [string, string]] : []),
    [t("session.total"), formatNumber(tokens.total)],
    ...(cost > 0 ? [[t("session.cost"), `$${cost.toFixed(4)}`] as [string, string]] : []),
    ...(ctx?.contextWindow
      ? [[t("session.context"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompactTokens(ctx.contextWindow)}`] as [string, string]]
      : []),
    ...(hitRate !== null ? [[t("session.cacheHitRate"), `${hitRate.toFixed(1)}%`] as [string, string]] : []),
  ] : [];

  const copyTitleKey: Record<SessionCopyField, string> = {
    file: "session.copyFile",
    id: "session.copyId",
    projectDir: "session.copyProjectDir",
    gitBranch: "session.copyGitBranch",
    gitWorktree: "session.copyGitWorktree",
  };

  const renderSection = (title: string, sectionRows: Array<[string, ReactNode, SessionCopyField | null]>) => (
    <div key={title} style={{ minWidth: 168, maxWidth: 320 }}>
      <div style={{ fontSize: TEXT.xs, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: 12, rowGap: 4 }}>
        {sectionRows.map(([label, value, copyField]) => (
          <div key={`${title}:${label}`} style={{ display: "contents" }}>
            <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, minWidth: 0 }}>
              <span style={{
                color: "var(--text-muted)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }} title={typeof value === "string" ? value : undefined}>{value}</span>
              {copyField && typeof value === "string" && (
                <button
                  type="button"
                  title={copiedField === copyField ? t("session.copied") : t(copyTitleKey[copyField])}
                  aria-label={copiedField === copyField ? t("session.copied") : t(copyTitleKey[copyField])}
                  onClick={() => handleCopy(copyField, value)}
                  style={{
                    flex: "0 0 auto",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    padding: 0,
                    color: copiedField === copyField ? "var(--accent)" : "var(--text-dim)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-xs)",
                    cursor: "pointer",
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {copiedField === copyField
                      ? <path d="m5 13 4 4L19 7" />
                      : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0, maxWidth: "100%" }}>
      <button
        type="button"
        onClick={() => onToggle(!expanded)}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        title={t("session.title")}
        aria-label={t("session.title")}
        className="session-stats-inline-toggle"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 24,
          padding: "0 8px",
          background: "none",
          border: "none",
          borderRadius: "var(--radius-xs)",
          color: "var(--text-muted)",
          fontSize: TEXT.xs,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          cursor: "pointer",
          transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; event.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.background = "none"; event.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4, color: messageCountColor, opacity: totalMessages ? 1 : 0.45 }}>
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 2.5 Q1 1 2.5 1 L7.5 1 Q9 1 9 2.5 L9 5 Q9 6.5 7.5 6.5 L4 6.5 L2 8.5 L2 6.5 Q1 6.5 1 5 Z" />
          </svg>
          <RollingNumber value={formatCompactTokens(totalMessages)} />
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, opacity: tokens?.input ? 1 : 0.45 }}>
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
          </svg>
          <RollingNumber value={formatCompactTokens(tokens?.input ?? 0)} />
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, opacity: tokens?.output ? 1 : 0.45 }}>
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
          </svg>
          <RollingNumber value={formatCompactTokens(tokens?.output ?? 0)} />
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, opacity: tokens?.cacheRead ? 1 : 0.45 }}>
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" />
          </svg>
          <RollingNumber value={formatCompactTokens(tokens?.cacheRead ?? 0)} />
        </span>
        <span style={{ color: costText ? "var(--text)" : "var(--text-muted)", fontWeight: 500, opacity: costText ? 1 : 0.6 }}>
          {/* fork:zm-04 — 成本是最常变的数字（每轮都涨），适合逐位滚动。 */}
          <RollingNumber value={costText ?? "$0.00"} />
        </span>
        {/* fork:ui-stats-inline — 平均缓存命中率也从明细里提到这一行：它是唯一能
            一眼看出“缓存有没有在起作用”的数字，藏在面板里没人看。 */}
        {hitRate !== null && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="3" cy="3" r="1.3" /><circle cx="7" cy="7" r="1.3" /><line x1="7.6" y1="2.4" x2="2.4" y2="7.6" />
            </svg>
            {hitRate.toFixed(1)}%
          </span>
        )}
        {contextText && (
          <span
            style={{ display: "flex", alignItems: "center", gap: 4, color: contextColor }}
            title={`${t("session.context")}${ctx?.tokens != null ? ` · ${ctx.tokens.toLocaleString()} tokens` : ""}`}
          >
            {/* 上下文占用：圆环（环长 = 占用率，颜色随档位）+ 百分比/窗口数字。 */}
            <ContextRing percent={ctx?.percent ?? null} />
            {contextText}
          </span>
        )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        >
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>

      {expanded && (
        <div
          id={panelId}
          role="region"
          aria-label={t("session.title")}
          style={{
            // fork:ui-stats-inline — 往上打开：面板贴在统计行上方浮起，不再把
            // 内容往下撑（原来展开后整块贴着屏幕底边，越展开越挤）。
            position: "absolute",
            bottom: "calc(100% + 6px)",
            right: 0,
            zIndex: 40,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: "14px 28px",
            width: "max-content",
            maxWidth: "min(760px, 92vw)",
            maxHeight: "min(60vh, 440px)",
            overflowY: "auto",
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-elev)",
            boxShadow: "var(--shadow-lg)",
            fontSize: TEXT.sm,
            lineHeight: 1.5,
            textAlign: "left",
          }}
        >
          {rows.length > 0 && renderSection(t("session.infoSection"), rows)}
          {messageRows.length > 0 && renderSection(t("session.messages"), messageRows.map(([label, value]) => [label, value, null] as [string, string, SessionCopyField | null]))}
          {tokenRows.length > 0 && renderSection(t("session.tokens"), tokenRows.map(([label, value]) => [label, value, null] as [string, string, SessionCopyField | null]))}
        </div>
      )}
    </div>
  );
}
