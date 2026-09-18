"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { useI18n } from "@/hooks/useI18n";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { TEXT } from "@/lib/typography";

function ToolbarIconButton({
  onClick,
  title,
  disabled,
  skipHover,
  color,
  background = "none",
  marginRight,
  ariaPressed,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  skipHover?: boolean;
  color: string;
  background?: string;
  marginRight?: number;
  ariaPressed?: boolean;
  children: ReactNode;
}) {
  const enter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = "var(--text-muted)";
    e.currentTarget.style.background = "var(--bg-hover)";
  };
  const leave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = color;
    e.currentTarget.style.background = background;
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={ariaPressed}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, padding: 0, marginRight,
        background,
        border: "none",
        color,
        cursor: disabled ? "default" : "pointer",
        borderRadius: "var(--radius-sm)",
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
        transition: "color 0.15s, background 0.15s",
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {children}
    </button>
  );
}

export function ExplorerPanel({
  cwd,
  onOpenFile,
  onOpenTerminal,
  explorerRefreshKey,
  onExplorerRefresh,
  onAtMention,
  onAtMentions,
  trailingActions,
}: {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "preview" | "diff" }) => void;
  onOpenTerminal?: (cwd: string) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** fork:ui-panel-row — panel-level buttons (new browser tab) rendered inline so
   *  the panel header stays a single row of icons. */
  trailingActions?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredExplorerOpenRef = useRef(false);

  // Restore the persisted collapsed state after mount to avoid hydration drift.
  useEffect(() => {
    if (restoredExplorerOpenRef.current) return;
    restoredExplorerOpenRef.current = true;
    setExplorerOpen(loadExplorerOpen());
  }, []);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => () => {
    if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
  }, []);

  return (
    <div
      className="file-explorer-section"
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <div className="file-explorer-header" style={{ display: "flex", alignItems: "center", flexShrink: 0, borderBottom: explorerOpen ? "1px solid var(--border-faint)" : "none" }}>
        <button
          className="file-explorer-toggle"
          onClick={() => setExplorerOpen((open) => {
            const next = !open;
            saveExplorerOpen(next);
            return next;
          })}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            height: 36,
            padding: "0 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: TEXT.xs,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            textAlign: "left",
          }}
        >
          <svg
            width="9" height="9" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
          {/* Shown instead of the label once the panel is too narrow for it
              (@container query in globals.css). Ported from upstream PR #838. */}
          <svg
            className="file-explorer-compact-icon"
            width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3.5 6.5h6l1.8 2h9.2v9.8a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2z" />
            <path d="M3.5 6.5V5.7a1.2 1.2 0 0 1 1.2-1.2h4l1.8 2h8.8a1.2 1.2 0 0 1 1.2 1.2v.8" />
          </svg>
          <span className="file-explorer-title-label">{t("files.explorer")}</span>
          {/* Which directory this tree is listing: without it an empty tree is
              indistinguishable from a wrong cwd. */}
          <span
            className="file-explorer-title-label"
            style={{ color: "var(--text-dim)", fontWeight: 400 }}
            title={cwd}
          >
            {cwd.split(/[\/]/).filter(Boolean).at(-1) ?? cwd}
          </span>
        </button>
        {onOpenTerminal && (
          <ToolbarIconButton
            onClick={() => onOpenTerminal(cwd)}
            title={t("terminal.open")}
            color="var(--text-dim)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </ToolbarIconButton>
        )}
        {/* fork:ui-review-button — the changed-files switch was hidden entirely
            while the tree was clean (so the "review" affordance disappeared) and
            its glyph read as a minus. It now stays in the row, names itself, and
            wears a diff glyph. */}
        {explorerOpen && (
          <ToolbarIconButton
            onClick={() => setChangesCollapsed((v) => !v)}
            disabled={changesCount === 0}
            title={changesCount > 0
              ? t("sidebar.reviewChanges", { count: changesCount })
              : t("sidebar.noChanges")}
            ariaPressed={changesCount > 0 && !changesCollapsed}
            color={changesCount > 0 && !changesCollapsed ? "var(--accent)" : "var(--text-dim)"}
            background={changesCount > 0 && !changesCollapsed ? "var(--bg-selected)" : "none"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 3v12a3 3 0 0 0 3 3h3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M18 12v6" />
              <path d="m15 15 3 3 3-3" />
            </svg>
          </ToolbarIconButton>
        )}
        {explorerOpen && (
          <ToolbarIconButton
            onClick={() => {
              setFileSearchOpen((open) => !open);
            }}
            title={t("sidebar.searchFiles")}
            ariaPressed={fileSearchOpen}
            color={fileSearchOpen ? "var(--accent)" : "var(--text-dim)"}
            background={fileSearchOpen ? "var(--bg-selected)" : "none"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
            </svg>
          </ToolbarIconButton>
        )}
        {explorerOpen && (
          <ToolbarIconButton
            onClick={() => fileExplorerRef.current?.openUploadPicker()}
            disabled={explorerUploadBusy}
            title={t("sidebar.uploadFilesTitle")}
            color="var(--text-dim)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="m17 8-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
          </ToolbarIconButton>
        )}
        <ToolbarIconButton
          onClick={() => {
            if (onExplorerRefresh) onExplorerRefresh();
            else setExplorerKey((k) => k + 1);
            setExplorerRefreshDone(true);
            if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
            explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
          }}
          title={t("sidebar.refreshExplorer")}
          skipHover={explorerRefreshDone}
          color={explorerRefreshDone ? "var(--success)" : "var(--text-dim)"}
          background={explorerRefreshDone ? "var(--success-soft)" : "none"}
          marginRight={6}
        >
          {explorerRefreshDone ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          )}
        </ToolbarIconButton>
        {trailingActions}
      </div>
      {explorerOpen && (
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          <FileExplorer
            ref={fileExplorerRef}
            cwd={cwd}
            onOpenFile={onOpenFile}
            refreshKey={explorerKey}
            onAtMention={onAtMention}
            onAtMentions={onAtMentions}
            onUploadBusyChange={setExplorerUploadBusy}
            changesCollapsed={changesCollapsed}
            onChangesCountChange={setChangesCount}
            fileSearchOpen={fileSearchOpen}
            onFileSearchOpenChange={setFileSearchOpen}
          />
        </div>
      )}
    </div>
  );
}
