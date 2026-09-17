"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton } from "../SettingsUi";
import { PI_MEMORY_PACKAGE_SOURCE, PI_MEMORY_TOOLS } from "@/lib/pi-memory";

/*
 * fork:memory-panel — settings page for the pi-memory package.
 *
 * This fork does not implement memory itself: `npm:pi-memory` (official pi package
 * directory) provides the tools, the markdown files and the injection, and it works
 * in the TUI too. What the panel adds is the three things a UI is good at: showing
 * whether the package is actually installed, installing/enabling it in one click,
 * and letting a human read what it wrote.
 */

interface MemoryFileInfo {
  path: string;
  size: number;
  mtime: string;
}

interface PluginPackageView {
  source: string;
  packageName?: string;
  version?: string;
  disabled?: boolean;
  resources?: { extensions?: number };
}

export function PiMemoryConfig({ cwd }: { cwd?: string | null }): ReactNode {
  const { t } = useI18n();
  const [pkg, setPkg] = useState<PluginPackageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [files, setFiles] = useState<MemoryFileInfo[]>([]);
  const [dir, setDir] = useState<string>("");
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);

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

  const open = async (path: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/memory/files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      const data = await res.json() as { content?: string; error?: string };
      if (!res.ok || typeof data.content !== "string") {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setOpenFile({ path, content: data.content });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const installed = Boolean(pkg);
  const enabled = installed && pkg?.disabled !== true;

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("memory.title")}</h2>
      <p className="settings-chat-range-hint" style={{ marginTop: -6 }}>{t("memory.subtitle")}</p>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.package")}</h3>
        <div className="settings-chat-option settings-chat-range-option">
          <p role="status" style={{ margin: 0, fontSize: 12.5, color: enabled ? "var(--text)" : "var(--text-dim)" }}>
            {loading
              ? t("i18n.loading")
              : installed
                ? `${PI_MEMORY_PACKAGE_SOURCE} · ${pkg?.version ?? "?"} · ${enabled ? t("memory.stateOn") : t("memory.stateDisabled")}`
                : t("memory.stateMissing")}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {!installed && (
              <ConfigButton variant="primary" size="small" disabled={busy !== null || !cwd} onClick={() => void act("install")}>
                {busy === "install" ? t("memory.installing") : t("memory.install")}
              </ConfigButton>
            )}
            {installed && !enabled && (
              <ConfigButton variant="secondary" size="small" disabled={busy !== null || !cwd} onClick={() => void act("enable")}>
                {t("memory.enable")}
              </ConfigButton>
            )}
            {installed && enabled && (
              <ConfigButton variant="ghost" size="small" disabled={busy !== null || !cwd} onClick={() => void act("disable")}>
                {t("memory.disable")}
              </ConfigButton>
            )}
            <ConfigButton variant="ghost" size="small" disabled={busy !== null} onClick={() => void load()}>
              {t("i18n.refresh")}
            </ConfigButton>
          </div>
          <p className="settings-chat-range-hint">{t("memory.packageHint")}</p>
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
        <h3 className="settings-general-heading">{t("memory.files", { count: files.length })}</h3>
        {dir && <p className="settings-chat-range-hint" style={{ marginTop: -2, fontFamily: "var(--font-mono)", fontSize: 11 }}>{dir}</p>}
        {files.length === 0 && <p className="settings-chat-range-hint">{t("memory.filesEmpty")}</p>}
        <div style={{ display: "grid", gap: 4 }}>
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => void open(file.path)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: "6px 9px", border: "1px solid var(--border-faint)", borderRadius: "var(--radius-md)",
                background: openFile?.path === file.path ? "var(--bg-selected)" : "var(--bg-panel)",
                color: "var(--text)", cursor: "pointer", fontSize: 12.5,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{file.path}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                {file.size} B · {new Date(file.mtime).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
        {openFile && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{openFile.path}</strong>
              <ConfigButton variant="ghost" size="small" onClick={() => setOpenFile(null)}>{t("i18n.close")}</ConfigButton>
            </div>
            <pre style={{ margin: 0, maxHeight: 320, overflow: "auto", padding: "10px 12px", border: "1px solid var(--border-faint)", borderRadius: "var(--radius-md)", background: "var(--bg)", fontSize: 11.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
{openFile.content}
            </pre>
          </div>
        )}
        <p className="settings-chat-range-hint">{t("memory.filesHint")}</p>
      </section>

      {error && <p role="alert" className="settings-general-error">{error}</p>}
    </div>
  );
}
