"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import { listSessionFamilies, type SessionFamily } from "@/lib/session-family";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { chatProjectOf, getProjectActivity, getRecentProjects, sessionsForProject, withoutChatProject } from "@/lib/project-groups";
import type { RecentProject } from "@/lib/project-groups";
import { SESSION_TAG_TONES, applySessionFlags, archivedSessions, useSessionFlags, type SessionTag } from "@/lib/session-flags";
import { desktopTrafficLightInset } from "@/lib/desktop-shell";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { formatRelativeTime } from "@/lib/i18n/format";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";
import { DirectoryPicker } from "./DirectoryPicker";
// fork:chat-workspace — standalone chat section (docs/patches/0001-chat-workspace.md)
import { ChatWorkspaceRow } from "./ChatWorkspaceRow";
import { NewTaskPicker } from "./NewTaskPicker";
import { SessionSearch } from "./SessionSearch";
import { useIsMobile } from "@/hooks/useIsMobile";

// Fixed row height for the session list. SessionItem renders at exactly this
// height, so the list can be windowed (only the visible slice is mounted).
export const SESSION_LIST_ITEM_HEIGHT = 38;

export function getSessionListIndices(count: number, scrollTop: number, viewportHeight: number, focusedIndex = -1): number[] {
  const overscan = 8;
  const visibleCount = Math.ceil((viewportHeight || 600) / SESSION_LIST_ITEM_HEIGHT) + overscan * 2;
  const start = Math.max(0, Math.min(Math.floor(scrollTop / SESSION_LIST_ITEM_HEIGHT) - overscan, count - visibleCount));
  const end = Math.min(count, start + visibleCount);
  const indices = Array.from({ length: end - start }, (_, offset) => start + offset);
  // Keep a focused row mounted so scrolling cannot discard an inline rename.
  if (focusedIndex >= 0 && focusedIndex < start) indices.unshift(focusedIndex);
  if (focusedIndex >= end && focusedIndex < count) indices.push(focusedIndex);
  return indices;
}

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, entryId?: string, blockIndex?: number) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  onSessionsChange?: (sessions: SessionInfo[]) => void;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  /** Stable server-computed identity; never derive OS path semantics here. */
  projectKey: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  /** Canonical path of the checkout containing forCwd, resolved server-side. */
  currentWorktreePath: string | null;
  worktrees: WorktreeEntry[];
}

interface ProjectSelection {
  root: string;
  key: string;
}

interface ValidatedProject {
  cwd: string;
  root: string;
  key: string;
}

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
const LAST_CUSTOM_CWD_STORAGE_KEY = "pi-web:last-custom-cwd";
const RUNNING_SESSIONS_POLL_MS = 2500;

function loadLastCustomCwd(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_CUSTOM_CWD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastCustomCwd(cwd: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CUSTOM_CWD_STORAGE_KEY, cwd);
  } catch {
    // Persistence is best-effort.
  }
}

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({ open, children, style }: { open: boolean; children: ReactNode; style: CSSProperties }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}



