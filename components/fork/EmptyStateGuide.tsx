"use client";

/**
 * fork:zc-17 — 零会话首屏的三条起步路径 + 能力提示轮播。
 *
 * 为什么需要：一台新机器第一次打开时，侧栏没有任何会话，用户看到的只有一句
 * 「在 … 里做点什么?」和输入框 —— 想开工得先自己找到「选目录」的入口，或者知道
 * 这个应用会扫描别的编辑器最近打开的工作区。这里把「先落到哪里」的三条路直接摆出来。
 *
 * 复用而不是新造：
 *   - 「选目录 / 用最近项目」都走 ChatWindow 已有的 `newSessionTargets`
 *     （`onOpenFolder` / `onPickProject`，与 ProjectChip、侧栏 NewTaskPicker 同一条
 *     `/api/cwd/validate` 注册 allow-root 的路径）；
 *   - 最近项目列表复用 `/api/recent-projects`（`lib/recent-projects.ts`）——只读、
 *     best-effort，打开面板时才请求；
 *   - 能力提示行直接复用 `ComposerTipLine`（MU-33 的轮播实现），ChatWindow 在引导
 *     出现时收掉 composer 上方那一份，避免同一句提示出现两次。
 *
 * 有意保持小巧：只有一个组件、一次懒请求、不引入任何新状态存储。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";
import type { RecentProject } from "@/lib/recent-projects";
import type { NewSessionTargets } from "./ProjectChip";
import { ComposerTipLine } from "./ComposerTipLine";

/** 从会话链接或裸 id 里取出会话 id；解析不出来返回 null（纯函数，便于复用/测试）。 */
export function parseSessionReference(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const fromUrl = /[?&]session=([^&#\s]+)/.exec(value);
  if (fromUrl?.[1]) {
    try {
      return decodeURIComponent(fromUrl[1]);
    } catch {
      return fromUrl[1];
    }
  }
  // 裸 id：pi 的会话 id 是 uuid/hex，允许 . _ - 但不容忍空白或路径分隔符。
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{5,}$/.test(value)) return value;
  return null;
}

function baseName(target: string): string {
  const trimmed = target.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || target;
}

function normalizePathKey(target: string): string {
  return target.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

const CARD_STYLE = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
  padding: "10px 12px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border-faint)",
  borderRadius: "var(--radius-lg)",
  color: "var(--text)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: TEXT.sm,
} as const;

function PathIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function RecentIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ImportIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function EmptyStateGuide({
  targets,
  onOpenSession,
  visible = true,
}: {
  targets: NewSessionTargets | null;
  onOpenSession?: (sessionId: string) => void;
  /** ChatWindow 决定是否出现（空新会话 + 尚无任何项目/会话）。 */
  visible?: boolean;
}): ReactNode {
  const { t } = useI18n();
  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<RecentProject[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  // 打开「最近项目」时才请求：平时不发请求，与 NewTaskPicker 同一策略。
  useEffect(() => {
    if (!recentOpen || recent !== null || recentLoading) return;
    let cancelled = false;
    setRecentLoading(true);
    void fetch("/api/recent-projects")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { projects?: RecentProject[] } | null) => {
        if (!cancelled) setRecent(data?.projects ?? []);
      })
      .catch(() => { if (!cancelled) setRecent([]); })
      .finally(() => { if (!cancelled) setRecentLoading(false); });
    return () => { cancelled = true; };
  }, [recent, recentLoading, recentOpen]);

  const pickFromPath = useCallback((path: string) => {
    if (!targets) return;
    const key = normalizePathKey(path);
    const known = targets.projects.find((project) => normalizePathKey(project.root) === key);
    if (known) {
      targets.onPickProject(known);
      return;
    }
    // 不在已知项目里（来自其它编辑器的最近工作区）：root 即身份，
    // AppShell 的 startSessionIn 会先走 /api/cwd/validate 注册 allow-root。
    targets.onPickProject({ key: path, root: path, name: baseName(path) });
  }, [targets]);

  const submitImport = useCallback(() => {
    const sessionId = parseSessionReference(importValue);
    if (!sessionId) {
      setImportError(t("home.guideImportInvalid"));
      return;
    }
    if (!onOpenSession) {
      setImportError(t("home.guideImportUnavailable"));
      return;
    }
    setImportError(null);
    onOpenSession(sessionId);
  }, [importValue, onOpenSession, t]);

  if (!visible || !targets) return null;

  const recentCandidates = (recent ?? []).slice(0, 5);

  return (
    <section
      aria-label={t("home.guideTitle")}
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "100%",
        maxWidth: 720,
        margin: "0 auto",
        padding: "14px 16px 0",
      }}
    >
      <div style={{ fontSize: TEXT.xs, fontWeight: 600, color: "var(--text-dim)", letterSpacing: "0.02em" }}>
        {t("home.guideTitle")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <button
          type="button"
          onClick={() => targets.onOpenFolder()}
          style={CARD_STYLE}
          onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "var(--bg-panel)"; }}
        >
          <span style={{ color: "var(--text-muted)", display: "flex" }}><PathIcon /></span>
          <span style={{ fontWeight: 600 }}>{t("home.guidePickFolder")}</span>
          <span style={{ color: "var(--text-dim)", fontSize: TEXT.xs }}>{t("home.guidePickFolderHint")}</span>
        </button>

        <button
          type="button"
          onClick={() => setRecentOpen((open) => !open)}
          aria-expanded={recentOpen}
          style={CARD_STYLE}
          onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "var(--bg-panel)"; }}
        >
          <span style={{ color: "var(--text-muted)", display: "flex" }}><RecentIcon /></span>
          <span style={{ fontWeight: 600 }}>{t("home.guideRecent")}</span>
          <span style={{ color: "var(--text-dim)", fontSize: TEXT.xs }}>{t("home.guideRecentHint")}</span>
        </button>

        <button
          type="button"
          onClick={() => setImportOpen((open) => !open)}
          aria-expanded={importOpen}
          style={CARD_STYLE}
          onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "var(--bg-panel)"; }}
        >
          <span style={{ color: "var(--text-muted)", display: "flex" }}><ImportIcon /></span>
          <span style={{ fontWeight: 600 }}>{t("home.guideImport")}</span>
          <span style={{ color: "var(--text-dim)", fontSize: TEXT.xs }}>{t("home.guideImportHint")}</span>
        </button>
      </div>

      {recentOpen && (
        <div style={{ display: "grid", gap: 2, padding: "6px 8px", border: "1px solid var(--border-faint)", borderRadius: "var(--radius-md)", background: "var(--bg)" }}>
          {recentLoading && <span style={{ color: "var(--text-dim)", fontSize: TEXT.xs }}>{t("home.guideRecentLoading")}</span>}
          {!recentLoading && recentCandidates.length === 0 && (
            <span style={{ color: "var(--text-dim)", fontSize: TEXT.xs }}>{t("home.guideRecentEmpty")}</span>
          )}
          {recentCandidates.map((project) => (
            <button
              key={project.path}
              type="button"
              title={project.path}
              onClick={() => pickFromPath(project.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "4px 6px",
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: TEXT.sm,
              }}
              onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; event.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = "none"; event.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {baseName(project.path)}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: "var(--text-dim)", fontSize: TEXT["2xs"], flexShrink: 0 }}>{project.source}</span>
            </button>
          ))}
        </div>
      )}

      {importOpen && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <input
            value={importValue}
            onChange={(event) => { setImportValue(event.target.value); setImportError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) submitImport(); }}
            placeholder={t("home.guideImportPlaceholder")}
            aria-label={t("home.guideImport")}
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 180,
              padding: "6px 9px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontSize: TEXT.sm,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={submitImport}
            style={{
              padding: "6px 12px",
              border: "1px solid var(--primary-bg)",
              borderRadius: "var(--radius-md)",
              background: "var(--primary-bg)",
              color: "var(--primary-fg)",
              cursor: "pointer",
              fontSize: TEXT.sm,
              fontWeight: 600,
            }}
          >
            {t("home.guideImportAction")}
          </button>
          {importError && (
            <span role="alert" style={{ color: "var(--danger)", fontSize: TEXT.xs, width: "100%" }}>{importError}</span>
          )}
        </div>
      )}

      {/* 能力提示轮播：与 composer 上方共用同一实现，避免两边各写一套「不重复上一条」逻辑。 */}
      <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
        <ComposerTipLine />
      </div>
    </section>
  );
}
