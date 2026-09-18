"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton, ConfigSwitch } from "../SettingsUi";
import { PI_MEMORY_PACKAGE_SOURCE, PI_MEMORY_TEMPLATES, PI_MEMORY_TOOLS } from "@/lib/pi-memory";

/*
 * fork:memory-panel — settings page for the pi-memory package.
 *
 * This fork does not implement memory itself: `npm:pi-memory` (official pi package
 * directory) provides the tools, the markdown files and the injection, and it works
 * in the TUI too. What the panel adds is the three things a UI is good at:
 *
 *   1. one switch that says whether memory is on (the package's enabled flag, so a
 *      disabled memory means the tools are not even registered);
 *   2. the *shape* of the memory — MEMORY.md / SCRATCHPAD.md / today's log are listed
 *      even before they exist, with a one-click create, because an empty directory
 *      used to make the whole feature look missing;
 *   3. reading and hand-editing those files, and opening them in the main file
 *      viewer where the markdown editor lives.
 */

interface MemoryFileInfo {
  path: string;
  size: number;
  mtime: string;
  exists: boolean;
}

interface PluginPackageView {
  source: string;
  version?: string;
  disabled?: boolean;
}

export function PiMemoryConfig({
  cwd,
  onOpenFile,
}: {
  cwd?: string | null;
  onOpenFile?: (path: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [pkg, setPkg] = useState<PluginPackageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [files, setFiles] = useState<MemoryFileInfo[]>([]);
  const [dir, setDir] = useState("");
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const [pluginsRes, filesRes] = await Promise.all([
        fetch(`/api/plugins?cwd=${encodeURIComponent(cwd ?? "")}`, { cache: "no-store" }),
        fetch("/api/memory/files", { cache: "no-store" }),
      ]);
      const plugins = await pluginsRes.json() as { packages?: PluginPackageView[] };
      const filesData = await filesRes.json() as { dir?: string; files?: MemoryFileInfo[] };
      setPkg((plugins.packages ?? []).find((entry) => entry.source === PI_MEMORY_PACKAGE_SOURCE) ?? null);
      setFiles(filesData.files ?? []);
      setDir(filesData.dir ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "install" | "enable" | "disable") => {
    if (!cwd) return;
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: PI_MEMORY_PACKAGE_SOURCE, scope: "global", cwd }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setMessage(t(`memory.${action}Done`));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const read = async (path: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/memory/files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      const data = await res.json() as { content?: string; error?: string };
      if (!res.ok || typeof data.content !== "string") {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setOpenFile({ path, content: data.content });
      setDraft(data.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const write = async (path: string, content: string, note?: string) => {
    setBusy(path);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/memory/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (note) setMessage(note);
      await load();
      await read(path);
    } finally {
      setBusy(null);
    }
  };

  const installed = Boolean(pkg);
  const enabled = installed && pkg?.disabled !== true;

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("memory.title")}</h2>
      <p className="settings-chat-range-hint" style={{ marginTop: -6 }}>{t("memory.subtitle")}</p>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.switches")}</h3>
        <div className="settings-chat-option settings-chat-range-option">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="settings-chat-option-label" style={{ flex: 1, minWidth: 0 }}>{t("memory.enable")}</span>
            {installed ? (
              <ConfigSwitch
                label={t("memory.enable")}
                checked={enabled}
                loading={busy === "enable" || busy === "disable"}
                onChange={(next) => void act(next ? "enable" : "disable")}
              />
            ) : (
              <ConfigButton variant="primary" size="small" disabled={busy !== null || !cwd} onClick={() => void act("install")}>
                {busy === "install" ? t("memory.installing") : t("memory.install")}
              </ConfigButton>
            )}
          </div>
          <p role="status" style={{ margin: "6px 0 0", fontSize: 12.5, color: enabled ? "var(--text)" : "var(--text-dim)" }}>
            {loading
              ? t("i18n.loading")
              : installed
                ? `${PI_MEMORY_PACKAGE_SOURCE} · ${pkg?.version ?? "?"} · ${enabled ? t("memory.stateOn") : t("memory.stateDisabled")}`
                : t("memory.stateMissing")}
          </p>
          <p className="settings-chat-range-hint">{t("memory.enableHint")}</p>
          {message && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--text)" }}>{message}</p>}
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.tools")}</h3>
        <div className="settings-chat-option settings-chat-range-option">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PI_MEMORY_TOOLS.map((tool) => (
              <code key={tool} style={{ padding: "2px 7px", border: "1px solid var(--border-faint)", borderRadius: "var(--radius-sm)", fontSize: 11.5, color: "var(--text-muted)" }}>
                {tool}
              </code>
            ))}
          </div>
          <p className="settings-chat-range-hint">{t("memory.toolsHint")}</p>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.files")}</h3>
        {dir && <p className="settings-chat-range-hint" style={{ marginTop: -2, fontFamily: "var(--font-mono)", fontSize: 11 }}>{dir}</p>}
        <div style={{ display: "grid", gap: 4 }}>
          {files.map((file) => (
            <div
              key={file.path}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 9px", border: "1px solid var(--border-faint)", borderRadius: "var(--radius-md)",
                background: openFile?.path === file.path ? "var(--bg-selected)" : "var(--bg-panel)",
                opacity: file.exists ? 1 : 0.75,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 1 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.path}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                  {file.exists
                    ? `${file.size} B · ${new Date(file.mtime).toLocaleString()}`
                    : t("memory.fileMissing")}
                </span>
              </span>
              {file.exists ? (
                <>
                  <ConfigButton variant="secondary" size="small" disabled={busy === file.path} onClick={() => void read(file.path)}>
                    {t("memory.preview")}
                  </ConfigButton>
                  {onOpenFile && (
                    <ConfigButton variant="ghost" size="small" onClick={() => onOpenFile(`${dir}/${file.path}`)}>
                      {t("memory.openInEditor")}
                    </ConfigButton>
                  )}
                </>
              ) : (
                <ConfigButton
                  variant="secondary"
                  size="small"
                  disabled={busy === file.path}
                  onClick={() => void write(file.path, PI_MEMORY_TEMPLATES[file.path] ?? `# ${file.path}\n`, t("memory.fileCreated"))}
                >
                  {t("memory.createFile")}
                </ConfigButton>
              )}
            </div>
          ))}
        </div>
        <p className="settings-chat-range-hint">{t("memory.filesHint")}</p>
        {openFile && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{openFile.path}</strong>
              <ConfigButton variant="ghost" size="small" onClick={() => setOpenFile(null)}>{t("i18n.close")}</ConfigButton>
              <ConfigButton
                variant="primary"
                size="small"
                disabled={busy === openFile.path || draft === openFile.content}
                onClick={() => void write(openFile.path, draft, t("memory.fileSaved"))}
              >
                {t("i18n.save")}
              </ConfigButton>
            </div>
            <textarea
              className="settings-field-input"
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              style={{ minHeight: 200, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55, resize: "vertical" }}
            />
          </div>
        )}
      </section>

      {error && <p role="alert" className="settings-general-error">{error}</p>}
    </div>
  );
}
