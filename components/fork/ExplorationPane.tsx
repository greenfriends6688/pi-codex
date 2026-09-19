"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import { MessageView } from "../MessageView";
import { ExplorationBanner } from "./ExplorationBanner";

/**
 * fork:proma-05-explore — 右栏的探索分支视图（只读）。
 *
 * 规格要的是「分支在右栏以独立 tab 打开、可与主线并排看」。这里刻意**不做**第二个可交互
 * 的聊天面板：那要把 ChatWindow 的全套接线（SSE、composer、模型选择……）在右栏再搭一遍，
 * 成本高且容易和主线状态打架。要做到的是「边看主线边看分支、看完就带回」：
 *
 * - 只读渲染分支转录（复用主线同款 `MessageView`，所以工具卡/排版一致）；
 * - 抬头条也在这里（所以**不用离开主线**就能把结论带回父会话草稿）；
 * - 想接着聊就「在主线打开」，走既有的 ?session= 路由。
 */
export function ExplorationPane({
  sessionId,
  parentSessionId,
  onOpenAsMain,
}: {
  sessionId: string;
  /** 已知父会话时传进来：抬头条要它来推「从哪条消息探索来的」。 */
  parentSessionId?: string | null;
  onOpenAsMain?: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [context, setContext] = useState<{ messages: AgentMessage[]; entryIds: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContext(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { context?: { messages?: AgentMessage[]; entryIds?: string[] } };
        if (cancelled) return;
        setContext({ messages: data.context?.messages ?? [], entryIds: data.context?.entryIds ?? [] });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const toolResults = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const message of context?.messages ?? []) {
      if (message.role === "toolResult") {
        map.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
      }
    }
    return map;
  }, [context]);

  return (
    <div style={{ height: "100%", minWidth: 0, overflowY: "auto", padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: TEXT.sm, color: "var(--text)" }}>{t("explore.title")}</strong>
        <span style={{ flex: 1 }} />
        {onOpenAsMain && (
          <button
            type="button"
            onClick={() => onOpenAsMain(sessionId)}
            title={t("explore.openInMain")}
            style={{
              padding: "3px 8px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: TEXT.xs,
            }}
          >
            {t("explore.openInMain")}
          </button>
        )}
      </div>

      {error && <div role="alert" style={{ fontSize: TEXT.sm, color: "var(--danger)" }}>{t("explore.paneFailed")}：{error}</div>}
      {!error && context === null && <div style={{ fontSize: TEXT.sm, color: "var(--text-dim)" }}>{t("i18n.loading")}</div>}

      {context && (
        <>
          {parentSessionId && (
            <ExplorationBanner
              branchSessionId={sessionId}
              parentSessionId={parentSessionId}
              branchEntryIds={context.entryIds}
              branchMessages={context.messages}
              onOpenParent={onOpenAsMain}
            />
          )}
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            {context.messages.map((message, index) => (
              <MessageView
                key={context.entryIds[index] ?? index}
                message={message}
                toolResults={toolResults}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
