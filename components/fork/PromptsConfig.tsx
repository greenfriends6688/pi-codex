"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton } from "../SettingsUi";
import { TEXT } from "@/lib/typography";
import type { PromptFile } from "@/lib/prompt-files";

/*
 * fork:zc-16 — management UI for `~/.pi/agent/prompts/*.md`.
 *
 * The slash palette already consumes the same directory, so there is no wiring
 * on the composer side: saving a prompt here makes `/name` available the next
 * time the palette is opened. The editor sends only `description` and `body`;
 * the route merges them surgically so hand-written frontmatter stays intact.
 */

interface EditorState {
  /** null while creating a new prompt. */
  originalName: string | null;
  name: string;
  description: string;
  body: string;
}

const EMPTY_EDITOR: EditorState = { originalName: null, name: "", description: "", body: "" };

export function PromptsConfig({ onOpenFile }: { onOpenFile?: (path: string) => void }): ReactNode {
  const { t } = useI18n();
  const [prompts, setPrompts] = useState<PromptFile[]>([]);
  const [dir, setDir] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/prompts", { cache: "no-store" });
      const data = await response.json() as { dir?: string; prompts?: PromptFile[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setPrompts(Array.isArray(data.prompts) ? data.prompts : []);
      setDir(data.dir ?? "");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return prompts;
    return prompts.filter((prompt) =>
      prompt.name.toLowerCase().includes(keyword)
      || prompt.description.toLowerCase().includes(keyword));
  }, [prompts, query]);

  const startCreate = () => {
    setMessage(null);
    setError(null);
    setEditor({ ...EMPTY_EDITOR });
  };

  const startEdit = (prompt: PromptFile) => {
    setMessage(null);
    setError(null);
    setEditor({
      originalName: prompt.name,
      name: prompt.name,
      description: prompt.description,
      body: prompt.body.replace(/^\n/, ""),
    });
  };

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const creating = editor.originalName === null;
      const response = await fetch("/api/prompts", {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editor.name,
          description: editor.description,
          body: editor.body,
        }),
      });
      const data = await response.json() as { prompt?: PromptFile; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setMessage(t(creating ? "prompts.created" : "prompts.saved"));
      if (data.prompt) {
        setEditor({
          originalName: data.prompt.name,
          name: data.prompt.name,
          description: data.prompt.description,
          body: data.prompt.body.replace(/^\n/, ""),
        });
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    if (typeof window !== "undefined" && !window.confirm(t("prompts.deleteConfirm", { name }))) return;
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/prompts?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (editor?.originalName === name) setEditor(null);
      setMessage(t("prompts.deleted"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("prompts.title")}</h2>
      <p className="settings-chat-range-hint" style={{ marginTop: -6 }}>{t("prompts.subtitle")}</p>
      {dir && <p className="settings-chat-range-hint" style={{ marginTop: -2, fontFamily: "var(--font-mono)", fontSize: TEXT.xs }}>{dir}</p>}

      <section className="settings-general-section">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("prompts.search")}
            aria-label={t("prompts.search")}
            maxLength={60}
            className="settings-search-input"
            style={{ flex: 1, minWidth: 0 }}
          />
          <ConfigButton variant="primary" size="small" onClick={startCreate}>
            {t("prompts.new")}
          </ConfigButton>
        </div>

        {loading && <p role="status" className="settings-chat-range-hint">{t("i18n.loading")}</p>}
        {!loading && filtered.length === 0 && (
          <p role="status" className="settings-chat-range-hint">{query.trim() ? t("prompts.noMatch") : t("prompts.empty")}</p>
        )}

        <div style={{ display: "grid", gap: 4 }}>
          {filtered.map((prompt) => (
            <div
              key={prompt.name}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 9px",
                border: "1px solid var(--border-faint)", borderRadius: "var(--radius-md)",
                background: editor?.originalName === prompt.name ? "var(--bg-selected)" : "var(--bg-panel)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 1 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: TEXT.sm, color: "var(--text)" }}>
                  /{prompt.name}
                </span>
                <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {prompt.description || t("prompts.noDescription")}
                  {` · ${prompt.size} B · ${new Date(prompt.mtime).toLocaleString()}`}
                </span>
              </span>
              {onOpenFile && (
                <ConfigButton variant="ghost" size="small" onClick={() => onOpenFile(`${dir}/${prompt.name}.md`)}>
                  {t("prompts.openInViewer")}
                </ConfigButton>
              )}
              <ConfigButton variant="secondary" size="small" onClick={() => startEdit(prompt)}>
                {t("i18n.edit")}
              </ConfigButton>
              <ConfigButton variant="ghost" size="small" onClick={() => void remove(prompt.name)}>
                {t("i18n.delete")}
              </ConfigButton>
            </div>
          ))}
        </div>
        <p className="settings-chat-range-hint">{t("prompts.paletteHint")}</p>
      </section>

      {editor && (
        <section className="settings-general-section">
          <h3 className="settings-general-heading">
            {editor.originalName === null ? t("prompts.newTitle") : t("prompts.editTitle", { name: editor.originalName })}
          </h3>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)" }}>{t("prompts.name")}</span>
              <input
                className="settings-field-input"
                value={editor.name}
                disabled={editor.originalName !== null}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                placeholder="review"
                spellCheck={false}
              />
              <span className="settings-chat-range-hint" style={{ margin: 0 }}>{t("prompts.nameHint")}</span>
            </label>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)" }}>{t("prompts.description")}</span>
              <input
                className="settings-field-input"
                value={editor.description}
                onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                placeholder={t("prompts.descriptionPlaceholder")}
              />
              <span className="settings-chat-range-hint" style={{ margin: 0 }}>{t("prompts.descriptionHint")}</span>
            </label>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)" }}>{t("prompts.body")}</span>
              <textarea
                className="settings-field-input"
                value={editor.body}
                onChange={(event) => setEditor({ ...editor, body: event.target.value })}
                spellCheck={false}
                style={{ minHeight: 200, fontFamily: "var(--font-mono)", fontSize: TEXT.sm, lineHeight: 1.55, resize: "vertical" }}
              />
              <span className="settings-chat-range-hint" style={{ margin: 0 }}>{t("prompts.bodyHint")}</span>
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <ConfigButton variant="primary" size="small" disabled={saving || editor.name.trim() === ""} onClick={() => void save()}>
                {saving ? t("prompts.saving") : t("i18n.save")}
              </ConfigButton>
              {editor.originalName !== null && (
                <ConfigButton variant="danger" size="small" disabled={saving} onClick={() => void remove(editor.originalName!)}>
                  {t("i18n.delete")}
                </ConfigButton>
              )}
              <ConfigButton variant="ghost" size="small" onClick={() => setEditor(null)}>
                {t("i18n.cancel")}
              </ConfigButton>
            </div>
          </div>
        </section>
      )}

      {message && <p role="status" style={{ margin: 0, fontSize: TEXT.sm, color: "var(--text)" }}>{message}</p>}
      {error && <p role="alert" className="settings-general-error">{error}</p>}
    </div>
  );
}