const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function PiWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}` : "Pi Codex";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    // Vestibular-sensitive users get an instant swap instead of the scramble.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "default",
        fontWeight: 600, fontSize: 13.5, letterSpacing: "-0.01em",
        color: showVersion ? "var(--accent)" : "var(--text)",
        minWidth: "6ch",
      }}
    >
      {display}
    </button>
  );
}

function SidebarNavIcon() {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  return (
    <svg {...common}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SidebarNavButton({
  label,
  onClick,
  active,
  disabled,
  title,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      style={{
        width: "100%",
        height: 36,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 9px",
        background: active ? "var(--bg-selected)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-md)",
        color: disabled ? "var(--text-dim)" : "var(--text)",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        fontSize: 13.5,
        fontWeight: active ? 500 : 400,
        opacity: disabled ? 0.42 : 1,
        transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(event) => {
        if (!disabled && !active) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        if (!active) event.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ display: "flex", flexShrink: 0, color: active ? "var(--text)" : "var(--text-muted)" }}>
        <SidebarNavIcon />
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

function ProjectRow({
  label,
  title,
  selected,
  count,
  expanded,
  onToggle,
  activity,
  onClick,
}: {
  label: string;
  title: string;
  selected: boolean;
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
  activity?: { running: number; unread: number };
  onClick: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={selected ? "page" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        // Same inset as the session rows below, so a project header separates from
        // its session list by the same gap it uses between sessions.
        height: SESSION_LIST_ITEM_HEIGHT - 8,
        marginTop: 4,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 9px",
        background: selected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-md)",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        fontSize: 13.5,
        fontWeight: selected ? 500 : 400,
        transition: "background 0.12s, color 0.12s",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0, color: selected ? "var(--text)" : "var(--text-muted)" }}
      >
        <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </svg>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {typeof count === "number" && (
        <span style={{ fontSize: 12, color: "var(--text-dim)", flexShrink: 0, minWidth: 14, textAlign: "right" }}>{count}</span>
      )}
      {showProjectActivity(activity, t)}
      {onToggle && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onToggle();
            }
          }}
          aria-label={expanded ? t("sidebar.collapseSubagents") : t("sidebar.expandSubagents")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0, color: "var(--text-dim)", cursor: "pointer" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      )}
      </button>
  );
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onBackgroundTaskDone, onRunningSessionIdsChange, onSessionsChange }: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [sessionListVersion, setSessionListVersion] = useState<number | null>(null);
  const sessionListVersionRef = useRef<number | null>(null);
  const sessionLoadIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [wtFilter, setWtFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState(loadLastCustomCwd);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [nativePicking, setNativePicking] = useState(false);
  const isMobile = useIsMobile();
  const [validatedProject, setValidatedProject] = useState<ValidatedProject | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  // fork:chat-workspace — standalone chat workspace, identified by the server key.
  const [chatWorkspace, setChatWorkspace] = useState<{ cwd: string; key: string } | null>(null);
  const [chatWorkspaceBusy, setChatWorkspaceBusy] = useState(false);
  const [chatPathOpen, setChatPathOpen] = useState(false);
  const [chatPathError, setChatPathError] = useState<string | null>(null);
  // ponytail: 每個項目獨立展開，避免只能看選中項的傻折疊
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  // fork:ui-10 — list order + the "expand/collapse all" switch.
  const [sessionSort, setSessionSort] = useState<"updated" | "created">("updated");
  // 归档区默认折叠；每个项目独立记忆展开状态（取消归档的右键菜单入口）。
  const [expandedArchivedProjects, setExpandedArchivedProjects] = useState<Set<string>>(new Set());
  const toggleArchivedSection = useCallback((projectKey: string) => {
    setExpandedArchivedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectKey)) next.delete(projectKey);
      else next.add(projectKey);
      return next;
    });
  }, []);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const [sessionListOffsetTop, setSessionListOffsetTop] = useState(0);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const sessionSearchActive = sessionSearchOpen && Boolean(sessionSearchQuery.trim());
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const { flags: sessionFlags } = useSessionFlags();
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const currentSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);

  // Virtualized session list: only the visible window of rows is mounted.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [listViewportH, setListViewportH] = useState(0);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const listScrollRafRef = useRef<number | null>(null);
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (listScrollRafRef.current != null) return;
    listScrollRafRef.current = requestAnimationFrame(() => {
      listScrollRafRef.current = null;
      setListScrollTop(top);
    });
  }, []);
  useLayoutEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setListViewportH(entry.contentRect.height);
    });
    ro.observe(el);
    setListViewportH(el.clientHeight);
    setListScrollTop(el.scrollTop);
    return () => ro.disconnect();
  }, [sessionSearchActive]);

  const loadSessions = useCallback(async (showLoading = false, force = false) => {
    const loadId = ++sessionLoadIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(force ? "/api/sessions?force=1" : "/api/sessions", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        sessions: SessionInfo[];
        sessionListVersion: number;
        runningSessionIds?: string[];
        completionNotificationSuppressedSessionIds?: string[];
      };
      if (loadId !== sessionLoadIdRef.current) return;
      sessionListVersionRef.current = data.sessionListVersion;
      setSessionListVersion(data.sessionListVersion);
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop markers for deleted sessions and for subagents, whose completion
      // is intentionally silent even if an older client marked them unread.
      const unreadEligibleIds = new Set(
        data.sessions
          .filter((session) => session.relation?.kind !== "subagent")
          .map((session) => session.id),
      );
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => unreadEligibleIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
    } catch (e) {
      if (loadId === sessionLoadIdRef.current) setError(String(e));
    } finally {
      if (loadId === sessionLoadIdRef.current) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst, !isFirst);
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) return;
        const data = await res.json() as {
          sessionListVersion: number;
          runningSessionIds?: string[];
          completionNotificationSuppressedSessionIds?: string[];
        };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
        if (data.sessionListVersion !== sessionListVersionRef.current) {
          // Reuse the invalidated cache; forcing a scan would change the version again.
          await loadSessions();
        }
      } catch {
        // Keep the last known state; the next visible-tab poll retries.
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadSessions]);

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    onSessionsChange?.(allSessions);
  }, [allSessions, onSessionsChange]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const knownSubagentIds = new Set(
      allSessions
        .filter((session) => session.relation?.kind === "subagent")
        .map((session) => session.id),
    );
    const completedWithNotifications = completedInBackground.filter(
      (id) => !previousSuppressedCompletionSessionIdsRef.current.has(id) && !knownSubagentIds.has(id),
    );
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    if (completedWithNotifications.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        runningSessionIds.forEach((id) => next.delete(id));
        completedWithNotifications.forEach((id) => next.add(id));
        return next;
      });
    }
    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    if (completedInBackground.length > 0 || hasUnlistedRunningSession) {
      loadSessions(false, true);
    }
    if (completedWithNotifications.length > 0) {
      onBackgroundTaskDone?.();
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
    previousSuppressedCompletionSessionIdsRef.current = new Set(
      [...runningSessionIds].filter(
        (id) => currentSuppressedCompletionSessionIdsRef.current.has(id) || knownSubagentIds.has(id),
      ),
    );
  }, [runningSessionIds, selectedSessionId, allSessions, loadSessions, onBackgroundTaskDone]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  // fork:chat-workspace — read (and create) the standalone chat workspace once per
  // mount. It lives in state instead of being derived from sessions so the section
  // stays available with zero chats.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat-workspace", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { cwd?: string; projectKey?: string } | null) => {
        if (cancelled || !d?.cwd || !d.projectKey) return;
        setChatWorkspace({ cwd: d.cwd, key: d.projectKey });
        // Seed the validated identity so projectFor() resolves the server key
        // before the first standalone chat session exists.
        setValidatedProject((prev) => prev ?? { cwd: d.cwd!, root: d.cwd!, key: d.projectKey! });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const restoredRef = useRef(false);

  const projectSelection = useCallback((root: string, key: string): ProjectSelection => ({
    root,
    key,
  }), []);

  /** Resolve both display root and stable identity from server-provided data. */
  const projectFor = useCallback((cwd: string | null): ProjectSelection | null => {
    if (!cwd) return null;
    // /api/cwd/validate resolves identity before a custom path becomes active,
    // preventing one render with a raw path key from looking like a switch.
    if (validatedProject?.cwd === cwd) {
      return projectSelection(validatedProject.root, validatedProject.key);
    }
    if (worktreeState && worktreeState.forCwd === cwd) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    const match = allSessions.find((session) => (
      session.cwd === cwd || (session.projectRoot ?? session.cwd) === cwd
    ));
    return match
      ? projectSelection(match.projectRoot ?? match.cwd, workspaceKeyOf(match))
      : projectSelection(cwd, cwd);
  }, [validatedProject, worktreeState, allSessions, projectSelection]);

  // A worktree/session refresh can hydrate the stable key without changing
  // cwd, so notify when either changes. The parent treats same-cwd key changes
  // as identity hydration rather than a workspace switch.
  const lastNotifiedProjectRef = useRef<{ cwd: string | null; key: string | null } | null>(null);
  useEffect(() => {
    const project = projectFor(selectedCwd);
    const previous = lastNotifiedProjectRef.current;
    if (previous?.cwd === selectedCwd && previous.key === (project?.key ?? null)) return;
    lastNotifiedProjectRef.current = { cwd: selectedCwd, key: project?.key ?? null };
    onCwdChange?.(
      selectedCwd,
      project?.root ?? null,
      project?.key ?? null,
    );
  }, [selectedCwd, onCwdChange, projectFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; projectKey?: string; isGit?: boolean; isTopLevel?: boolean; currentWorktreePath?: string | null; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          projectKey: d.projectKey ?? d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          currentWorktreePath: d.currentWorktreePath ?? null,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    // fork:chat-workspace — with zero sessions the chat workspace is still a valid
    // landing spot, so only the URL-restore skip short-circuits here.
    if (skipInitialProjectSelection || (allSessions.length === 0 && !chatWorkspace)) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      // fork:chat-workspace — projects win; with none, land on the chat workspace so
      // the composer is the first screen instead of the "getting started" panel.
      const fallback = projects[0]?.root ?? chatWorkspace?.cwd ?? null;
      if (fallback) setSelectedCwd(fallback);
    }
  }, [allSessions, chatWorkspace, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

  // Prefer an exact UI selection while a refetch is in flight. Once the
  // response catches up, the server-resolved path handles Windows case and
  // separator differences without teaching the browser OS path semantics.
  const currentWorktree = worktreeState
    ? worktreeState.worktrees.find((worktree) => worktree.path === selectedCwd)
      ?? (worktreeState.forCwd === selectedCwd && worktreeState.currentWorktreePath
        ? worktreeState.worktrees.find((worktree) => worktree.path === worktreeState.currentWorktreePath)
        : undefined)
      ?? worktreeState.worktrees.find((worktree) => worktree.isMain)
    : undefined;
  const currentWorktreePath = currentWorktree?.path ?? null;

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as {
        cwd?: string;
        projectRoot?: string;
        projectKey?: string;
        error?: string;
      };
      if (!res.ok || data.error || !data.cwd || !data.projectRoot || !data.projectKey) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setValidatedProject({
        cwd: data.cwd,
        root: data.projectRoot,
        key: data.projectKey,
      });
      saveLastCustomCwd(data.cwd);
      setCustomPathValue(data.cwd);
      setSelectedCwd(data.cwd);
      setCustomPathOpen(false);
      setProjectMenuOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen(true);
    setCustomPathError(null);
    setProjectMenuOpen(false);
  }, []);
  // ponytail: 桌面走服务端原生选框，手机直走弹窗；服务端失败再试浏览器，最后回退
  const handleAddProjectClick = useCallback(async () => {
    if (isMobile) {
      handleCustomPathClick();
      return;
    }
    if (nativePicking || customPathValidating) return;
    setNativePicking(true);
    setCustomPathError(null);
    setProjectMenuOpen(false);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 65000);
      const res = await fetch("/api/cwd/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPath: customPathValue || selectedCwd || undefined }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = (await res.json().catch(() => ({}))) as { cwd?: string; cancelled?: boolean; fallback?: boolean; error?: string };
      if (res.ok && data.cwd) {
        await commitCustomPath(data.cwd);
        return;
      }
      if (data.cancelled) return;
      if (res.status === 501 && typeof window !== "undefined" && "showDirectoryPicker" in window) {
        try {
          const handle = await (window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<{ name: string }> }).showDirectoryPicker({ mode: "read" });
          const hint = handle.name;
          const guessed = customPathValue ? `${customPathValue.replace(/\/+$/, "")}/${hint}` : hint;
          setCustomPathValue(guessed);
        } catch (pickError: unknown) {
          const name = pickError instanceof Error ? pickError.name : "";
          if (name === "AbortError") return;
        }
      }
    } catch {
      // 静默回退到自定义弹窗
    } finally {
      setNativePicking(false);
    }
    handleCustomPathClick();
  }, [isMobile, nativePicking, customPathValidating, customPathValue, selectedCwd, commitCustomPath, handleCustomPathClick]);
  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setCustomPathOpen(false);
        setCustomPathError(null);
        setProjectMenuOpen(false);
      }
    } catch {
      // ignore
    }
  }, []);
  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      // Optimistically register the new worktree so projectFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) => prev ? {
        ...prev,
        forCwd: data.path!,
        currentWorktreePath: data.path!,
        worktrees: [...prev.worktrees, { path: data.path!, branch, isMain: false }],
      } : prev);
      setSelectedCwd(data.path);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          return;
        }
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtConfirmRemove(null);
      if (currentWorktreePath === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, currentWorktreePath]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
        setWtDropdownOpen(false);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtError(null);
        setWtConfirmRemove(null);
        setWtFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo, entryId?: string, blockIndex?: number) => {
    setAllSessions((current) => current.some((session) => session.id === s.id) ? current : [s, ...current]);
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s, false, entryId, blockIndex);
  }, [onSelectSession]);

  // fork:chat-workspace — persist a different chat directory, and follow it when it
  // was the active workspace.
  const commitChatWorkspace = useCallback(async (path: string) => {
    if (chatWorkspaceBusy) return;
    setChatWorkspaceBusy(true);
    setChatPathError(null);
    try {
      const res = await fetch("/api/chat-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; projectKey?: string; error?: string };
      if (!res.ok || !data.cwd || !data.projectKey) {
        setChatPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const identity = { cwd: data.cwd, root: data.cwd, key: data.projectKey };
      setChatWorkspace({ cwd: identity.cwd, key: identity.key });
      setValidatedProject(identity);
      if (chatWorkspace && selectedCwd === chatWorkspace.cwd) setSelectedCwd(identity.cwd);
      setChatPathOpen(false);
    } catch (e) {
      setChatPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setChatWorkspaceBusy(false);
    }
  }, [chatWorkspace, chatWorkspaceBusy, selectedCwd]);

  // fork:chat-workspace — start a session in an explicit workspace (chat or project):
  // move the workspace first so the explorer, file tabs and per-workspace session
  // memory follow it.
  const startSessionIn = useCallback((cwd: string) => {
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    setSelectedCwd(cwd);
    setCustomPathError(null);
    setProjectMenuOpen(false);
    onNewSession?.(tempId, cwd);
  }, [onNewSession]);

  // fork:chat-workspace — resolve the default workspace when a task is started.
  // Reading it from render state handed `""`/`"/"` to the API whenever the async
  // /api/home or /api/chat-workspace response had not landed yet, which created a
  // session whose cwd was the filesystem root.
  const resolveDefaultCwd = useCallback(async (): Promise<string | null> => {
    if (selectedCwd) return selectedCwd;
    if (chatWorkspace?.cwd) return chatWorkspace.cwd;
    try {
      const res = await fetch("/api/chat-workspace", { cache: "no-store" });
      const data = await res.json() as { cwd?: string; projectKey?: string };
      if (data.cwd && data.projectKey) {
        setChatWorkspace({ cwd: data.cwd, key: data.projectKey });
        setValidatedProject((prev) => prev ?? { cwd: data.cwd!, root: data.cwd!, key: data.projectKey! });
        return data.cwd;
      }
    } catch {
      // fall back to the home directory below
    }
    return homeDir || null;
  }, [chatWorkspace, homeDir, selectedCwd]);

  const handleNewSession = useCallback(() => {
    void resolveDefaultCwd().then((cwd) => {
      if (cwd) startSessionIn(cwd);
    });
  }, [resolveDefaultCwd, startSessionIn]);

  // Sessions of every worktree in the selected project are shown together
  /**
   * fork:ui-10 — one place that turns "all sessions" into "this project's rows in the
   * requested order", so the five list call sites cannot drift apart.
   */
  const orderedProjectSessions = useCallback((projectKey: string) => {
    const rows = sessionsForProject(allSessions, projectKey);
    const sorted = [...rows].sort((a, b) => (
      sessionSort === "created" ? b.created.localeCompare(a.created) : b.modified.localeCompare(a.modified)
    ));
    return applySessionFlags(sorted, sessionFlags);
  }, [allSessions, sessionFlags, sessionSort]);

  const selectedProject = projectFor(selectedCwd);
  const projectChoices = useMemo(() => {
    const recent = getRecentProjects(allSessions);
    if (!selectedProject || recent.some((project) => project.key === selectedProject.key)) return recent;
    return [{ key: selectedProject.key, root: selectedProject.root }, ...recent];
  }, [allSessions, selectedProject]);
  // fork:chat-workspace — 聊天 与 项目 平级：聊天工作区永远在最上面，且从项目列表
  // （和工作区下拉）里剔除；两者靠各自的标题行区分，标题下各自渲染自己的会话。
  const chatProjectKey = chatWorkspace?.key ?? null;
  // 项目全部展示，靠外层滚动查看，不再截断
  const visibleProjects = withoutChatProject(projectChoices, chatProjectKey);
  const chatProject: RecentProject | null = chatWorkspace
    ? chatProjectOf(projectChoices, chatProjectKey) ?? { key: chatWorkspace.key, root: chatWorkspace.cwd }
    : null;

  // Per-project activity counts (running / unread) for the workspace selector.
  // Uses the same stable server key as the project list and filtering.
  const projectActivity = useMemo(
    () => getProjectActivity(allSessions, runningSessionIds, unreadSessionIds),
    [allSessions, runningSessionIds, unreadSessionIds],
  );
  // ponytail: 跟随选中项目自动展开（仅 key 变化时触发，避免每次渲染都把手动折叠覆盖掉）
  useEffect(() => {
    if (selectedProject) {
      const key = selectedProject.key;
      setExpandedProjects((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.key]);

  const filteredSessions = selectedProject
    ? sessionsForProject(allSessions, selectedProject.key)
    : allSessions;
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject?.key === worktreeState.projectKey
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject?.key === worktreeState.projectKey
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
             label: t("sidebar.openRepoRoot"),
             title: t("sidebar.openRepoRootTitle"),
          }
        : {
             label: t("sidebar.gitRepoRootOnly"),
             title: t("sidebar.gitRepoRootOnlyTitle"),
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
           label: t("sidebar.worktrees"),
           title: t("sidebar.checkingWorktrees"),
        }
      : null);

  const sessionFamilies = listSessionFamilies(applySessionFlags(filteredSessions, sessionFlags));

  useLayoutEffect(() => {
    const list = listScrollRef.current;
    const section = sessionListRef.current;
    if (!list || !section) {
      setSessionListOffsetTop(0);
      return;
    }
    const updateOffset = () => {
      const listTop = list.getBoundingClientRect().top;
      const sectionTop = section.getBoundingClientRect().top;
      setSessionListOffsetTop(Math.max(0, sectionTop - listTop + list.scrollTop));
    };
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(list);
    observer.observe(section);
    return () => observer.disconnect();
  }, [expandedProjects, selectedProject?.key, sessionFamilies.length, visibleProjects.length]);

  const virtualIndices = getSessionListIndices(
    sessionFamilies.length,
    Math.max(0, listScrollTop - sessionListOffsetTop),
    listViewportH,
    sessionFamilies.findIndex((family) => family.root.id === focusedSessionId),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {customPathOpen && (
        <DirectoryPicker
          initialPath={customPathValue}
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* fork:chat-workspace — the chat directory picker is separate from the project one
          so the validated-project flow above stays untouched. */}
      {chatPathOpen && (
        <DirectoryPicker
          initialPath={chatWorkspace?.cwd ?? homeDir}
          busy={chatWorkspaceBusy}
          error={chatPathError}
          onCancel={() => {
            setChatPathOpen(false);
            setChatPathError(null);
          }}
          onSelect={(path) => void commitChatWorkspace(path)}
        />
      )}
      {/* Header */}
      <div
        style={{
          padding: "9px 10px 8px",
          borderBottom: "1px solid var(--border-faint)",
          flexShrink: 0,
        }}
      >
        {/* fork:desktop-shell — the traffic lights sit over this row's left edge, so the
            brand starts to their right instead of the whole bar moving down. The row also
            doubles as the window's drag handle (see fork-ui.css). */}
        <div
          className="sidebar-brand-row"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
            paddingLeft: desktopTrafficLightInset(),
          }}
        >
          <PiWebTitle />
          <button
            type="button"
            onClick={() => {
              setSessionSearchOpen((open) => !open);
              setWtDropdownOpen(false);
            }}
            title={t("sidebar.toggleSessionSearch")}
            aria-label={t("sidebar.toggleSessionSearch")}
            aria-expanded={sessionSearchOpen}
            aria-controls="session-search-input"
            className={`flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[8px] border-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent ${sessionSearchOpen ? "bg-bg-selected text-accent" : "bg-transparent text-text-muted"}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
            </svg>
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {/* fork:chat-workspace — the primary action stays upstream's SidebarNavButton;
              the picker beside it chooses a project or "not in a project". */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 2 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SidebarNavButton
                label={t("sidebar.newTask")}
                onClick={handleNewSession}
                active={!selectedSessionId}
                disabled={false}
                title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.newTask")}
              />
            </div>
            <NewTaskPicker
              projects={visibleProjects.map((project) => ({ key: project.key, root: project.root, name: getFileName(project.root) || project.root }))}
              activeKey={selectedProject?.key ?? null}
              chatPath={chatProject?.root ?? null}
              onNewIn={startSessionIn}
              onAddProject={() => void handleAddProjectClick()}
            />
          </div>
        </div>

        {sessionSearchOpen && (
          <input
            id="session-search-input"
            type="search"
            autoFocus
            value={sessionSearchQuery}
            maxLength={200}
            aria-label={t("sidebar.searchSessions")}
            placeholder={t("sidebar.searchSessions")}
            onChange={(event) => setSessionSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setSessionSearchQuery("");
              }
            }}
            className="mt-[6px] block h-[29px] w-full min-w-0 rounded-[7px] border border-border bg-bg px-[10px] text-xs text-text focus:outline-2 focus:outline-accent"
          />
        )}

        {/* Worktree switcher — shown only for git projects at a checkout top
            level (repo subdirs keep their own project identity, so switching
            from them would jump projects). Rendered whenever the selected cwd
            belongs to the loaded project (not just when forCwd matches), so
            switching between worktrees of one project keeps the row mounted
            instead of flickering while data refetches: all worktrees of a
            project share the same list anyway. */}
        {!sessionSearchOpen && showWorktreeSwitcher && (() => {
          if (!worktreeState) return null;
          const showWtFilter = worktreeState.worktrees.length >= 8;
          const visibleWorktrees = showWtFilter && wtFilter.trim()
            ? worktreeState.worktrees.filter((w) =>
                (w.branch ?? displayCwd(w.path, homeDir)).toLowerCase().includes(wtFilter.trim().toLowerCase()))
            : worktreeState.worktrees;
          return (
            <div ref={wtDropdownRef} style={{ position: "relative", marginTop: 6 }}>
              <button
                onClick={() => setWtDropdownOpen((v) => !v)}
                 title={currentWorktree ? t("sidebar.switchWorktreeTitle", { path: currentWorktree.path }) : t("sidebar.switchWorktree")}
                style={{
                  width: "100%",
                  height: 29,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1.35,
                  color: "var(--text-muted)",
                  textAlign: "left",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: currentWorktree && !currentWorktree.isMain ? "var(--accent)" : "var(--text-dim)" }}>
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
                <PathLabel
                  text={currentWorktree ? (currentWorktree.branch ?? displayCwd(currentWorktree.path, homeDir)) : "…"}
                  style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text)" }}
                />
                {currentWorktree?.isMain && (
                   <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("sidebar.main")}</span>
                )}
                {worktreeState.worktrees.length > 1 && (
                  <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
                    {worktreeState.worktrees.length}
                  </span>
                )}
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="2 3.5 5 6.5 8 3.5" />
                </svg>
              </button>

              <AnimatedDropdown
                open={wtDropdownOpen}
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                  overflow: "hidden",
                }}
              >
                  {showWtFilter && (
                    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      <input
                        value={wtFilter}
                        onChange={(e) => setWtFilter(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setWtFilter("");
                            setWtDropdownOpen(false);
                          }
                        }}
                        placeholder={t("sidebar.filterWorktrees")}
                        autoFocus
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-xs)",
                          outline: "none",
                          background: "var(--bg)",
                          color: "var(--text)",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  )}
                  <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
                    {visibleWorktrees.map((wt) => {
                      const isCurrent = wt.path === currentWorktreePath;
                      if (wtConfirmRemove === wt.path) {
                        return (
                          <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "var(--danger-soft)" }}>
                            <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t("sidebar.forceRemoveCheckout")}
                            </span>
                            <button
                              onClick={() => void handleRemoveWorktree(wt.path, true)}
                              disabled={wtBusy}
                              style={{ padding: "3px 9px", background: "var(--danger)", border: "none", borderRadius: "var(--radius-xs)", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("sidebar.force")}
                            </button>
                            <button
                              onClick={() => setWtConfirmRemove(null)}
                              style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("sidebar.cancel")}
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={wt.path}
                          className="wt-row"
                          style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
                        >
                          <button
                            onClick={() => {
                              setSelectedCwd(wt.path);
                              setWtDropdownOpen(false);
                              setWtError(null);
                              setWtFilter("");
                            }}
                            title={wt.path}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "8px 10px",
                              background: "var(--bg)",
                              border: "none",
                              color: isCurrent ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer",
                              textAlign: "left",
                              fontSize: 11,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {isCurrent ? (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <polyline points="1.5 5 4 7.5 8.5 2.5" />
                              </svg>
                            ) : (
                              <span style={{ width: 10, flexShrink: 0 }} />
                            )}
                            <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                            {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("sidebar.main")}</span>}
                          </button>
                          {!wt.isMain && (
                            <button
                              onClick={() => void handleRemoveWorktree(wt.path, false)}
                              disabled={wtBusy}
                               title={t("sidebar.removeWorktreeTitle", { path: wt.path })}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "center",
                                width: 34, height: 28, padding: 0, marginRight: 4,
                                background: "none", border: "none",
                                color: "var(--text-dim)", cursor: "pointer",
                                borderRadius: "var(--radius-xs)", flexShrink: 0,
                                transition: "color 0.12s, background 0.12s",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.background = "var(--danger-soft)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {showWtFilter && visibleWorktrees.length === 0 && wtFilter.trim() && (
                      <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.noMatchingWorktrees")}</div>
                    )}
                  </div>

                  {!wtNewOpen ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setWtNewOpen(true);
                        setWtError(null);
                        setTimeout(() => wtNewInputRef.current?.focus(), 0);
                      }}
                      title={t("sidebar.createWorktreeTitle")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        width: "100%",
                        padding: "8px 10px",
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 11,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                        <line x1="5" y1="1" x2="5" y2="9" />
                        <line x1="1" y1="5" x2="9" y2="5" />
                      </svg>
                       <span>{t("sidebar.newWorktree")}</span>
                    </button>
                  ) : (
                    <div style={{ padding: "6px 8px" }}>
                      <input
                        ref={wtNewInputRef}
                        value={wtNewBranch}
                        onChange={(e) => {
                          setWtNewBranch(e.target.value);
                          setWtError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateWorktree();
                          }
                          if (e.key === "Escape") {
                            setWtNewOpen(false);
                            setWtNewBranch("");
                            setWtError(null);
                          }
                        }}
                         placeholder={t("sidebar.branchName")}
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          border: "1px solid var(--accent)",
                          borderRadius: "var(--radius-xs)",
                          outline: "none",
                          background: "var(--bg)",
                          color: "var(--text)",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                        <button
                          onClick={() => void handleCreateWorktree()}
                          disabled={wtBusy || !wtNewBranch.trim()}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--primary-bg)",
                            border: "none",
                            borderRadius: "var(--radius-md)",
                            color: "var(--primary-fg)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer",
                            opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1,
                          }}
                        >
                           {wtBusy ? t("sidebar.creating") : t("sidebar.create")}
                        </button>
                        <button
                          onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-xs)",
                            color: "var(--text-muted)",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                           {t("sidebar.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  {wtError && (
                    <div style={{
                      padding: "5px 10px 8px",
                      color: "var(--danger)",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {wtError}
                    </div>
                  )}
              </AnimatedDropdown>
            </div>
          );
        })()}
        {!sessionSearchOpen && inactiveWorktreeSelector && (
          <button
            type="button"
            aria-disabled="true"
            tabIndex={-1}
            title={inactiveWorktreeSelector.title}
            style={{
              width: "100%",
              height: 28,
              boxSizing: "border-box",
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              border: "none",
              borderRadius: "var(--radius-md)",
              background: "transparent",
              color: "var(--text-dim)",
              fontSize: 12,
              lineHeight: 1.35,
              whiteSpace: "nowrap",
              textAlign: "left",
              cursor: "default",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{inactiveWorktreeSelector.label}</span>
          </button>
        )}
      </div>

      {/* Projects and their tasks */}
      <SessionSearch open={sessionSearchOpen} query={sessionSearchQuery} refreshKey={sessionListVersion} selectedSessionId={selectedSessionId} onSelectSession={handleSelectSessionFromList}>
        <div
          ref={listScrollRef}
          onScroll={handleListScroll}
          style={{ flex: "1 1 auto", overflowY: "auto", padding: "0 6px 8px", minHeight: 80 }}
        >
          {loading && projectChoices.length === 0 && (
            <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
              {t("sidebar.loading")}
            </div>
          )}
          {error && (
            <div style={{ padding: "12px 14px", color: "var(--danger)", fontSize: 12 }}>
              {error}
            </div>
          )}
          {!loading && !error && visibleProjects.length === 0 && !chatProject && (
            <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
              {t("sidebar.noSessions")}
            </div>
          )}
          {/* fork:chat-workspace — 聊天分区：固定在最上面，自带标题行（新建 / 设置目录 /
              折叠），会话列表沿用项目那套高亮与虚拟窗口逻辑。 */}
          {chatProject && (() => {
            const isSelectedChat = chatProject.key === selectedProject?.key;
            const isChatExpanded = expandedProjects.has(chatProject.key);
            const chatFamilies = listSessionFamilies(orderedProjectSessions(chatProject.key));
            const chatArchivedFamilies = listSessionFamilies(archivedSessions(sessionsForProject(allSessions, chatProject.key), sessionFlags));
            const chatArchivedSection = (
              <ArchivedSessionsSection
                families={chatArchivedFamilies}
                expanded={expandedArchivedProjects.has(chatProject.key)}
                onToggle={() => toggleArchivedSection(chatProject.key)}
                selectedSessionId={selectedSessionId}
                runningSessionIds={runningSessionIds}
                unreadSessionIds={unreadSessionIds}
                sessionFlags={sessionFlags}
                onSelectSession={handleSelectSessionFromList}
                onRenamed={loadSessions}
                onDeleted={(id) => { onSessionDeleted?.(id); loadSessions(); }}
              />
            );
            const toggleChatExpanded = () => {
              setExpandedProjects((prev) => {
                const next = new Set(prev);
                if (next.has(chatProject.key)) next.delete(chatProject.key);
                else next.add(chatProject.key);
                return next;
              });
            };
            return (
              <div>
                <ChatWorkspaceRow
                  label={t("sidebar.chatWorkspace")}
                  title={chatProject.root}
                  selected={isSelectedChat}
                  expanded={isChatExpanded}
                  busy={chatWorkspaceBusy}
                  activity={projectActivity.get(chatProject.key)}
                  onToggle={toggleChatExpanded}
                  onConfigure={() => {
                    setChatPathError(null);
                    setChatPathOpen(true);
                  }}
                  onNewChat={() => startSessionIn(chatProject.root)}
                  onSelect={() => {
                    if (isSelectedChat) {
                      toggleChatExpanded();
                      return;
                    }
                    setSelectedCwd(chatProject.root);
                    setCustomPathError(null);
                    setProjectMenuOpen(false);
                  }}
                />
                {isChatExpanded && (chatFamilies.length === 0 && chatArchivedFamilies.length === 0 ? (
                  <div style={{ padding: "6px 0 6px 24px", color: "var(--text-dim)", fontSize: 12 }}>{t("sidebar.noTasks")}</div>
                ) : isSelectedChat ? (
                  <div ref={sessionListRef} style={{ minHeight: chatFamilies.length * SESSION_LIST_ITEM_HEIGHT }}>
                    <div style={{ position: "relative", height: chatFamilies.length * SESSION_LIST_ITEM_HEIGHT }}>
                      {virtualIndices.map((index) => {
                        const family = chatFamilies[index];
                        const familySessions = [family.root, ...family.subagents];
                        const displaySession = family.latestModified === family.root.modified ? family.root : { ...family.root, modified: family.latestModified };
                        return (
                          <div key={family.root.id} data-session-id={family.root.id} onFocus={() => setFocusedSessionId(family.root.id)} onBlur={() => setFocusedSessionId(null)} style={{ position: "absolute", top: index * SESSION_LIST_ITEM_HEIGHT, left: 0, right: 0, height: SESSION_LIST_ITEM_HEIGHT }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SessionItem session={displaySession} isSelected={familySessions.some((session) => session.id === selectedSessionId)} isRunning={familySessions.some((session) => runningSessionIds.has(session.id))} isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))} tag={sessionFlags.tags[family.root.id]} onClick={() => handleSelectSessionFromList(family.root)} onRenamed={loadSessions} onDeleted={(id) => { onSessionDeleted?.(id); loadSessions(); }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {chatArchivedSection}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {chatFamilies.map((family) => {
                      const familySessions = [family.root, ...family.subagents];
                      const displaySession = family.latestModified === family.root.modified ? family.root : { ...family.root, modified: family.latestModified };
                      return (
                        <div key={family.root.id}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <SessionItem session={displaySession} isSelected={familySessions.some((session) => session.id === selectedSessionId)} isRunning={familySessions.some((session) => runningSessionIds.has(session.id))} isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))} tag={sessionFlags.tags[family.root.id]} onClick={() => handleSelectSessionFromList(family.root)} onRenamed={loadSessions} onDeleted={(id) => { onSessionDeleted?.(id); loadSessions(); }} />
                          </div>
                        </div>
                      );
                    })}
                    {chatArchivedSection}
                  </div>
                ))}
              </div>
            );
          })()}

          <div
            style={{
              marginTop: 18,
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: 28,
              paddingLeft: 10,
              position: "relative",
            }}
            ref={projectMenuRef}
          >
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-dim)" }}>
              {t("sidebar.projects")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              {/* fork:ui-10 — order of the session lists (updated vs created). */}
              <button
                type="button"
                onClick={() => setSessionSort((current) => (current === "updated" ? "created" : "updated"))}
                title={`${t("sidebar.sortBy")}: ${t(sessionSort === "updated" ? "sidebar.sortUpdated" : "sidebar.sortCreated")}`}
                aria-label={t("sidebar.sortBy")}
                style={{
                  height: 28,
                  padding: "0 7px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h10M4 12h7M4 17h4" /><path d="m17 9 3 3-3 3" />
                </svg>
                {t(sessionSort === "updated" ? "sidebar.sortUpdated" : "sidebar.sortCreated")}
              </button>
              {/* fork:ui-10 — expand / collapse every project at once. */}
              <button
                type="button"
                onClick={() => {
                  const keys = visibleProjects.map((project) => project.key);
                  const allOpen = keys.length > 0 && keys.every((key) => expandedProjects.has(key));
                  setExpandedProjects(allOpen ? new Set() : new Set(keys));
                }}
                title={t("sidebar.expandCollapseAll")}
                aria-label={t("sidebar.expandCollapseAll")}
                style={{
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setProjectMenuOpen((open) => !open)}
                title={t("sidebar.projectActions")}
                aria-label={t("sidebar.projectActions")}
                aria-expanded={projectMenuOpen}
                style={{
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  background: projectMenuOpen ? "var(--bg-selected)" : "transparent",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  color: projectMenuOpen ? "var(--text)" : "var(--text-dim)",
                  cursor: "pointer",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="19" cy="12" r="1.5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleAddProjectClick}
                disabled={nativePicking || customPathValidating}
                title={nativePicking ? t("sidebar.checking") : t("sidebar.addProject")}
                aria-label={t("sidebar.addProject")}
                aria-busy={nativePicking}
                style={{
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-dim)",
                  cursor: nativePicking ? "wait" : "pointer",
                  opacity: nativePicking ? 0.6 : 1,
                }}
              >
                {nativePicking ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ animation: "spin 0.8s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                )}
              </button>
            </div>
            <AnimatedDropdown
              open={projectMenuOpen}
              style={{
                position: "absolute",
                top: "calc(100% + 2px)",
                left: 0,
                right: 0,
                zIndex: 100,
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-lg)",
                overflow: "hidden",
                padding: "6px 0",
              }}
            >
              {selectedProject && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", color: "var(--text)", fontWeight: 600, fontSize: 13 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--accent)" }} aria-hidden="true">
                    <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getFileName(selectedProject.root) || selectedProject.root}</span>
                  <span style={{ color: "var(--success)", flexShrink: 0 }}>✓</span>
              </div>
            )}
              {/* fork:ui-project-wording — same vocabulary as the new-task picker and the
              sidebar sections: 在项目中 / 不在项目中. */}
              <div style={{ padding: "4px 12px 2px", fontSize: 11, color: "var(--text-dim)", fontWeight: 500 }}>{t("sidebar.projects")}</div>
              {visibleProjects.slice(0, 8).map((project) => (
                <button
                  key={project.key}
                  type="button"
                  onClick={() => {
                    setSelectedCwd(project.root);
                    setCustomPathError(null);
                    setProjectMenuOpen(false);
                  }}
                  title={project.root}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: project.key === selectedProject?.key ? "var(--bg-selected)" : "transparent", border: "none", color: project.key === selectedProject?.key ? "var(--text)" : "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12.5 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
                    <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getFileName(project.root) || project.root}</span>
                </button>
              ))}
              <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
              <button type="button" onClick={() => void handleDefaultCwd()} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12.5 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
                {t("sidebar.useDefaultDirectory")}
              </button>
            </AnimatedDropdown>
          </div>

          {visibleProjects.map((project) => {
            const isSelectedProject = project.key === selectedProject?.key;
            const count = sessionsForProject(allSessions, project.key).length;
            const isExpanded = expandedProjects.has(project.key);
            return (
              <div key={project.key}>
                <ProjectRow
                  label={getFileName(project.root) || project.root}
                  title={project.root}
                  selected={isSelectedProject}
                  count={count}
                  expanded={isExpanded}
                  onToggle={() => {
                    setExpandedProjects((prev) => {
                      const next = new Set(prev);
                      if (next.has(project.key)) next.delete(project.key);
                      else next.add(project.key);
                      return next;
                    });
                  }}
                  activity={projectActivity.get(project.key)}
                  onClick={() => {
                    if (isSelectedProject) {
                      // 再次点击已选中的项目：折叠/展开切换，而不是无意义地重选
                      setExpandedProjects((prev) => {
                        const next = new Set(prev);
                        if (next.has(project.key)) next.delete(project.key);
                        else next.add(project.key);
                        return next;
                      });
                      return;
                    }
                    setSelectedCwd(project.root);
                    setCustomPathError(null);
                    setProjectMenuOpen(false);
                  }}
                />
                {isExpanded &&
                  (() => {
                    const projectSessions = orderedProjectSessions(project.key);
                    const families = listSessionFamilies(projectSessions);
                    const archivedFamilies = listSessionFamilies(archivedSessions(projectSessions, sessionFlags));
                    const archivedSection = (
                      <ArchivedSessionsSection
                        families={archivedFamilies}
                        expanded={expandedArchivedProjects.has(project.key)}
                        onToggle={() => toggleArchivedSection(project.key)}
                        selectedSessionId={selectedSessionId}
                        runningSessionIds={runningSessionIds}
                        unreadSessionIds={unreadSessionIds}
                        sessionFlags={sessionFlags}
                        onSelectSession={handleSelectSessionFromList}
                        onRenamed={loadSessions}
                        onDeleted={(id) => { onSessionDeleted?.(id); loadSessions(); }}
                      />
                    );
                    if (families.length === 0 && archivedFamilies.length === 0) {
                      return (
                        <div style={{ padding: "6px 0 6px 34px", color: "var(--text-dim)", fontSize: 12 }}>{t("sidebar.noTasks")}</div>
                      );
                    }
                    if (project.key === selectedProject?.key) {
                      return (
                        <div ref={sessionListRef} style={{ minHeight: sessionFamilies.length > 0 ? sessionFamilies.length * SESSION_LIST_ITEM_HEIGHT : 34 }}>
                          {sessionFamilies.length > 0 && (
                            <div style={{ position: "relative", height: sessionFamilies.length * SESSION_LIST_ITEM_HEIGHT }}>
                              {virtualIndices.map((index) => {
                                const family = sessionFamilies[index];
                                const familySessions = [family.root, ...family.subagents];
                                const displaySession = family.latestModified === family.root.modified ? family.root : { ...family.root, modified: family.latestModified };
                                return (
                                  <div key={family.root.id} data-session-id={family.root.id} onFocus={() => setFocusedSessionId(family.root.id)} onBlur={() => setFocusedSessionId(null)} style={{ position: "absolute", top: index * SESSION_LIST_ITEM_HEIGHT, left: 0, right: 0, height: SESSION_LIST_ITEM_HEIGHT }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <SessionItem session={displaySession} isSelected={familySessions.some((session) => session.id === selectedSessionId)} isRunning={familySessions.some((session) => runningSessionIds.has(session.id))} isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))} tag={sessionFlags.tags[family.root.id]} onClick={() => handleSelectSessionFromList(family.root)} onRenamed={loadSessions} onDeleted={(id) => { onSessionDeleted?.(id); loadSessions(); }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {archivedSection}
                        </div>
                      );
                    }
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginLeft: 8, borderLeft: "1px solid var(--border-faint)", paddingLeft: 4 }}>
                        {families.map((family) => {
                          const familySessions = [family.root, ...family.subagents];
                          const displaySession = family.latestModified === family.root.modified ? family.root : { ...family.root, modified: family.latestModified };
                          return (
                            <div key={family.root.id}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <SessionItem session={displaySession} isSelected={familySessions.some((session) => session.id === selectedSessionId)} isRunning={familySessions.some((session) => runningSessionIds.has(session.id))} isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))} tag={sessionFlags.tags[family.root.id]} onClick={() => handleSelectSessionFromList(family.root)} onRenamed={loadSessions} onDeleted={(id) => { onSessionDeleted?.(id); loadSessions(); }} />
                              </div>
                            </div>
                          );
                        })}
                        {archivedSection}
                      </div>
                    );
                  })()}
              </div>
            );
          })}
        </div>
      </SessionSearch>

    </div>
  );
}

