"use client";

/**
 * fork:ui-history-panel — 「完整历史」的顶栏面板（原来会新开一个标签页）。
 *
 * 原实现是 `window.open('/api/sessions/<id>/export?inline=1')`：跳出去、脱离应用外壳、
 * 回来看会话还得再切回来。工具/系统提示词那几个按钮早就是顶栏面板了，这个没有理由例外。
 *
 * 面板拉一次完整的会话上下文（`tail=1000`，路由的上限），用与聊天区同一个 `MessageView`
 * 渲染，所以样式、工具卡、思考块、markdown 全都是原样，不需要第二套渲染器。
 * 只读：不传 fork / rewind / 编辑回调，避免在「看历史」的地方出现破坏性操作。
 */

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { normalizeToolCalls } from "@/lib/normalize";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import { MessageView } from "./MessageView";

const HISTORY_TAIL_LIMIT = 1000;

interface HistoryData {
  messages: AgentMessage[];
  modelNames?: Record<string, string>;
  /** 服务端按 tail 截断过（还有更早的历史没拉下来）。 */
  truncated: boolean;
}

export function SessionHistoryPanel({
  sessionId,
  cwd,
  onOpenFile,
  onOpenSession,
}: {
  sessionId: string;
  cwd?: string;
  onOpenFile?: (path: string, page?: number) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?tail=${HISTORY_TAIL_LIMIT}&deferThinking=1`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as {
          context?: { messages?: AgentMessage[]; hasMore?: boolean };
          modelNames?: Record<string, string>;
        };
        if (cancelled) return;
        const messages = (body.context?.messages ?? []).map((message) => normalizeToolCalls(message));
        setData({
          messages,
          modelNames: body.modelNames,
          truncated: Boolean(body.context?.hasMore),
        });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const toolResults = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const message of data?.messages ?? []) {
      if (message.role === "toolResult") map.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
    }
    return map;
  }, [data?.messages]);

  const rows = useMemo(
    () => (data?.messages ?? []).filter((message) => message.role !== "toolResult"),
    [data?.messages],
  );

  return (
    <section className="session-history-panel" aria-label={t("history.full")}>
      <div className="session-history-scroll">
        {error && <div className="session-history-note is-error" role="alert">{error}</div>}
        {!data && !error && <div className="session-history-note">{t("i18n.loading")}</div>}
        {data && data.truncated && (
          <div className="session-history-note">{t("history.truncated", { count: HISTORY_TAIL_LIMIT })}</div>
        )}
        {data && rows.length === 0 && <div className="session-history-note">{t("history.empty")}</div>}
        {rows.map((message, index) => (
          <MessageView
            key={`history-${index}`}
            message={message}
            toolResults={toolResults}
            modelNames={data?.modelNames}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onOpenSession={onOpenSession}
            showTimestamp
          />
        ))}
      </div>
    </section>
  );
}
