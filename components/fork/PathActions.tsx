"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";

/*
 * fork:ui-20 — the three path actions, in one place.
 *
 * Before: "copy path" was re-implemented per surface and "reveal / open with the
 * default app" did not exist at all, even though the file tree and the viewer both
 * show files the user often wants to reach in Finder/Explorer (MusePi's file pane
 * exposes exactly these, FilePane.tsx:892-943).
 *
 * Feedback: copy flips its own glyph through the shared CopyStateIcon, the OS
 * actions flash a short error only when the route refuses or the spawn fails —
 * success is visible outside the app, so a toast would be noise.
 */

type ActionState = "idle" | "busy" | "failed";

export function PathActions({
  path,
  compact = false,
}: {
  /** Absolute path. The server checks it against the same allow-list as /api/files. */
  path: string;
  /** Icon-only cluster (file-tree rows, toolbars). */
  compact?: boolean;
}): ReactNode {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<ActionState>("idle");

  const run = async (action: "reveal" | "open") => {
    setState("busy");
    try {
      const res = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState("idle");
    } catch {
      setState("failed");
      window.setTimeout(() => setState((current) => (current === "failed" ? "idle" : current)), 2600);
    }
  };

  const copy = () => {
    void copyText(path).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  const buttonStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: compact ? 20 : 26,
    padding: compact ? "0 5px" : "0 8px",
    background: state === "failed" ? "var(--danger-soft, transparent)" : "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xs)",
    color: state === "failed" ? "var(--danger)" : copied ? "var(--accent)" : "var(--text-dim)",
    cursor: "pointer",
    fontSize: 11,
    whiteSpace: "nowrap" as const,
  };

  return (
    <span className="fork-path-actions" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <button
        type="button"
        onClick={copy}
        title={t("files.copyPath")}
        aria-label={t("files.copyPath")}
        style={buttonStyle}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {!compact && <span>{copied ? t("i18n.copied") : t("files.copyPath")}</span>}
      </button>
      <button
        type="button"
        disabled={state === "busy"}
        onClick={() => void run("reveal")}
        title={state === "failed" ? t("files.pathActionFailed") : t("files.revealPath")}
        aria-label={t("files.revealPath")}
        style={buttonStyle}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          <path d="M9 13h6" />
        </svg>
        {!compact && <span>{t("files.revealPath")}</span>}
      </button>
      <button
        type="button"
        disabled={state === "busy"}
        onClick={() => void run("open")}
        title={state === "failed" ? t("files.pathActionFailed") : t("files.openPath")}
        aria-label={t("files.openPath")}
        style={buttonStyle}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 3h6v6" /><path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
        {!compact && <span>{t("files.openPath")}</span>}
      </button>
      {state === "failed" && <span style={{ fontSize: 11, color: "var(--danger)" }}>{t("files.pathActionFailed")}</span>}
    </span>
  );
}