/** fork:ui-10 — the manual-status dot (tooltip carries the wording). */
function SessionTagDot({ tag }: { tag: SessionTag }) {
  const { t } = useI18n();
  const label = t(`session.tag.${tag}`);
  return (
    <span
      title={label}
      aria-label={label}
      style={{ width: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: SESSION_TAG_TONES[tag] }} />
    </span>
  );
}

function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.newActivity")}
      aria-label={t("sidebar.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
          <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

/**
 * Compact per-project activity badges for the workspace selector dropdown items:
 * a spinning running icon + count and an unread dot + count. Renders nothing
 * when the project has no activity. Counts share the accent / unread colors of
 * the per-session indicators so the two stay visually consistent.
 */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
): ReactNode {
  if (!activity || (activity.running === 0 && activity.unread === 0)) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
      {activity.running > 0 && (
        <span
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${activity.running})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <g>
              <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
            </g>
          </svg>
          {activity.running}
        </span>
      )}
      {activity.unread > 0 && (
        <span
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {activity.unread}
        </span>
      )}
    </span>
  );
}

/**
 * Collapsed-by-default recovery list for one project's archived sessions.
 *
 * Archived rows are hidden from the main list by `applySessionFlags`, so this
 * section is the only place a row can be right-clicked back to unarchived.
 * Rows reuse `SessionItem` unchanged (the row dispatches the context-menu
 * event), and stay non-virtualized because an expanded archive is bounded by
 * how many sessions the user chose to hide.
 */
