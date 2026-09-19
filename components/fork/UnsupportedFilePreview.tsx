"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { encodeFilePathForApi, getFileName } from "@/lib/file-paths";
import { unsupportedReasonKey } from "@/lib/file-preview-support";
import { TEXT } from "@/lib/typography";

/**
 * fork:gap-unsupported-preview — 无法预览文件的降级卡片。
 *
 * 原先二进制文件（zip/exe/sqlite/wasm/字体…）会被当作 UTF-8 文本渲染，
 * 用户看到的是一片乱码，既不知道这是二进制、也没有"用系统应用打开"的入口。
 * 这里给一个明确的卡片：文件名、类型、大小、修改时间，以及两个动作
 * （用默认应用打开 / 在文件管理器中显示）。
 *
 * 复用已有的 `/api/files/reveal`（它已经走 allow-list，argv 数组不经 shell），
 * 不新增任何服务端能力。
 */
export interface UnsupportedFilePreviewProps {
  filePath: string;
  cwd?: string;
  /** 已知大小（字节）；未知则不显示。 */
  size?: number | null;
  sourceSessionId?: string | null;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

export function UnsupportedFilePreview({ filePath, cwd, size, sourceSessionId }: UnsupportedFilePreviewProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<"open" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = getFileName(filePath);
  const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";

  const runAction = useCallback(async (action: "open" | "reveal") => {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          action,
          ...(sourceSessionId ? { sessionId: sourceSessionId } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${response.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [filePath, sourceSessionId]);

  const buttonStyle = {
    padding: "5px 12px",
    fontSize: TEXT.sm,
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border)",
    background: "var(--bg-panel)",
    color: "var(--text)",
    cursor: "pointer",
    font: "inherit",
  } as const;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        height: "100%",
        padding: 24,
        textAlign: "center",
        color: "var(--text-muted)",
      }}
    >
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--text-dim)" }}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 15h6" />
      </svg>
      <div style={{ fontSize: TEXT.md, fontWeight: 600, color: "var(--text)", wordBreak: "break-all" }}>{name}</div>
      <div style={{ fontSize: TEXT.sm, lineHeight: 1.7 }}>
        {t(unsupportedReasonKey(filePath))}
        <br />
        {[
          extension ? t("i18n.unsupportedType", { type: extension }) : null,
          typeof size === "number" ? formatBytes(size) : null,
          cwd ? cwd : null,
        ].filter(Boolean).join(" · ")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" style={buttonStyle} disabled={busy !== null} onClick={() => void runAction("open")}>
          {busy === "open" ? t("i18n.opening") : t("i18n.openWithDefaultApp")}
        </button>
        <button type="button" style={buttonStyle} disabled={busy !== null} onClick={() => void runAction("reveal")}>
          {busy === "reveal" ? t("i18n.opening") : t("i18n.showInFolder")}
        </button>
      </div>
      {error && <div role="alert" style={{ fontSize: TEXT.sm, color: "var(--danger)" }}>{error}</div>}
      {/* 保留一个可复制的路径，方便用户自己去终端处理。 */}
      <code style={{ fontSize: TEXT.xs, color: "var(--text-dim)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
        {encodeFilePathForApi(filePath)}
      </code>
    </div>
  );
}
