"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  SkillInfo as Skill,
  SkillInstallScope,
  SkillSearchResult,
  SkillsResponse,
  SkillUpdateResult,
} from "@/lib/api-types";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigSectionTitle,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";
import { MarkdownBody } from "./MarkdownBody";
import { TEXT } from "@/lib/typography";

function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

export function orderSkillsByDormancy<
  T extends Pick<Skill, "disableModelInvocation">,
>(skills: T[]): T[] {
  return [
    ...skills.filter((skill) => !skill.disableModelInvocation),
    ...skills.filter((skill) => skill.disableModelInvocation),
  ];
}

function updateKey(skill: Skill): string | null {
  return skill.install
    ? `${skill.install.scope}\0${skill.install.package}`
    : null;
}

function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

function SkillDetail({
  skill,
  cwd,
  onToggle,
  toggling,
  saveError,
  updateStatus,
  checkingUpdate,
  updating,
  updateError,
  onCheckUpdate,
  onUpdate,
  onContentSaved,
}: {
  skill: Skill;
  cwd: string;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  updateStatus?: SkillUpdateResult;
  checkingUpdate: boolean;
  updating: boolean;
  updateError: string | null;
  onCheckUpdate: () => void;
  onUpdate: () => void;
  onContentSaved?: () => void;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;

  // fork:skills-content — 正文读取 / 就地编辑。
  // 以前这里只有 name + description（frontmatter 的两个字段），正文得另外去文件浏览器
  // 找，而全局技能目录（~/.pi/agent/skills、~/.agents/skills）根本不在 /api/files 的
  // 允许根里。现在走 /api/skills/content：与 /api/skills PATCH 同一套根校验。
  const [content, setContent] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingContent, setLoadingContent] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingContent(true);
    setContentError(null);
    setEditing(false);
    setSavedAt(false);
    void fetch(`/api/skills/content?filePath=${encodeURIComponent(skill.filePath)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { content?: string; error?: string };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        return data.content ?? "";
      })
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setDraft(text);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setContent(null);
        setContentError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false);
      });
    return () => { cancelled = true; };
  }, [skill.filePath]);

  const saveContent = async () => {
    setSaving(true);
    setContentError(null);
    try {
      const response = await fetch("/api/skills/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // baseContent = 打开时读到的原文，服务端据此做乐观并发检查（409）。
        body: JSON.stringify({ filePath: skill.filePath, content: draft, baseContent: content ?? "" }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; content?: string };
      if (response.status === 409) {
        // 文件被别的进程改过：把磁盘上的新内容换成当前草稿的基线，让用户先看再决定。
        setContent(data.content ?? null);
        setDraft(data.content ?? draft);
        throw new Error(t("skills.changedOnDisk"));
      }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setContent(draft);
      setEditing(false);
      setSavedAt(true);
      // frontmatter 里就是 name / description，改完要让左侧列表跟着刷新。
      onContentSaved?.();
    } catch (error) {
      setContentError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  return (
    <ConfigDetailStack>
      {/* Path + tag + toggle, with a stable status row below. */}
      <div className="skill-detail-heading">
        <ConfigDetailHeader>
          <ConfigDetailHeaderInfo>
            <span className={`config-scope-tag${label === "project" ? " is-project" : ""}`}>
              {label}
            </span>
            <span className="config-detail-path">
              {displayPath(skill.filePath)}
            </span>
          </ConfigDetailHeaderInfo>
          <ConfigDetailActions>
            <ConfigSwitch
              checked={enabled}
              loading={toggling}
              label={enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}
              onChange={() => onToggle(skill)}
            />
          </ConfigDetailActions>
        </ConfigDetailHeader>
        <div className="skill-detail-status-row">
          {!enabled && (
            <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)" }}>
              {t("i18n.hiddenButInvocable")}
            </span>
          )}
          {saveError && (
            <span style={{ fontSize: TEXT.sm, color: "var(--danger)", overflowWrap: "anywhere" }}>
              {saveError}
            </span>
          )}
        </div>
      </div>

      {skill.install?.skillsShUrl && (
        <ConfigField label="Source">
          <a
            href={skill.install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
            title={skill.install.skillsShUrl}
            className="skill-source-link"
          >
            <span className="skill-source-link-text">
              {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
            </span>
          </a>
        </ConfigField>
      )}

      {skill.install && (
        <ConfigField label="Version">
          <div className="skill-version-row">
            <span className="skill-version-value">
              {shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
            </span>
            {skill.install.canCheckForUpdates && (
              <ConfigButton
                size="small"
                onClick={onCheckUpdate}
                disabled={checkingUpdate || updating}
              >
                 {t("i18n.check")}
              </ConfigButton>
            )}
            {updateStatus?.state === "update-available" && (
              <span className="skill-version-value is-update">
                {shortVersion(updateStatus.latestVersion)}
              </span>
            )}
            {(checkingUpdate ||
              (updateStatus && updateStatus.state !== "update-available")) && (
              <span
                className={`skill-update-status ${checkingUpdate
                  ? "is-checking"
                  : updateStatus?.state === "up-to-date"
                    ? "is-success"
                    : updateStatus?.state === "error"
                      ? "is-error"
                      : "is-muted"}`}
              >
                {checkingUpdate
                   ? t("i18n.checking")
                  : updateStatus?.state === "up-to-date"
                     ? t("i18n.upToDate")
                    : updateStatus?.state === "unsupported"
                         ? t("i18n.automaticChecksUnavailable")
                         : updateStatus?.message || t("i18n.checkFailed")}
              </span>
            )}
            {updateStatus?.state === "update-available" && (
              <ConfigButton
                variant="primary"
                size="small"
                onClick={onUpdate}
                disabled={updating || checkingUpdate}
              >
                 {updating ? t("i18n.updating") : t("i18n.update")}
              </ConfigButton>
            )}
          </div>
          {updateError && (
            <span style={{ fontSize: TEXT.sm, color: "var(--danger)" }}>{updateError}</span>
          )}
        </ConfigField>
      )}

      <ConfigField label="Name">
        <span className="skill-name-value">
          {skill.name}
        </span>
      </ConfigField>

      <ConfigField label="Description">
        <span className="skill-description">
          {skill.description}
        </span>
      </ConfigField>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <ConfigSectionTitle>{t("skills.content")}</ConfigSectionTitle>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            {savedAt && !editing && (
              <span style={{ fontSize: TEXT.xs, color: "var(--success)" }}>{t("i18n.saved")}</span>
            )}
            {content !== null && !editing && (
              <ConfigButton size="small" onClick={() => { setDraft(content); setEditing(true); setSavedAt(false); }}>
                {t("skills.edit")}
              </ConfigButton>
            )}
            {editing && (
              <>
                <ConfigButton
                  size="small"
                  disabled={saving}
                  onClick={() => { setDraft(content ?? ""); setEditing(false); setContentError(null); }}
                >
                  {t("i18n.cancel")}
                </ConfigButton>
                <ConfigButton
                  variant="primary"
                  size="small"
                  disabled={saving}
                  onClick={() => { void saveContent(); }}
                >
                  {saving ? t("i18n.saving") : t("i18n.save")}
                </ConfigButton>
              </>
            )}
          </div>
        </div>

        {loadingContent ? (
          <div className="config-sidebar-message">{t("i18n.loading")}</div>
        ) : editing ? (
          <>
            <textarea
              className="skill-content-editor"
              value={draft}
              spellCheck={false}
              aria-label={`${t("skills.content")} · ${skill.name}`}
              onChange={(event) => setDraft(event.target.value)}
            />
            <p className="settings-chat-range-hint" style={{ marginTop: 6 }}>{t("skills.contentHint")}</p>
          </>
        ) : content !== null ? (
          <div className="skill-content-view">
            <MarkdownBody>{content}</MarkdownBody>
          </div>
        ) : (
          <div className="config-sidebar-message is-error">
            {contentError ? `${t("skills.contentLoadFailed")}: ${contentError}` : t("skills.contentLoadFailed")}
          </div>
        )}
        {editing && contentError && (
          <div className="config-sidebar-message is-error">{t("skills.saveFailed")}: {contentError}</div>
        )}
      </div>
    </ConfigDetailStack>
  );
}

function AddSkillPanel({
  cwd,
  installedPackages,
  projectResourcesLoaded,
  onInstalled,
}: {
  cwd: string;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  projectResourcesLoaded: boolean;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [newlyInstalledPkgs, setNewlyInstalledPkgs] = useState<Set<string>>(
    new Set(),
  );
  const [scope, setScope] = useState<"global" | "project">("global");
  // fork:skillhub — 两个市场：skills.sh（原来的，npx 安装）与 SkillHub
  // （skillhub.cn，直接下 ZIP，不经 CLI）。切到 SkillHub 时会先按评分列一页，
  // 因为那边「按评分浏览」本身就是主要用法。
  const [source, setSource] = useState<"skills.sh" | "skillhub">("skills.sh");
  const [skillhubTotal, setSkillhubTotal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string, from: "skills.sh" | "skillhub" = source) => {
    // skills.sh 必须有关键词；SkillHub 留空 = 按评分浏览（它的默认视图）。
    if (!q.trim() && from !== "skillhub") return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    setSkillhubTotal(0);
    try {
      const res = from === "skillhub"
        ? await fetch("/api/skills/skillhub", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q.trim(), pageSize: 30 }),
          })
        : await fetch("/api/skills/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q.trim() }),
          });
      const d = (await res.json()) as {
        results?: SkillSearchResult[];
        total?: number;
        error?: string;
      };
      if (d.error) {
        setSearchError(d.error);
        return;
      }
      setResults(d.results ?? []);
      if (from === "skillhub" && typeof d.total === "number") setSkillhubTotal(d.total);
      if ((d.results ?? []).length === 0) setSearchError("No skills found");
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, [source]);

  // 切到 SkillHub 就先按评分列一屏，省得对着空列表不知道能搜什么。
  const switchSource = useCallback((next: "skills.sh" | "skillhub") => {
    setSource(next);
    setResults([]);
    setSearchError(null);
    setSkillhubTotal(0);
    if (next === "skillhub") void search(query, "skillhub");
  }, [query, search]);

  const install = useCallback(
    async (pkg: string, from: "skills.sh" | "skillhub" = "skills.sh") => {
      setInstalling(pkg);
      setInstallError(null);
      try {
        // SkillHub 走直接下载 ZIP 的那条；skills.sh 仍然交给 skills CLI。
        const res = from === "skillhub"
          ? await fetch("/api/skills/install-skillhub", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug: pkg, scope, cwd }),
            })
          : await fetch("/api/skills/install", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ package: pkg, scope, cwd }),
            });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setInstallError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        setNewlyInstalledPkgs((prev) =>
          new Set(prev).add(`${scope}:${pkg}`),
        );
        onInstalled();
      } catch (e) {
        setInstallError(String(e));
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled, scope, cwd],
  );

  const installPath =
    scope === "global"
      ? "~/.pi/agent/skills/"
      : `${shortenPath(cwd)}/.pi/skills/`;

  return (
    <ConfigDetailStack className="is-full-height">
      {/* ── Header area ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <ConfigDetailTitle>{t("i18n.addSkill")}</ConfigDetailTitle>

        {/* fork:skillhub — 市场切换：skills.sh（CLI 安装）↔ SkillHub（直接下载） */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              display: "flex",
              borderRadius: "var(--radius-xs)",
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: TEXT.sm,
              flexShrink: 0,
            }}
          >
            {(["skills.sh", "skillhub"] as const).map((id) => (
              <button
                key={id}
                onClick={() => switchSource(id)}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: "pointer",
                  background: source === id ? "var(--bg-selected)" : "none",
                  color: source === id ? "var(--text)" : "var(--text-dim)",
                  fontWeight: source === id ? 600 : 400,
                  borderRight: id === "skills.sh" ? "1px solid var(--border)" : "none",
                }}
              >
                {id === "skills.sh" ? "skills.sh" : "SkillHub"}
              </button>
            ))}
          </div>
          {source === "skillhub" && (
            <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)" }}>
              {skillhubTotal > 0 ? t("skills.skillhubTotal", { total: skillhubTotal }) : t("skills.skillhubHint")}
            </span>
          )}
        </div>

        {/* Search row */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search(query);
            }}
             placeholder={t("i18n.skillSearchPlaceholder")}
            style={{
              flex: 1,
              padding: "7px 10px",
              fontSize: TEXT.sm,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              outline: "none",
            }}
          />
          <ConfigButton
            variant="primary"
            onClick={() => search(query)}
            disabled={searching || (!query.trim() && source !== "skillhub")}
          >
             {searching ? t("i18n.searching") : t("i18n.search")}
          </ConfigButton>
        </div>

        {/* Scope + install path row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              borderRadius: "var(--radius-xs)",
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: TEXT.sm,
              flexShrink: 0,
            }}
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  if (s === "global" || projectResourcesLoaded) setScope(s);
                }}
                disabled={s === "project" && !projectResourcesLoaded}
                title={s === "project" && !projectResourcesLoaded ? t("trust.projectScopeUnavailable") : undefined}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: s === "project" && !projectResourcesLoaded ? "not-allowed" : "pointer",
                  background: scope === s ? "var(--bg-selected)" : "none",
                  color: scope === s ? "var(--text)" : "var(--text-dim)",
                  fontWeight: scope === s ? 600 : 400,
                  opacity: s === "project" && !projectResourcesLoaded ? 0.45 : 1,
                  borderRight:
                    s === "global" ? "1px solid var(--border)" : "none",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <span
            style={{
              fontSize: TEXT.sm,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            → {installPath}
          </span>
        </div>

        {/* Errors */}
        {searchError && (
          <div style={{ fontSize: TEXT.sm, color: "var(--danger)" }}>{searchError}</div>
        )}
        {installError && (
          <div
            style={{ fontSize: TEXT.sm, color: "var(--danger)", wordBreak: "break-word" }}
          >
            {installError}
          </div>
        )}
      </div>

      {/* ── Results list ── */}
      {results.length > 0 ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {results.map((r) => {
            const isInstalled =
              installedPackages[scope].has(r.package) ||
              newlyInstalledPkgs.has(`${scope}:${r.package}`);
            const isInstalling = installing === r.package;
            const rowSource = r.source ?? "skills.sh";
            // split "owner/repo@skill" for cleaner display
            const atIdx = r.package.indexOf("@");
            const repopart = atIdx > -1 ? r.package.slice(0, atIdx) : r.package;
            const skillpart = atIdx > -1 ? r.package.slice(atIdx + 1) : null;
            return (
              <div
                key={r.package}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* skill name prominent */}
                  <div
                    style={{
                      fontSize: TEXT.md,
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: 3,
                    }}
                  >
                    {skillpart ?? repopart}
                  </div>
                  {/* fork:skillhub — SkillHub 的条目带摘要，装之前能看清是什么 */}
                  {r.description && (
                    <div
                      style={{
                        fontSize: TEXT.xs,
                        color: "var(--text-muted)",
                        marginBottom: 4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {r.description}
                    </div>
                  )}
                  {/* repo + installs + link row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: TEXT.xs,
                        color: "var(--text-dim)",
                      }}
                    >
                      {repopart}
                    </span>
                    <span
                      style={{
                        fontSize: TEXT.sm,
                        color: "var(--text-muted)",
                        fontWeight: 500,
                      }}
                    >
                      {r.installs}
                    </span>
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: TEXT.sm,
                          color: "var(--accent)",
                          textDecoration: "none",
                        }}
                      >
                        {rowSource === "skillhub" ? "skillhub.cn ↗" : "skills.sh ↗"}
                      </a>
                    )}
                  </div>
                </div>
                <ConfigButton
                  size="small"
                  onClick={() =>
                    !isInstalled && !isInstalling && install(r.package, rowSource)
                  }
                  disabled={isInstalled || isInstalling || installing !== null}
                  style={{
                    flexShrink: 0,
                    background: isInstalled ? "rgba(34,197,94,0.1)" : "none",
                    color: isInstalled
                      ? "var(--success)"
                      : isInstalling
                        ? "var(--accent)"
                        : "var(--text-muted)",
                  }}
                >
                  {isInstalled
                     ? `✓ ${t("i18n.installed")}`
                    : isInstalling
                       ? t("i18n.installing")
                       : t("i18n.install")}
                </ConfigButton>
              </div>
            );
          })}
        </div>
      ) : (
        !searchError &&
        !searching && (
          <div
            style={{ fontSize: TEXT.md, color: "var(--text-dim)", lineHeight: 1.8 }}
          >
            Search{" "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              skills.sh
            </a>{" "}
            to discover and install skills for your agent.
          </div>
        )
      )}
    </ConfigDetailStack>
  );
}

export function SkillsConfig({
  cwd,
  onClose,
  embedded = false,
}: {
  cwd: string;
  onClose: () => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("skills", cwd));
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(true);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
      const d = (await res.json()) as Partial<SkillsResponse> & { error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      const list = d.skills ?? [];
      setSkills(list);
      setProjectResourcesLoaded(d.projectResourcesLoaded ?? true);
      setSelected((current) => {
        if (current && list.some((skill) => skill.filePath === current)) return current;
        const initialSkill = list.find((skill) => !skill.disableModelInvocation) ?? list[0];
        return initialSkill?.filePath ?? null;
      });
      return list;
    } catch (e) {
      setError(String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadSkills();
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selected) setLastSettingsSelection("skills", selected, cwd);
  }, [cwd, selected]);

  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill
      ? [skill]
      : skills.filter((item) => Boolean(item.install));
    const keys = targets
      .map(updateKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const res = await fetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: SkillUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[`${update.scope}\0${update.package}`] = update;
        }
        return next;
      });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!skill) setCheckingAll(false);
    }
  }, [cwd, skills]);

  const updateInstalledSkill = useCallback(async (skill: Skill) => {
    if (!skill.install) return;
    const key = updateKey(skill)!;
    setUpdatingSkill(key);
    setUpdateError(null);
    try {
      const res = await fetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill.install.package,
          scope: skill.install.scope,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skill?: Skill;
        error?: string;
      };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await loadSkills();
      const versionHash = data.skill?.install?.versionHash;
      setUpdateStatuses((current) => ({
        ...current,
        [key]: {
          package: skill.install!.package,
          scope: skill.install!.scope,
          state: "up-to-date",
          currentVersion: versionHash,
          latestVersion: versionHash,
        },
      }));
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: skill.filePath,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.filePath === skill.filePath
            ? { ...s, disableModelInvocation: next }
            : s,
        ),
      );
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(skill.filePath);
        return n;
      });
    }
  }, []);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.skills")} subtitle={shortenPath(cwd)} closeLabel={t("i18n.close")} onClose={onClose}>

        {!projectResourcesLoaded && (
          <div role="status" className="config-trust-notice">
            {t("trust.skillsNotLoaded")}
          </div>
        )}

        {/* Body */}
        <ConfigSplitView>
          {/* Left: skill list */}
          <ConfigSidebar>
            <ConfigSidebarList>
              {loading ? (
                <div className="config-sidebar-message">
                   {t("i18n.loading")}
                </div>
              ) : error ? (
                <div className="config-sidebar-message is-error">
                  {error}
                </div>
              ) : skills.length === 0 ? (
                <div className="config-sidebar-message is-empty">
                   {t("i18n.noSkills")}
                </div>
              ) : (
                (() => {
                  const groups: { label: string; skills: typeof skills }[] = [];
                  const scopeLabels = {
                    project: t("skills.scope.project"),
                    global: t("skills.scope.global"),
                    path: t("skills.scope.path"),
                  };
                  const groupDefinitions = [
                    {
                      label: `${scopeLabels.project} / skills.sh`,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: scopeLabels.project,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: `${scopeLabels.global} / skills.sh`,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: scopeLabels.global,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: scopeLabels.path,
                      matches: (skill: Skill) => sourceLabel(skill) === "path",
                    },
                  ];
                  for (const { label, matches } of groupDefinitions) {
                    const grpSkills = skills.filter(matches);
                    if (grpSkills.length > 0)
                      groups.push({ label, skills: grpSkills });
                  }
                  const renderSkillRow = (skill: Skill) => {
                    const isSelected =
                      !addMode && selected === skill.filePath;
                    const disabled = skill.disableModelInvocation;
                    return (
                      <ConfigSidebarItem
                        key={skill.filePath}
                        active={isSelected}
                        onClick={() => {
                          setSelected(skill.filePath);
                          setAddMode(false);
                        }}
                      >
                        <ConfigStatusDot active={!disabled} />
                        <ConfigSidebarText className={`is-grow${disabled ? " is-muted" : ""}`}>
                          {skill.name}
                        </ConfigSidebarText>
                        {(() => {
                          const key = updateKey(skill);
                          const status = key ? updateStatuses[key] : undefined;
                          if (status?.state !== "update-available") return null;
                          return (
                            <span title={t("i18n.updateAvailable")} className="skill-update-indicator">
                              ↑
                            </span>
                          );
                        })()}
                      </ConfigSidebarItem>
                    );
                  };
                  return groups.map(
                    ({ label: grpLabel, skills: grpSkills }) => {
                      return (
                        <div key={grpLabel} className="config-sidebar-group">
                          <ConfigSidebarGroupLabel>
                            {grpLabel}
                          </ConfigSidebarGroupLabel>
                          {orderSkillsByDormancy(grpSkills).map(renderSkillRow)}
                        </div>
                      );
                    },
                  );
                })()
              )}
            </ConfigSidebarList>
            {/* Add skill button */}
            <ConfigListAction
                onClick={() => setAddMode(true)}
                active={addMode}
              >
                 {t("i18n.addSkill")}
            </ConfigListAction>
          </ConfigSidebar>

          {/* Right: detail or add panel */}
          <ConfigDetail>
            <ConfigDetailStack className="is-fill">
              {addMode ? (
              <AddSkillPanel
                cwd={cwd}
                projectResourcesLoaded={projectResourcesLoaded}
                installedPackages={{
                  global: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "global")
                      .map((skill) => skill.install!.package),
                  ),
                  project: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "project")
                      .map((skill) => skill.install!.package),
                  ),
                }}
                onInstalled={() => {
                  void loadSkills();
                }}
              />
            ) : loading ? null : selectedSkill ? (
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggle={toggle}
                toggling={toggling.has(selectedSkill.filePath)}
                saveError={saveError}
                updateStatus={
                  updateKey(selectedSkill)
                    ? updateStatuses[updateKey(selectedSkill)!]
                    : undefined
                }
                checkingUpdate={
                  updateKey(selectedSkill)
                    ? checkingUpdates.has(updateKey(selectedSkill)!)
                    : false
                }
                updating={updatingSkill === updateKey(selectedSkill)}
                updateError={updateError}
                onCheckUpdate={() => void checkForUpdates(selectedSkill)}
                onUpdate={() => void updateInstalledSkill(selectedSkill)}
                onContentSaved={() => { void loadSkills(); }}
              />
              ) : (
                <ConfigEmptyState>{t("i18n.selectSkill")}</ConfigEmptyState>
              )}
            </ConfigDetailStack>
          </ConfigDetail>
        </ConfigSplitView>

        {/* Footer */}
        <ConfigFooter status={
            Object.values(updateStatuses).filter(
              (status) => status.state === "update-available",
            ).length > 0 && (
              <span style={{ fontSize: TEXT.sm, color: "var(--warning)" }}>
                {
                  Object.values(updateStatuses).filter(
                    (status) => status.state === "update-available",
                  ).length
                }{" "}
                {Object.values(updateStatuses).filter(
                  (status) => status.state === "update-available",
                ).length === 1
                   ? t("i18n.update")
                   : t("i18n.updates")}
              </span>
            )}
        >
          {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
          {skills.some((skill) => Boolean(skill.install)) && (
            <ConfigButton variant="secondary" onClick={() => void checkForUpdates()} disabled={checkingAll || updatingSkill !== null}>
              {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
            </ConfigButton>
          )}
        </ConfigFooter>
    </ConfigPanelShell>
  );
}
