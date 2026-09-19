"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton, ConfigSwitch } from "../SettingsUi";
import { PI_MEMORY_PACKAGE_SOURCE, PI_MEMORY_TEMPLATES, PI_MEMORY_TOOLS } from "@/lib/pi-memory";
import { TEXT } from "@/lib/typography";

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
  // fork:fix-memory-ui — 自动保存 + 冲突保护：openFile 是磁盘上的已存内容（含读时的
  // mtime 基线），draft 是编辑中的草稿；draft 变更后防抖自动保存；磁盘被 agent
  // 或另一个窗口改过时服务器 409，面板提示冲突而不是盲写覆盖。
  const [openFile, setOpenFile] = useState<{ path: string; content: string; mtime: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [conflict, setConflict] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // fork:fix-memory-ui — 自动保存：draft 偏离基线后防抖 800ms 写盘；冲突时停下，
  // 等用户点「重新加载」再继续。write 未列入依赖：它每次渲染重建，列入会重置防抖计时。
  useEffect(() => {
    if (!openFile || conflict || draft === openFile.content) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void write(openFile.path, draft, undefined, openFile.mtime);
    }, 800);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, openFile, conflict]);

  // fork:fix-memory-refresh — 用户点「标记已整理」：把现在记为冷却起点，
  // 周检邀请接下来 7 天安静。只记时间，不碰记忆内容。
  const markTidied = async () => {
    try {
      const res = await fetch("/api/memory/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tidied" }),
      });
      if (res.ok) setMessage(t("memory.tidyMarked"));
    } catch {
      // 静默：这个按钮本身也只是辅助。
    }
  };

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
      const data = await res.json() as { content?: string; mtime?: string; error?: string };
      if (!res.ok || typeof data.content !== "string") {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setConflict(false);
      setOpenFile({ path, content: data.content, mtime: data.mtime ?? "" });
      setDraft(data.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const write = async (path: string, content: string, note?: string, expectedMtime?: string) => {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch("/api/memory/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content, expectedMtime }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; conflict?: boolean; file?: MemoryFileInfo };
      if (res.status === 409 && data.conflict) {
        // fork:fix-memory-ui — 外部冲突：agent（或另一个窗口）改过同一个文件，
        // 绝不静默覆盖；提示用户刷新后重编。
        setConflict(true);
        return false;
      }
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      setConflict(false);
      if (note) setMessage(note);
      // 保存成功：基线推进到新写入的内容与 mtime，自动保存才会安静下来。
      if (openFile?.path === path) {
        setOpenFile({ path, content, mtime: data.file?.mtime ?? openFile.mtime });
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
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
      {/* fork:fix-memory-refresh — 周检邀请的手动入口：用户刚过完一遍记忆就点这里，
          7 天内不再提醒。 */}
      <p style={{ margin: "0 0 10px" }}>
        <ConfigButton variant="ghost" size="small" onClick={() => void markTidied()}>{t("memory.tidyMark")}</ConfigButton>
      </p>

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
          <p role="status" style={{ margin: "6px 0 0", fontSize: TEXT.sm, color: enabled ? "var(--text)" : "var(--text-dim)" }}>
            {loading
              ? t("i18n.loading")
              : installed
                ? `${PI_MEMORY_PACKAGE_SOURCE} · ${pkg?.version ?? "?"} · ${enabled ? t("memory.stateOn") : t("memory.stateDisabled")}`
                : t("memory.stateMissing")}
          </p>
          <p className="settings-chat-range-hint">{t("memory.enableHint")}</p>
          {message && <p role="status" style={{ margin: 0, fontSize: TEXT.sm, color: "var(--text)" }}>{message}</p>}
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.tools")}</h3>
        <div className="settings-chat-option settings-chat-range-option">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PI_MEMORY_TOOLS.map((tool) => (
              <code key={tool} style={{ padding: "2px 7px", border: "1px solid var(--border-faint)", borderRadius: "var(--radius-sm)", fontSize: TEXT.xs, color: "var(--text-muted)" }}>
                {tool}
              </code>
            ))}
          </div>
          <p className="settings-chat-range-hint">{t("memory.toolsHint")}</p>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("memory.files")}</h3>
        {dir && <p className="settings-chat-range-hint" style={{ marginTop: -2, fontFamily: "var(--font-mono)", fontSize: TEXT.xs }}>{dir}</p>}
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
                <span style={{ fontFamily: "var(--font-mono)", fontSize: TEXT.sm, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.path}
                </span>
                <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
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
        {openFile && conflict && (
          // fork:fix-memory-ui — 外部冲突横幅：磁盘上的文件在读取后变了（多半是 agent
          // 刚写完记忆），编辑器里的草稿不会自动覆盖它；重新加载后重新改。
          <div
            role="alert"
            style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: "1px solid var(--warning)", borderRadius: "var(--radius-md)", background: "var(--warning-soft)" }}
          >
            <span style={{ flex: 1, minWidth: 0, fontSize: TEXT.sm, color: "var(--text)" }}>{t("memory.conflict")}</span>
            <ConfigButton variant="secondary" size="small" onClick={() => void read(openFile.path)}>{t("memory.reload")}</ConfigButton>
          </div>
        )}
        {openFile && !conflict && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: TEXT.sm, fontFamily: "var(--font-mono)" }}>{openFile.path}</strong>
              <ConfigButton variant="ghost" size="small" onClick={() => setOpenFile(null)}>{t("i18n.close")}</ConfigButton>
              <ConfigButton
                variant="primary"
                size="small"
                disabled={busy === openFile.path || draft === openFile.content}
                onClick={() => void write(openFile.path, draft, t("memory.fileSaved"), openFile.mtime)}
              >
                {t("i18n.save")}
              </ConfigButton>
            </div>
            <textarea
              className="settings-field-input"
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              style={{ minHeight: 200, fontFamily: "var(--font-mono)", fontSize: TEXT.sm, lineHeight: 1.55, resize: "vertical" }}
            />
            <p className="settings-chat-range-hint">{t("memory.autoSaveHint")}</p>
          </div>
        )}
      </section>

      {error && <p role="alert" className="settings-general-error">{error}</p>}
    </div>
  );
}
