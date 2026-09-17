"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton, ConfigSwitch } from "../SettingsUi";

/*
 * fork:memory — the saved-memory page inside Settings.
 *
 * Everything here is user-facing bookkeeping for lib/memory-store.ts: the agent
 * writes through the `remember` tool, this page is where a person audits it (and
 * fixes or deletes what the model got wrong). The scope selector decides whether a
 * new note applies everywhere or only to this project.
 */

interface MemoryEntryView {
  id: string;
  text: string;
  scope: string;
  source: "user" | "agent";
  createdAt: string;
}

export function MemoryConfig({ cwd }: { cwd?: string | null }): ReactNode {
  const { t } = useI18n();
  const [entries, setEntries] = useState<MemoryEntryView[]>([]);
  const [stats, setStats] = useState<{ total: number; global: number; projectCount: number; characters: number; fromUser: number; fromAgent: number } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [autoLearn, setAutoLearn] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [scope, setScope] = useState<string>("global");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory", { cache: "no-store" });
      const data = await res.json() as { settings?: { enabled?: boolean; autoLearn?: boolean }; entries?: MemoryEntryView[]; stats?: typeof stats; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setEnabled(data.settings?.enabled === true);
      setAutoLearn(data.settings?.autoLearn === true);
      setEntries(data.entries ?? []);
      setStats(data.stats ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (cwd) setScope((current) => (current === "global" ? cwd : current));
  }, [cwd]);

  const patchSettings = async (next: { enabled?: boolean; autoLearn?: boolean }) => {
    // Optimistic: the switches are the point of this page, and a toggle that lags a
    // round-trip reads as broken.
    if (next.enabled !== undefined) setEnabled(next.enabled);
    if (next.autoLearn !== undefined) setAutoLearn(next.autoLearn);
    try {
      const res = await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: next }),
      });
      const data = await res.json() as { settings?: { enabled?: boolean; autoLearn?: boolean } };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEnabled(data.settings?.enabled === true);
      setAutoLearn(data.settings?.autoLearn === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    }
  };

  const runAction = async (action: "consolidate" | "clear" | "export") => {
    if (action === "clear" && !window.confirm(t("memory.clearConfirm"))) return;
    setBusyAction(action);
    setActionMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json() as { removed?: number; path?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (action === "consolidate") setActionMessage(t("memory.consolidated", { count: String(data.removed ?? 0) }));
      if (action === "clear") setActionMessage(t("memory.cleared", { count: String(data.removed ?? 0) }));
      if (action === "export") setActionMessage(t("memory.exportDone", { path: data.path ?? "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  };

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, scope }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setText("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (!editingText.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text: editingText }),
      });
      setEditingId(null);
      setEditingText("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  // The injected block, rendered with the same rule the extension uses (project
  // section first, then global) so the preview cannot drift from the real thing.
  const previewText = (() => {
    const scoped = cwd ? entries.filter((entry) => entry.scope === cwd) : [];
    const global = entries.filter((entry) => entry.scope === "global");
    const blocks: string[] = [];
    if (scoped.length > 0) blocks.push(`## Project memory\n${scoped.map((entry) => `- ${entry.text}`).join("\n")}`);
    if (global.length > 0) blocks.push(`${scoped.length > 0 ? "## Global memory" : "## Memory"}\n${global.map((entry) => `- ${entry.text}`).join("\n")}`);
    return blocks.join("\n\n");
  })();

  const scopeLabel = (value: string) => (value === "global" ? t("memory.scopeGlobal") : value.split(/[\\/]/).pop() || value);

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("memory.title")}</h2>
      <p className="settings-chat-range-hint" style={{ marginTop: -6 }}>{t("memory.subtitle")}</p>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.switches")}</h3>
        <div className="settings-chat-option settings-chat-range-option">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="settings-chat-option-label" style={{ flex: 1, minWidth: 0 }}>{t("memory.enable")}</span>
            <ConfigSwitch label={t("memory.enable")} checked={enabled} onChange={(next) => void patchSettings({ enabled: next, ...(next ? {} : { autoLearn: false }) })} />
          </div>
          <p className="settings-chat-range-hint">{t("memory.enableHint")}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <span className="settings-chat-option-label" style={{ flex: 1, minWidth: 0 }}>{t("memory.autoLearn")}</span>
            <ConfigSwitch label={t("memory.autoLearn")} checked={autoLearn} disabled={!enabled} onChange={(next) => void patchSettings({ autoLearn: next })} />
          </div>
          <p className="settings-chat-range-hint">{t("memory.autoLearnHint")}</p>
          <p
            role="status"
            style={{ marginTop: 10, fontSize: 12, color: enabled ? "var(--text)" : "var(--text-dim)" }}
          >
            {enabled
              ? `${t("memory.statusOn")} · ${autoLearn ? t("memory.statusAuto") : t("memory.statusManual")} · ${t("memory.saved", { count: entries.length })}`
              : t("memory.statusOff")}
          </p>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.add")}</h3>
        <div className="settings-chat-option settings-chat-range-option" style={{ display: "grid", gap: 8 }}>
          <textarea
            className="settings-field-input"
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("memory.placeholder")}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select className="settings-select" value={scope} aria-label={t("memory.scope")} onChange={(event) => setScope(event.target.value)}>
              <option value="global">{t("memory.scopeGlobal")}</option>
              {cwd && <option value={cwd}>{t("memory.scopeProject")} · {scopeLabel(cwd)}</option>}
            </select>
            <ConfigButton variant="primary" size="small" disabled={busy || !text.trim()} onClick={() => void add()}>
              {t("memory.save")}
            </ConfigButton>
          </div>
          <p className="settings-chat-range-hint">{t("memory.hint")}</p>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.maintenance")}</h3>
        <div className="settings-chat-option settings-chat-range-option">
          {stats && (
            <>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text)" }}>
                {t("memory.stats", { total: String(stats.total), global: String(stats.global), projectCount: String(stats.projectCount), characters: String(stats.characters) })}
              </p>
              <p style={{ margin: "2px 0 8px", fontSize: 11.5, color: "var(--text-dim)" }}>
                {t("memory.statsSources", { user: String(stats.fromUser), agent: String(stats.fromAgent) })}
              </p>
            </>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <ConfigButton variant="secondary" size="small" disabled={busyAction !== null || entries.length === 0} onClick={() => void runAction("consolidate")}>
              {t("memory.consolidate")}
            </ConfigButton>
            <ConfigButton variant="secondary" size="small" disabled={busyAction !== null || entries.length === 0} onClick={() => void runAction("export")}>
              {t("memory.export")}
            </ConfigButton>
            <ConfigButton variant="ghost" size="small" disabled={busyAction !== null || entries.length === 0} onClick={() => void runAction("clear")}>
              {t("memory.clearAll")}
            </ConfigButton>
          </div>
          <p className="settings-chat-range-hint">{t("memory.consolidateHint")}</p>
          {actionMessage && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--text)" }}>{actionMessage}</p>}
          {entries.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>{t("memory.preview")}</summary>
              <pre style={{ marginTop: 6, maxHeight: 180, overflow: "auto", padding: "8px 10px", border: "1px solid var(--border-faint)", borderRadius: "var(--radius-sm)", background: "var(--bg)", fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
{previewText}
              </pre>
            </details>
          )}
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.saved", { count: entries.length })}</h3>
        {entries.length > 4 && (
          <input
            className="settings-field-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("memory.searchPlaceholder")}
            aria-label={t("memory.searchPlaceholder")}
            style={{ marginBottom: 8 }}
          />
        )}
        {loading && <p className="settings-chat-range-hint">{t("memory.loading")}</p>}
        {!loading && entries.length === 0 && <p className="settings-chat-range-hint">{t("memory.empty")}</p>}
        <div style={{ display: "grid", gap: 6 }}>
          {entries
            .filter((entry) => {
              const needle = query.trim().toLowerCase();
              if (!needle) return true;
              return entry.text.toLowerCase().includes(needle) || entry.scope.toLowerCase().includes(needle);
            })
            .map((entry) => (
            <div
              key={entry.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                alignItems: "start",
                padding: "8px 10px",
                border: "1px solid var(--border-faint)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-panel)",
              }}
            >
              <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
                {editingId === entry.id ? (
                  <textarea
                    className="settings-field-input"
                    rows={2}
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    style={{ resize: "vertical", fontFamily: "inherit" }}
                  />
                ) : (
                  <span style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{entry.text}</span>
                )}
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {scopeLabel(entry.scope)} · {t(`memory.source.${entry.source}`)} · {new Date(entry.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {editingId === entry.id ? (
                  <>
                    <ConfigButton variant="primary" size="small" disabled={busy} onClick={() => void saveEdit(entry.id)}>{t("i18n.save")}</ConfigButton>
                    <ConfigButton variant="ghost" size="small" onClick={() => { setEditingId(null); setEditingText(""); }}>{t("i18n.cancel")}</ConfigButton>
                  </>
                ) : (
                  <>
                    <ConfigButton variant="secondary" size="small" disabled={busy} onClick={() => { setEditingId(entry.id); setEditingText(entry.text); }}>
                      {t("memory.edit")}
                    </ConfigButton>
                    <ConfigButton variant="ghost" size="small" title={t("memory.delete")} aria-label={t("memory.delete")} disabled={busy} onClick={() => void remove(entry.id)}>
                      ×
                    </ConfigButton>
                  </>
                )}
              </div>
            </div>
            ))}
        </div>
      </section>

      {error && <p role="alert" className="settings-general-error">{error}</p>}
    </div>
  );
}
