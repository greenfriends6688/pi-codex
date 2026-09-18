"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";
import { ThemeIcon } from "./ThemeIcon";
import {
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  CHAT_CONTENT_FONT_SIZE_DEFAULT,
  CHAT_CONTENT_FONT_SIZE_MAX,
  CHAT_CONTENT_FONT_SIZE_MIN,
  EXTENSION_WIDGET_FONT_SIZE_DEFAULT,
  EXTENSION_WIDGET_FONT_SIZE_MAX,
  EXTENSION_WIDGET_FONT_SIZE_MIN,
  useChatAppearance,
} from "@/hooks/useChatAppearance";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ShellToolSettingsResponse } from "@/lib/api-types";
import {
  setLastSettingsSection,
  type SettingsSection,
} from "@/lib/settings-navigation";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import { ModelsConfig } from "./ModelsConfig";
import { CronConfig } from "./fork/CronConfig";
import { McpConfig } from "./fork/McpConfig";
import { PiMemoryConfig } from "./fork/PiMemoryConfig";
import { setupPushSubscription } from "@/lib/push-client";
import { SkillsConfig } from "./SkillsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";
import { PiThemePicker } from "./PiThemePicker";
import { WallpaperSettings } from "./WallpaperSettings";
import { useBorderDepth } from "@/hooks/useBorderDepth";
import { useUiDensity } from "@/hooks/useUiDensity";
import type { UiDensity } from "@/lib/ui-density";
import { usePiTheme } from "@/hooks/usePiTheme";
import {
  PROCESS_RENDERER_STORAGE_KEY,
  useProcessDisplayMode,
  type ProcessRendererPreference,
} from "@/hooks/useProcessDisplayMode";
import { BORDER_DEPTH_MAX, BORDER_DEPTH_MIN } from "@/lib/border-depth";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  initialSection: SettingsSection;
  onClose: () => void;
  onSessionReloaded: () => void;
  quoteSelectionEnabled: boolean;
  onQuoteSelectionChange: (enabled: boolean) => void;
  /** fork:cron — open the session a scheduled run created. */
  onOpenSession?: (sessionId: string) => void;
  /** fork:memory-panel — open a memory markdown file in the main viewer. */
  onOpenFile?: (filePath: string) => void;
}

export function SettingsSectionIcon({ section, size = 16, strokeWidth = 1.8 }: { section: SettingsSection; size?: number; strokeWidth?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "settings-section-icon",
  };

  if (section === "general") return <svg {...common}><path d="M20 7h-9M14 17H5" /><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></svg>;
  if (section === "models") return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" /></svg>;
  if (section === "skills") return <svg {...common}><path d="m12 2-10 5 10 5 10-5-10-5Z" /><path d="m2 12 10 5 10-5M2 17l10 5 10-5" /></svg>;
  // MCP gets its own glyph: a plug, distinct from the plugins puzzle piece.
  if (section === "mcp") return <svg {...common} className="settings-section-icon"><path d="M9 4v5M15 4v5" /><path d="M6 9h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6Z" /><path d="M12 18v3" /></svg>;
  if (section === "cron") return <svg {...common} className="settings-section-icon"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2" /><path d="M9 2h6" /></svg>;
  if (section === "memory") return <svg {...common} className="settings-section-icon"><path d="M12 3a5 5 0 0 1 5 5c0 1.5-.6 2.5-1.5 3.4-.8.8-1.5 1.7-1.5 3.1V16h-4v-1.5c0-1.4-.7-2.3-1.5-3.1C7.6 10.5 7 9.5 7 8a5 5 0 0 1 5-5Z" /><path d="M10 20h4" /></svg>;
  if (section === "agents") return <svg {...common} className="settings-section-icon is-agent"><rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" /></svg>;
  return <svg {...common}><path d="M9 7V2M15 7V2M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0ZM12 19v3" /></svg>;
}