function ArchivedSessionsSection({
  families,
  expanded,
  onToggle,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  sessionFlags,
  onSelectSession,
  onRenamed,
  onDeleted,
}: {
  families: SessionFamily[];
  expanded: boolean;
  onToggle: () => void;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  sessionFlags: { tags: Record<string, SessionTag> };
  onSelectSession: (session: SessionInfo) => void;
  onRenamed: () => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  if (families.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={t("sidebar.archivedCount", { count: families.length })}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: "100%",
          height: 28,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 9px",
          marginTop: 2,
          background: hovered ? "var(--bg-hover)" : "transparent",
          border: "none",
          borderRadius: "var(--radius-md)",
          color: "var(--text-dim)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 12,
          transition: "background 0.12s",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0, transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("sidebar.archived")}
        </span>
        <span style={{ flexShrink: 0, minWidth: 14, textAlign: "right" }}>{families.length}</span>
      </button>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {families.map((family) => {
            const familySessions = [family.root, ...family.subagents];
            const displaySession = family.latestModified === family.root.modified ? family.root : { ...family.root, modified: family.latestModified };
            return (
              <div key={family.root.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SessionItem session={displaySession} isSelected={familySessions.some((session) => session.id === selectedSessionId)} isRunning={familySessions.some((session) => runningSessionIds.has(session.id))} isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))} tag={sessionFlags.tags[family.root.id]} onClick={() => onSelectSession(family.root)} onRenamed={onRenamed} onDeleted={onDeleted} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  tag,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  /** fork:ui-10 — manual status tag; drives the coloured dot. */
  tag?: SessionTag;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { locale, t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const showHover = hovered;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Select the whole name once the rename input is mounted (startRename's
  // immediate setTimeout can fire before the input exists).
  useEffect(() => {
    if (renaming) {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [renaming]);

  // A stored first message may be an SDK-expanded <skill> block; collapse it
  // back to the compact /skill:name args command the user typed before using
  // it as the auto-name fallback, mirroring MessageView's rendering.
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  const title = session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.transient) return;
    setRenameValue(session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12));
    setRenaming(true);
  }, [session.name, session.transient, displayFirstMessage, session.id]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same collapsed displayFirstMessage, so an untouched rename of
    // a skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed, title]);

  const performDelete = useCallback(async () => {
    if (session.transient) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, session.transient, onDeleted]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      void performDelete();
    } else {
      setConfirmDelete(true);
    }
  }, [performDelete]);

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: e.clientX,
      clientY: e.clientY,
      refresh: () => { onRenamed?.(); },
    });
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  }, [onRenamed, session.cwd, session.id, session.name, session.path]);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
      onContextMenu={confirmDelete || renaming ? undefined : handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        // Inset the pill inside its 34px virtual slot so consecutive rows read as
        // separate chips instead of one continuous block (user feedback
        // 2026-09-16: the project header and the first session were touching).
        height: SESSION_LIST_ITEM_HEIGHT - 8,
        marginTop: 4,
        display: "flex",
        alignItems: "center",
        marginLeft: 12,
        marginRight: 0,
        paddingLeft: depth > 0 ? depth * 8 + 8 : 10,
        paddingRight: 4,
        borderRadius: "var(--radius-md)",
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "var(--danger-soft)"
          : isSelected ? "var(--bg-selected)" : showHover ? "var(--bg-hover)" : "transparent",
        boxShadow: confirmDelete
          ? "inset 0 0 0 1px color-mix(in srgb, var(--danger) 40%, transparent)"
          : "none",
        transition: "background 0.12s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "var(--danger)", border: "none",
                borderRadius: "var(--radius-md)", color: "#ffffff",
                whiteSpace: "nowrap",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              {t("sidebar.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "transparent", border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)", color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("sidebar.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius-xs)",
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view: single-line Codex pill row ── */
        <>
          {/* Subagent indicator for child sessions */}
          {depth > 0 && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="5" y="7" width="14" height="11" rx="2" />
              <path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
            </svg>
          )}
          {isRunning
            ? <RunningSessionIndicator />
            : tag
              ? <SessionTagDot tag={tag} />
              : isUnread ? <UnreadSessionIndicator /> : null}
          <span
            title={`${title} · ${formatRelativeTime(session.modified, locale)}`}
            style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5, fontWeight: isSelected ? 500 : 400, lineHeight: 1.3, color: "var(--text)" }}
          >
            {title}
          </span>
          {session.isWorktree && session.branch && (
            <span
              title={`Worktree: ${session.cwd}`}
              style={{ display: "flex", alignItems: "center", color: "var(--accent)", flexShrink: 0 }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            </span>
          )}

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 18, height: 18, padding: 0, flexShrink: 0,
                background: "none", border: "none", borderRadius: "var(--radius-sm)",
                color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Hover actions appear over the title's trailing edge; nothing is
              reserved when idle so the title uses the full row width. The
              relative time stays available in the title tooltip above.
              Also shown when a row slides under a stationary pointer after a
              delete reflows the list (see syncPointerSession). */}
          {showHover && !session.transient ? (
            <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
              <button
                onClick={startRename}
                title={t("sidebar.rename")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 24, height: 24, padding: 0,
                  background: "transparent", border: "none",
                  borderRadius: "var(--radius-md)", color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
              <button
                onClick={handleDeleteClick}
                title={t("sidebar.deleteWithShiftClick")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 24, height: 24, padding: 0,
                  background: "transparent", border: "none",
                  borderRadius: "var(--radius-md)", color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--danger-soft)";
                  e.currentTarget.style.color = "var(--danger)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
