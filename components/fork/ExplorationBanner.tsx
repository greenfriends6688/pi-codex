"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getDraft, setDraft } from "@/lib/draft-store";
import { TEXT } from "@/lib/typography";
import {
  deriveExplorationOrigin,
  explorationDelta,
  planBringBack,
  type ExplorationMessageLike,
} from "@/lib/exploration";

/**
 * fork:proma-05-explore — 探索分支的抬头条。
 *
 * 当前会话是「从某条主线消息 fork 出来的分支」时显示：来源那条消息 + 一个「带回结论」。
 *
 * - **来源不靠元数据**：父子 entry id 的公共前缀就是被复制过来那段历史（见
 *   `lib/exploration.ts` 的说明），所以这里只需要拉父会话的 context 比一下。
 * - **带回结论只写草稿、不自动发送**：把 fork 点之后的 assistant 文本追加到父会话草稿，
 *   并带上一条 `&session:<分支 id>` 引用，然后切到父会话让用户自己决定发不发。
 * - 拉不到父会话 / 推不出来源时**什么都不显示**：宁可不显示，也不要给一个假来源。
 */
export function ExplorationBanner({
  branchSessionId,
  parentSessionId,
  branchEntryIds,
  branchMessages,
  onOpenParent,
}: {
  branchSessionId: string;
  parentSessionId: string;
  branchEntryIds: readonly string[];
  branchMessages: readonly ExplorationMessageLike[];
  onOpenParent?: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [parent, setParent] = useState<{ entryIds: string[]; messages: ExplorationMessageLike[] } | null>(null);
  const [broughtBack, setBroughtBack] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(parentSessionId)}/context`);
        if (!res.ok) return;
        const data = await res.json() as { context?: { messages?: ExplorationMessageLike[]; entryIds?: string[] } };
        if (cancelled || !data.context?.entryIds) return;
        setParent({ entryIds: data.context.entryIds, messages: data.context.messages ?? [] });
      } catch {
        // 父会话读不到就当不是探索分支（不显示比显示错好）
      }
    })();
    return () => { cancelled = true; };
  }, [parentSessionId]);

  const origin = useMemo(() => (parent
    ? deriveExplorationOrigin({
      parentSessionId,
      parentEntryIds: parent.entryIds,
      parentMessages: parent.messages,
      branchEntryIds,
    })
    : null), [parent, parentSessionId, branchEntryIds]);

  const delta = useMemo(() => explorationDelta({
    branchEntryIds,
    branchMessages,
    boundaryEntryId: origin?.boundaryEntryId ?? null,
  }), [branchEntryIds, branchMessages, origin?.boundaryEntryId]);

  if (!origin) return null;

  const canBringBack = delta.assistantMessages > 0;
  const sourceLabel = origin.sourceLabel || t("explore.fromStart");

  const handleBringBack = () => {
    const existing = getDraft(parentSessionId);
    const plan = planBringBack({ delta, branch: { id: branchSessionId }, existingText: existing?.value });
    if (!plan) return;
    setDraft(parentSessionId, {
      value: plan.value,
      images: existing?.images ?? [],
      ...(existing?.contexts ? { contexts: existing.contexts } : {}),
      sessionReferences: [
        ...(existing?.sessionReferences ?? []).filter((reference) => reference.id !== plan.sessionReference.id),
        plan.sessionReference,
      ],
    });
    setBroughtBack(true);
    onOpenParent?.(parentSessionId);
  };

  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        margin: "0 0 10px",
        padding: "6px 10px",
        border: "1px solid var(--accent-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--accent-soft)",
        fontSize: TEXT.sm,
        color: "var(--text)",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: TEXT.md, lineHeight: 1 }}>⑂</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
        <strong style={{ fontWeight: 600 }}>{t("explore.title")}</strong>
        <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420 }}>
          {t("explore.from", { label: sourceLabel })}
        </span>
      </span>
      <span style={{ flex: 1 }} />
      {broughtBack && <span role="status" style={{ fontSize: TEXT.xs, color: "var(--text-muted)" }}>{t("explore.broughtBack")}</span>}
      {!broughtBack && !canBringBack && (
        <span style={{ fontSize: TEXT.xs, color: "var(--text-muted)" }}>{t("explore.nothingYet")}</span>
      )}
      {onOpenParent && (
        <button
          type="button"
          onClick={() => onOpenParent(parentSessionId)}
          title={t("explore.openParent")}
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
          {t("explore.openParent")}
        </button>
      )}
      <button
        type="button"
        onClick={handleBringBack}
        disabled={!canBringBack}
        title={t("explore.bringBackHint")}
        style={{
          padding: "3px 10px",
          background: canBringBack ? "var(--accent)" : "var(--bg-subtle)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          color: canBringBack ? "var(--accent-contrast, #fff)" : "var(--text-dim)",
          cursor: canBringBack ? "pointer" : "not-allowed",
          fontSize: TEXT.xs,
          fontWeight: 500,
        }}
      >
        {t("explore.bringBack")}
      </button>
    </div>
  );
}
