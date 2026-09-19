"use client";

import { useRef, type ReactNode } from "react";
import { useContextMenu, type ContextMenuEntry } from "../ContextMenu";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";

/*
 * fork:ui-projectchip — "this chat runs in <workspace>" selector on the new-session
 * page (MusePi `WelcomeComposer.tsx:1202-1300` parity).
 *
 * Same capability as the sidebar's NewTaskPicker, moved next to the composer so the
 * target is visible — and changeable — while the first message is being written. The
 * sidebar entry is a 26px chevron beside 新建任务 that users only find once they already
 * know it exists.
 *
 * The dropdown is the shared ContextMenu (the one floating-layer entry point in this
 * app): it already provides keyboard navigation, Escape, outside-click dismissal,
 * viewport clamping, separators and the checked row, so nothing is hand-rolled here.
 *
 * Removal stays in the sidebar project context menu — this selector only switches and
 * creates targets, exactly like the reference.
 */

export interface NewSessionProject {
  key: string;
  root: string;
  name: string;
}

export interface NewSessionTargets {
  /** Known projects, most recent first. The chat workspace is already excluded. */
  projects: NewSessionProject[];
  /** Chat workspace directory used for "not in a project". */
  chatPath: string | null;
  /** Target cwd of the pending draft session. */
  activeCwd: string | null;
  /** Inline failure text (folder validation / blank-project creation). */
  error?: string | null;
  /** Re-read the chat workspace before the menu opens: the sidebar can change it. */
  onRefresh?: () => void;
  onPickProject: (project: NewSessionProject) => void;
  onPickChat: () => void;
  onOpenFolder: () => void;
  onNewBlank: () => void;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Which row gets the check mark. Compared the way the sidebar does it — for display. */
export function resolveActiveTarget(
  targets: Pick<NewSessionTargets, "projects" | "chatPath" | "activeCwd">,
): { activeProject: NewSessionProject | null; activeChat: boolean } {
  const cwd = targets.activeCwd ?? null;
  if (!cwd) return { activeProject: null, activeChat: false };
  const activeProject = targets.projects.find((project) => project.root === cwd) ?? null;
  return {
    activeProject,
    activeChat: !activeProject && Boolean(targets.chatPath) && targets.chatPath === cwd,
  };
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function FolderIcon(): ReactNode {
  return <svg {...iconProps}><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>;
}

function OpenFolderIcon(): ReactNode {
  return <svg {...iconProps}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" /><path d="M3 10h18l-2 8a2 2 0 0 1-2 1.6H5.6A2 2 0 0 1 3.6 18Z" /></svg>;
}

function BlankProjectIcon(): ReactNode {
  return <svg {...iconProps}><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 10v6M9 13h6" /></svg>;
}

function ChatIcon(): ReactNode {
  return <svg {...iconProps}><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.4-4.6A8 8 0 1 1 21 12Z" /></svg>;
}

function ChevronIcon(): ReactNode {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>;
}

/**
 * Menu rows: the current target (checked, label only) → the other projects → separator
 * → open folder / new blank project / not in a project. The active row is not repeated
 * as an action, so switching away and back never shows the same label twice.
 */
export function buildTargetItems(
  targets: NewSessionTargets,
  active: { activeProject: NewSessionProject | null; activeChat: boolean },
  t: Translate,
): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [];
  if (active.activeProject) {
    items.push({ label: active.activeProject.name, title: active.activeProject.root, checked: true });
  } else if (active.activeChat) {
    items.push({ label: t("sidebar.newTaskNoProject"), title: targets.chatPath ?? undefined, checked: true });
  } else if (targets.activeCwd) {
    items.push({ label: getFileName(targets.activeCwd), title: targets.activeCwd, checked: true });
  }

  for (const project of targets.projects) {
    if (active.activeProject?.key === project.key) continue;
    items.push({
      label: project.name,
      title: project.root,
      icon: <FolderIcon />,
      onSelect: () => targets.onPickProject(project),
    });
  }

  items.push({ type: "separator" });
  items.push({ label: t("home.openFolder"), icon: <OpenFolderIcon />, onSelect: () => targets.onOpenFolder() });
  items.push({ label: t("home.newBlankProject"), icon: <BlankProjectIcon />, onSelect: () => targets.onNewBlank() });
  if (!active.activeChat) {
    items.push({
      label: t("sidebar.newTaskNoProject"),
      icon: <ChatIcon />,
      disabled: !targets.chatPath,
      title: targets.chatPath ?? undefined,
      onSelect: () => targets.onPickChat(),
    });
  }
  return items;
}

export function ProjectChip({ targets }: { targets: NewSessionTargets }): ReactNode {
  const { t } = useI18n();
  const { openMenu } = useContextMenu();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const active = resolveActiveTarget(targets);
  const label = active.activeProject?.name
    ?? (active.activeChat ? t("sidebar.newTaskNoProject") : targets.activeCwd ? getFileName(targets.activeCwd) : t("sidebar.newTaskNoProject"));

  const open = (): void => {
    targets.onRefresh?.();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Anchor below the chip; ContextMenu clamps to the viewport, so a chip sitting
    // just above the composer opens upward instead of running off the bottom edge.
    openMenu(rect.left, rect.bottom + 6, buildTargetItems(targets, active, t));
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={open}
      title={targets.activeCwd ?? undefined}
      aria-label={t("home.workspaceTarget")}
      aria-haspopup="menu"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 26,
        maxWidth: "min(100%, 260px)",
        padding: "0 8px",
        // fork:zn-04 — Zeno .composer-protrusion-chip: a chromeless chip that
        // lives ON the protrusion strip. It used to be its own bordered card
        // (border + 14px radius + --bg-panel), which read as a control floating
        // above the strip instead of the strip's own content.
        border: "none",
        borderRadius: "var(--radius-sm)",
        background: "transparent",
        // fork:zn-04 — `--text`, not Zeno's `--foreground`: this fork's foreground
        // token is `--text` (audit-tokens.mjs keeps the reference spelling out).
        color: "var(--text)",
        fontSize: TEXT.md,
        fontWeight: 400,
        lineHeight: 1,
        cursor: "pointer",
        transition: "background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "color-mix(in srgb, var(--text) 10%, transparent)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ display: "flex", flexShrink: 0 }}>
        {active.activeChat ? <ChatIcon /> : <FolderIcon />}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ display: "flex", flexShrink: 0, opacity: 0.6 }}><ChevronIcon /></span>
    </button>
  );
}
