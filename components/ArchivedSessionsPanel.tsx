"use client";

/**
 * fork:ui-archive-history — 归档历史（Zeno 设置 → 数据 → 归档 的那一页）。
 *
 * 之前归档是**单向**的：行从项目列表里消失，落到项目底部的折叠区；折叠区又藏在长列表
 * 最下面，等于「归档后找不回来」。Zeno 的做法是把归档做成设置里的一个数据页：按项目
 * 分组列出所有已归档会话，每条都能「恢复」或「彻底删除」。
 *
 * 这里照同样的形状：
 *   - 数据源是 `lib/session-flags.ts` 的 `archived` + `archivedAt`（本地、跨标签页同步）；
 *   - 会话标题/项目从 `/api/sessions` 取；文件已经不在的归档项照样列出来（按 id 显示）；
 *   - 「恢复」= 取消归档（行回到项目列表）；「删除」= 删掉会话文件（二次确认）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSessionFlags } from "@/lib/session-flags";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";

interface ArchivedRow {
  id: string;
  title: string;
  projectLabel: string;
  archivedAt: string | null;
  /** 文件还在（能打开、能删）。 */
  live: boolean;
}

function projectLabelOf(session: SessionInfo): string {
  const root = session.projectRoot || session.cwd || "";
  const parts = root.split(/[/\\]/).filter(Boolean);
  return parts.at(-1) ?? root;
}

export function ArchivedSessionsPanel({
  onOpenSession,
  onSessionsChanged,
}: {
  onOpenSession?: (id: string) => void;
  onSessionsChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const { flags, archive } = useSessionFlags();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions?: SessionInfo[] };
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<ArchivedRow[]>(() => {
    const byId = new Map((sessions ?? []).map((session) => [session.id, session]));
    const list: ArchivedRow[] = flags.archived.map((id) => {
      const session = byId.get(id);
      return {
        id,
        title: session?.name || session?.firstMessage?.slice(0, 80) || id,
        projectLabel: session ? projectLabelOf(session) : t("settings.archivedMissingProject"),
        archivedAt: flags.archivedAt[id] ?? null,
        live: Boolean(session),
      };
    });
    // 新的在前；没有时间戳的老条目排在最后（保持它们在 id 列表里的相对顺序）。
    return list.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  }, [flags.archived, flags.archivedAt, sessions, t]);

  const grouped = useMemo(() => {
    const map = new Map<string, ArchivedRow[]>();
    for (const row of rows) {
      const bucket = map.get(row.projectLabel);
      if (bucket) bucket.push(row);
      else map.set(row.projectLabel, [row]);
    }
    return [...map.entries()];
  }, [rows]);

  const restore = (id: string) => {
    archive(id); // toggle → 取消归档
    onSessionsChanged?.();
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 文件删掉了，归档标记也要清掉，否则它会永远留在「文件已不存在」那一类里。
      if (flags.archived.includes(id)) archive(id);
      setPendingDelete(null);
      await load();
      onSessionsChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const missing = rows.filter((row) => !row.live);
  const visibleRows = showDeleted ? rows : rows.filter((row) => row.live);

  return (
    <div className="settings-general-section">
      <section className="fork-settings-block">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h3 className="fork-settings-block-label">{t("settings.archivedTitle")}</h3>
          {rows.length > 0 && (
            <ConfigSwitch
              checked={showDeleted}
              label={t("settings.archivedShowMissing", { count: missing.length })}
              onChange={setShowDeleted}
            />
          )}
        </div>
        <p className="settings-pi-theme-description">{t("settings.archivedDescription")}</p>

        {error && <p className="settings-general-error" role="alert">{error}</p>}

        {sessions === null && <p className="settings-pi-theme-note">{t("i18n.loading")}</p>}

        {sessions !== null && visibleRows.length === 0 && (
          <p className="settings-pi-theme-note">{t("settings.archivedEmpty")}</p>
        )}

        {grouped.map(([project, group]) => {
          const shown = group.filter((row) => showDeleted || row.live);
          if (shown.length === 0) return null;
          return (
            <div key={project} className="settings-archived-group">
              <div className="settings-archived-group-label">{project}</div>
              {shown.map((row) => (
                <div key={row.id} className="settings-archived-row" data-missing={row.live ? undefined : "true"}>
                  <button
                    type="button"
                    className="settings-archived-title"
                    title={row.id}
                    disabled={!row.live || !onOpenSession}
                    onClick={() => onOpenSession?.(row.id)}
                  >
                    <span className="settings-archived-name">{row.title}</span>
                    <span className="settings-archived-meta">
                      {row.archivedAt
                        ? t("settings.archivedAt", { time: formatRelativeTime(new Date(row.archivedAt), locale) })
                        : t("settings.archivedAtUnknown")}
                    </span>
                  </button>
                  <div className="settings-archived-actions">
                    <ConfigButton
                      variant="secondary"
                      size="small"
                      onClick={() => restore(row.id)}
                      disabled={busyId === row.id}
                    >
                      {t("settings.archivedRestore")}
                    </ConfigButton>
                    {row.live && (pendingDelete === row.id ? (
                      <>
                        <ConfigButton
                          variant="danger"
                          size="small"
                          onClick={() => void remove(row.id)}
                          disabled={busyId === row.id}
                        >
                          {t("settings.archivedDeleteConfirm")}
                        </ConfigButton>
                        <ConfigButton variant="ghost" size="small" onClick={() => setPendingDelete(null)}>
                          {t("i18n.cancel")}
                        </ConfigButton>
                      </>
                    ) : (
                      <ConfigButton variant="ghost" size="small" onClick={() => setPendingDelete(row.id)}>
                        {t("settings.archivedDelete")}
                      </ConfigButton>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}