function GeneralSettings({ cwd, sessionId, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange }: Pick<Props, "cwd" | "sessionId" | "onSessionReloaded" | "quoteSelectionEnabled" | "onQuoteSelectionChange">) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const { piThemeName, setPiTheme } = usePiTheme();
  const { borderDepth, setBorderDepth } = useBorderDepth();
  const { uiDensity, setUiDensity } = useUiDensity();
  const { displayMode: processDisplayMode, setDisplayMode: setProcessDisplayMode } = useProcessDisplayMode();
  const { width: chatContentWidth, setWidth: setChatContentWidth, fontSize, setFontSize, extensionWidgetFontSize, setExtensionWidgetFontSize } = useChatAppearance();
  const [shellSettings, setShellSettings] = useState<ShellToolSettingsResponse | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [pushRegistering, setPushRegistering] = useState(false);
  const [pushStatus, setPushStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [webAuthEnabled, setWebAuthEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    setThinkingExpanded(isThinkingExpandedByDefault());
    void fetch("/api/web-auth")
      .then((response) => response.ok ? response.json() : null)
      .then((data: { enabled?: boolean } | null) => setWebAuthEnabled(data?.enabled === true))
      .catch(() => {});
  }, []);

  const logOut = async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      const response = await fetch("/api/web-auth", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      window.location.replace("/login");
    } catch {
      setLogoutError(t("auth.logoutFailed"));
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ShellToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setShellSettings(data);
      })
      .catch((cause) => {
        if (!cancelled) setShellError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const togglePowerShell = async (enabled: boolean) => {
    setShellSaving(true);
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ShellToolSettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setShellSettings(data);
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (cause) {
      setShellError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setShellSaving(false);
    }
  };

  const registerPush = async () => {
    if (pushRegistering) return;
    setPushRegistering(true);
    setPushStatus(null);
    try {
      if (typeof window === "undefined" || !("Notification" in window)) {
        throw new Error("unsupported or not permitted");
      }
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") throw new Error("unsupported or not permitted");
      const ok = await setupPushSubscription(locale);
      if (!ok) throw new Error("unsupported or not permitted");
      setPushStatus({ kind: "ok", message: t("settings.pushRegistered") });
    } catch (cause) {
      setPushStatus({ kind: "error", message: `${t("settings.pushRegisterFailed")} ${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setPushRegistering(false);
    }
  };

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("settings.general")}</h2>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.appearance")}</h3>
        <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
          {THEME_OPTIONS.map((option) => {
            // A Codex palette and a pi theme are mutually exclusive: the palette
            // block is what paints those colours, so selecting one has to drop
            // the inline pi-theme overrides first.
            const selected = piThemeName === "" && preference === option.id;
            return (
              <label
                key={option.id}
                className="settings-theme-option"
              >
                <input
                  type="radio"
                  name="theme"
                  value={option.id}
                  checked={selected}
                  onChange={() => {
                    if (piThemeName) void setPiTheme("");
                    setThemePreference(option.id);
                  }}
                  className="sr-only"
                />
                <ThemeIcon preference={option.id} />
                <span className="settings-theme-option-label">{t(option.label)}</span>
              </label>
            );
          })}
        </div>

        {/* One section, two sources: a separate "pi 主题" section read as a
            competing second theme picker. */}
        <PiThemePicker cwd={cwd} />

        <div className="settings-chat-option settings-chat-range-option">
          <div className="settings-chat-range-header">
            <label htmlFor="settings-border-depth">{t("settings.borderDepth")}</label>
            <output htmlFor="settings-border-depth">{borderDepth}</output>
            <ConfigButton
              variant="ghost"
              size="small"
              className="settings-chat-reset"
              title={t("settings.borderDepthTheme")}
              aria-label={t("settings.borderDepthTheme")}
              onClick={() => setBorderDepth(50)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
              </svg>
            </ConfigButton>
          </div>
          <input
            id="settings-border-depth"
            type="range"
            min={BORDER_DEPTH_MIN}
            max={BORDER_DEPTH_MAX}
            step={1}
            value={borderDepth}
            aria-label={t("settings.borderDepth")}
            aria-valuetext={`${borderDepth}`}
            onChange={(event) => setBorderDepth(Number(event.target.value))}
          />
          <div className="settings-chat-range-scale" aria-hidden="true">
            <span>{t("settings.borderDepthInvisible")}</span>
            <span>{t("settings.borderDepthTheme")}</span>
            <span>{t("settings.borderDepthContrast")}</span>
          </div>
          <p className="settings-chat-range-hint">{t("settings.borderDepthDescription")}</p>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.wallpaper")}</h3>
        <WallpaperSettings />
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.chat")}</h3>
        <div className="settings-chat-options">
          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.thinkingExpandedDefault")}</span>
            <ConfigSwitch
              checked={thinkingExpanded}
              label={t("settings.thinkingExpandedDefault")}
              onChange={(enabled) => {
                setThinkingExpandedByDefault(enabled);
                setThinkingExpanded(enabled);
              }}
            />
          </div>
          <div className="settings-chat-option">
          <div className="settings-chat-option settings-chat-range-option">
            <span className="settings-chat-option-label">{t("settings.density")}</span>
            <select
              className="settings-select"
              value={uiDensity}
              aria-label={t("settings.density")}
              onChange={(event) => setUiDensity(event.target.value as UiDensity)}
            >
              <option value="compact">{t("settings.densityCompact")}</option>
              <option value="standard">{t("settings.densityStandard")}</option>
              <option value="comfortable">{t("settings.densityComfortable")}</option>
            </select>
            <p className="settings-chat-range-hint">{t("settings.densityHint")}</p>
          </div>
            <span className="settings-chat-option-label">{t("settings.processDisplay")}</span>
            <select
              className="settings-select"
              value={processDisplayMode}
              aria-label={t("settings.processDisplay")}
              onChange={(event) => setProcessDisplayMode(event.target.value as ProcessRendererPreference)}
            >
              <option value={PROCESS_RENDERER_STORAGE_KEY.legacy}>{t("settings.processDisplayLegacy")}</option>
              <option value={PROCESS_RENDERER_STORAGE_KEY.timeline}>{t("settings.processDisplayTimeline")}</option>
              <option value={PROCESS_RENDERER_STORAGE_KEY.tabs}>{t("settings.processDisplayTabs")}</option>
            </select>
            <p className="settings-chat-range-hint">{t("settings.processDisplayDescription")}</p>
          </div>
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-chat-content-width">{t("settings.chatContentWidth")}</label>
              <output htmlFor="settings-chat-content-width">{chatContentWidth}px</output>
              <ConfigButton
                variant="ghost"
                size="small"
                className="settings-chat-reset"
                title={t("settings.resetChatContentWidth")}
                aria-label={t("settings.resetChatContentWidth")}
                disabled={chatContentWidth === CHAT_CONTENT_WIDTH_DEFAULT}
                onClick={() => setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </ConfigButton>
            </div>
            <input
              id="settings-chat-content-width"
              type="range"
              min={CHAT_CONTENT_WIDTH_MIN}
              max={CHAT_CONTENT_WIDTH_MAX}
              step={10}
              value={chatContentWidth}
              onChange={(event) => setChatContentWidth(Number(event.target.value))}
            />
          </div>
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-chat-content-font-size">{t("settings.chatContentFontSize")}</label>
              <output htmlFor="settings-chat-content-font-size">{fontSize}px</output>
              <ConfigButton
                variant="ghost"
                size="small"
                className="settings-chat-reset"
                title={t("settings.resetChatContentFontSize")}
                aria-label={t("settings.resetChatContentFontSize")}
                disabled={fontSize === CHAT_CONTENT_FONT_SIZE_DEFAULT}
                onClick={() => setFontSize(CHAT_CONTENT_FONT_SIZE_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </ConfigButton>
            </div>
            <input
              id="settings-chat-content-font-size"
              type="range"
              min={CHAT_CONTENT_FONT_SIZE_MIN}
              max={CHAT_CONTENT_FONT_SIZE_MAX}
              step={1}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </div>
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-extension-widget-font-size">{t("settings.extensionWidgetFontSize")}</label>
              <output htmlFor="settings-extension-widget-font-size">{extensionWidgetFontSize}px</output>
              <ConfigButton
                variant="ghost"
                size="small"
                className="settings-chat-reset"
                title={t("settings.resetExtensionWidgetFontSize")}
                aria-label={t("settings.resetExtensionWidgetFontSize")}
                disabled={extensionWidgetFontSize === EXTENSION_WIDGET_FONT_SIZE_DEFAULT}
                onClick={() => setExtensionWidgetFontSize(EXTENSION_WIDGET_FONT_SIZE_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </ConfigButton>
            </div>
            <input
              id="settings-extension-widget-font-size"
              type="range"
              min={EXTENSION_WIDGET_FONT_SIZE_MIN}
              max={EXTENSION_WIDGET_FONT_SIZE_MAX}
              step={1}
              value={extensionWidgetFontSize}
              onChange={(event) => setExtensionWidgetFontSize(Number(event.target.value))}
            />
          </div>
          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.quoteSelection")}</span>
            <ConfigSwitch
              checked={quoteSelectionEnabled}
              label={t("settings.quoteSelection")}
              onChange={onQuoteSelectionChange}
            />
          </div>
        </div>
      </section>

      {shellSettings?.isWindows && (
        <section className="settings-general-section">
          <h3 className="settings-general-heading">{t("settings.shellTool")}</h3>
          <p className="settings-general-description">{t("settings.shellToolDescription")}</p>
          <div className="settings-shell-option">
            <span>{t("settings.usePowerShell")}</span>
            <ConfigSwitch
              checked={shellSettings.powerShellEnabled}
              loading={shellSaving}
              label={t("settings.usePowerShell")}
              onChange={(enabled) => void togglePowerShell(enabled)}
            />
          </div>
          {shellError && <p role="alert" className="settings-general-error">{shellError}</p>}
        </section>
      )}

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.pushPermission")}</h3>
        <p className="settings-general-description">{t("settings.pushPermissionDescription")}</p>
        <div className="settings-shell-option">
          <span>{t("settings.pushPermission")}</span>
          <button
            type="button"
            className="config-button config-button-small config-button-secondary"
            disabled={pushRegistering}
            onClick={() => void registerPush()}
          >
            {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
          </button>
        </div>
        {pushStatus && (
          <p
            role="status"
            className="settings-general-error"
            style={pushStatus.kind === "ok" ? { color: "var(--accent)" } : undefined}
          >
            {pushStatus.message}
          </p>
        )}
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("common.language")}</h3>
        <div role="radiogroup" aria-label={t("common.language")} className="settings-language-options">
          {supportedLocales.map((plugin) => {
            const selected = locale === plugin.id;
            return (
              <button
                key={plugin.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setLocale(plugin.id as typeof locale)}
                className="settings-language-option"
              >
                <span className="settings-language-radio">
                  {selected && <span className="settings-language-radio-dot" />}
                </span>
                <span className="settings-language-label">{plugin.label}</span>
                <span className="settings-language-code">{plugin.id}</span>
              </button>
            );
          })}
        </div>
      </section>

      {webAuthEnabled && (
        <section className="settings-general-section">
          <ConfigButton variant="secondary" disabled={loggingOut} onClick={() => void logOut()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            </svg>
            {loggingOut ? t("auth.loggingOut") : t("auth.logOut")}
          </ConfigButton>
          {logoutError && <p role="alert" className="settings-general-error">{logoutError}</p>}
        </section>
      )}
    </div>
  );
}

// fork:ui-14 — section keyword table for the settings search. Kept next to the
// component instead of in a lib: the terms are the wording users type, which is
// the same thing the labels are, and they must move together.
const SECTION_SEARCH_TERMS: Record<SettingsSection, string[]> = {
  general: ["general", "appearance", "theme", "wallpaper", "language", "font", "width", "density", "border", "sound", "push", "shell", "通用", "外观", "主题", "壁纸", "语言", "字号", "宽度", "密度", "边框", "声音", "推送", "外观", "一般", "佈景", "桌布", "字級"],
  models: ["models", "provider", "provider api key", "oauth", "catalog", "cost", "thinking map", "模型", "供应商", "密钥", "目录", "价格", "思考"],
  skills: ["skills", "skill", "skills.sh", "install", "技能", "安装", "搜尋"],
  agents: ["agents", "sub-agent", "subagent", "concurrency", "profile", "prompt", "智能体", "子代理", "并发", "提示词", "代理"],
  plugins: ["plugins", "extension", "mcp", "npm", "server", "插件", "扩展", "服务"],
  mcp: ["mcp", "model context protocol", "server", "stdio", "sse", "服务器", "服务"],
  cron: ["cron", "schedule", "scheduled", "task", "timer", "nightly", "定时", "排程", "计划", "任务", "时间"],
  memory: ["memory", "remember", "recall", "qmd", "scratchpad", "daily log", "记忆", "长期记忆", "记住", "笔记", "備忘", "語意搜尋"],
};

function sectionSearchTerms(id: SettingsSection): string[] {
  return SECTION_SEARCH_TERMS[id] ?? [];
}

export function SettingsPanel({ cwd, sessionId, initialSection, onClose, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange, onOpenSession, onOpenFile }: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  // fork:ui-14 — settings search. Sections stay mounted (they are `hidden`, not
  // unmounted), so a query can light up rows in any of them; only the General
  // section exposes stable row elements to scan, the other four are separate
  // config panels and are covered by the keyword table below.
  const [query, setQuery] = useState("");
  const mainRef = useRef<HTMLElement | null>(null);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<SettingsSection>>(
    () => new Set([section]),
  );
  const sections: { id: SettingsSection; label: string; requiresProject: boolean }[] = [
    { id: "general", label: t("settings.general"), requiresProject: false },
    { id: "models", label: t("common.models"), requiresProject: false },
    { id: "skills", label: t("common.skills"), requiresProject: true },
    { id: "agents", label: t("common.agents"), requiresProject: true },
    { id: "plugins", label: t("common.plugins"), requiresProject: true },
    { id: "mcp", label: t("mcp.sectionTitle"), requiresProject: false },
    { id: "cron", label: t("cron.title"), requiresProject: false },
    { id: "memory", label: t("memory.title"), requiresProject: false },
  ];

  useEffect(() => setLastSettingsSection(initialSection), [initialSection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (cwd || (section !== "skills" && section !== "agents" && section !== "plugins")) return;
    setSection("general");
    setMountedSections((current) => new Set(current).add("general"));
    setLastSettingsSection("general");
  }, [cwd, section]);

  const activateSection = (nextSection: SettingsSection) => {
    setMountedSections((current) => new Set(current).add(nextSection));
    setSection(nextSection);
    setLastSettingsSection(nextSection);
  };

  const normalizedQuery = query.trim().toLowerCase();
  // Keyword hits for the sections whose rows live in their own panels. Both
  // languages are listed so a Chinese query finds an English-labelled section
  // and vice versa (the user may have switched locale after learning the names).
  const sectionMatches = normalizedQuery
    ? sections.filter((item) => sectionSearchTerms(item.id).some((term) => term.includes(normalizedQuery)))
    : [];

  // Highlight + reveal matching rows inside the visible section, and scroll the
  // first one into view. Imperative on purpose: the rows are hand-written JSX, so
  // there is no row index to filter with.
  useEffect(() => {
    const host = mainRef.current;
    if (!host) return;
    const rows = host.querySelectorAll<HTMLElement>(".settings-general-section > *");
    let first: HTMLElement | null = null;
    rows.forEach((row) => {
      const hit = normalizedQuery.length > 1 && (row.textContent ?? "").toLowerCase().includes(normalizedQuery);
      row.classList.toggle("settings-search-match", hit);
      if (hit && !first) first = row;
    });
    if (first) (first as HTMLElement).scrollIntoView({ block: "center" });
  }, [normalizedQuery, section]);

  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      hidden={section !== id}
      className="settings-section-host"
    >
      {content}
    </div>
  ) : null;

  // fork:dsn-dialog-a11y — 这个弹层原先声明了 role/aria-modal 与 Esc（见上方 effect），
  // 但没有焦点约束：Tab 会走到背后的侧栏与输入框，关闭后焦点也不回到触发按钮。
  // 这里补上共享 hook（移焦 / Tab 循环 / inert 背景 / 还原焦点）；
  // Esc 仍由上面的 effect 处理，hook 也接管一份，两者幂等。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose });

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("settings.title")}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="settings-dialog-backdrop"
    >
      <div className="settings-dialog-surface">
        <div className="settings-dialog-header">
          <strong className="settings-dialog-title">{t("settings.title")}</strong>
          <select
            aria-label={t("settings.title")}
            value={section}
            onChange={(event) => activateSection(event.target.value as SettingsSection)}
            className="settings-mobile-section-picker"
          >
            {sections.map((item) => (
              <option key={item.id} value={item.id} disabled={item.requiresProject && !cwd}>
                {item.label}
              </option>
            ))}
          </select>

          <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close">×</button>
        </div>

        {/* fork:ui-08 — sections are a left column now (upstream 0.14.6 uses
            `grid-template-columns: 184px minmax(0,1fr)`); the phone keeps the
            select picker above and hides this column in CSS. */}
        <div className="settings-dialog-body">
          <nav aria-label={t("settings.title")} className="settings-section-tabs">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.searchPlaceholder")}
              aria-label={t("settings.searchPlaceholder")}
              maxLength={80}
              className="settings-search-input"
            />
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              const jumpHit = sectionMatches.some((match) => match.id === item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-section-tab${jumpHit ? " settings-section-tab--hit" : ""}`}
                  disabled={disabled}
                  title={disabled ? t("settings.projectRequired") : item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => activateSection(item.id)}
                >
                  <SettingsSectionIcon section={item.id} />
                  <span>{item.label}</span>
                </button>
              );
            })}
            {normalizedQuery.length > 1 && sectionMatches.length === 0 && (
              <p role="status" className="settings-search-empty">
                {t("settings.searchNoMatch", { query: query.trim() })}
              </p>
            )}
          </nav>

          <main className="settings-dialog-main" ref={mainRef}>
            {sectionHost("general", <GeneralSettings cwd={cwd} sessionId={sessionId} onSessionReloaded={onSessionReloaded} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} />)}
            {sectionHost("models", <ModelsConfig embedded onClose={onClose} />)}
            {cwd && sectionHost("skills", <SkillsConfig embedded key={cwd} cwd={cwd} onClose={onClose} />)}
            {cwd && sectionHost("agents", <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {cwd && sectionHost("plugins", <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {/* fork:cron / fork:memory / fork:mcp-section — global pages, no project needed. */}
            {sectionHost("mcp", <McpConfig cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {sectionHost("cron", <CronConfig cwd={cwd} onOpenSession={onOpenSession} />)}
            {sectionHost("memory", <PiMemoryConfig cwd={cwd} onOpenFile={onOpenFile} />)}
          </main>
        </div>
      </div>
    </div>
  );
}
