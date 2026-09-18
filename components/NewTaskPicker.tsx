"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";

/**
 * Workspace picker for the 新建任务 row (fork feature:
 * `docs/patches/0001-chat-workspace.md`).
 *
 * Rendered beside the primary 新建任务 button: the button keeps its upstream
 * behaviour, this chevron only chooses *where* the new task goes — any known
 * project, or the standalone chat workspace ("不在项目中"). Picking an entry moves
 * the workspace and opens a fresh composer there (same result as selecting the
 * project first and then clicking 新建任务).
 *
 * Kept in its own file so the sidebar diff stays a wiring change.
 */
export function NewTaskPicker({
  projects,
  activeKey,
  chatPath,
  onNewIn,
  onAddProject,
}: {
  projects: { key: string; root: string; name: string }[];
  activeKey: string | null;
  chatPath: string | null;
  onNewIn: (cwd: string) => void;
  onAddProject: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const itemClass = "flex w-full items-center gap-2 border-none bg-transparent px-3 py-[7px] text-left text-[12.5px] text-text-muted hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent";

  const choose = (cwd: string) => {
    setOpen(false);
    onNewIn(cwd);
  };

  return (
    <div ref={rootRef} style={{ flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t("sidebar.newTaskChooseProject")}
        aria-label={t("sidebar.newTaskChooseProject")}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          width: 26,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          background: open ? "var(--bg-selected)" : "transparent",
          border: "none",
          borderRadius: "var(--radius-md)",
          color: open ? "var(--text)" : "var(--text-dim)",
          cursor: "pointer",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            // Anchored to the whole 新建任务 row: this element's positioning ancestor
            // is the wrapper in SessionSidebar, not this narrow chevron.
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            padding: "6px 0",
            maxHeight: "min(60vh, 420px)",
            overflowY: "auto",
          }}
        >
          {projects.length > 0 && (
            <div style={{ padding: "4px 12px 2px", fontSize: TEXT.xs, color: "var(--text-dim)", fontWeight: 500 }}>
              {t("sidebar.newTaskChooseProject")}
            </div>
          )}
          {projects.map((project) => (
            <button
              key={project.key}
              type="button"
              role="menuitem"
              className={itemClass}
              title={project.root}
              onClick={() => choose(project.root)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
                <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
              </svg>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: project.key === activeKey ? "var(--text)" : undefined }}>
                {project.name}
              </span>
              {project.key === activeKey && <span style={{ color: "var(--success)", flexShrink: 0 }}>✓</span>}
            </button>
          ))}

          <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!chatPath}
            title={chatPath ?? undefined}
            onClick={() => { if (chatPath) choose(chatPath); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.4-4.6A8 8 0 1 1 21 12Z" />
            </svg>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("sidebar.newTaskNoProject")}
            </span>
          </button>

          <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              onAddProject();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span style={{ flex: 1, minWidth: 0 }}>{t("sidebar.addProject")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
