"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { setLastSettingsSection, type SettingsSection } from "@/lib/settings-navigation";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import {
  clearTitleModel,
  getTitleAutoEnabled,
  getTitleModel,
  setTitleAutoEnabled,
  setTitleModel,
} from "@/lib/title-settings";
import { ModelsConfig } from "./ModelsConfig";
import { CronConfig } from "./fork/CronConfig";
import { McpConfig } from "./fork/McpConfig";
import { PiMemoryConfig } from "./fork/PiMemoryConfig";
// fork:zc-04 / fork:zc-03 / fork:zc-16 — new sections rendered by this panel.
import { PromptsConfig } from "./fork/PromptsConfig";
import { ShortcutsSettings } from "./fork/ShortcutsSettings";
import { UsageStatsPanel } from "./fork/UsageStatsPanel";
import { setupPushSubscription } from "@/lib/push-client";
import { SkillsConfig } from "./SkillsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";
import { WallpaperSettings } from "./WallpaperSettings";
import { useBorderDepth } from "@/hooks/useBorderDepth";
import { useUiDensity } from "@/hooks/useUiDensity";
import type { UiDensity } from "@/lib/ui-density";
import {
  loadStepExpansion,
  setStepCategoryExpanded,
  type StepExpansion,
} from "@/lib/process-step-expansion";
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
  // fork:zc-04 / fork:zc-03 / fork:zc-16 — glyphs for the three new sections.
  if (section === "shortcuts") return <svg {...common}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" /></svg>;
  if (section === "usage") return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M2 20h20" /></svg>;
  if (section === "prompts") return <svg {...common}><path d="M4 17l6-6-6-6" /><path d="M12 19h8" /></svg>;
  return <svg {...common}><path d="M9 7V2M15 7V2M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0ZM12 19v3" /></svg>;
}

/**
 * D2-PR-22：会话自动命名设置（开关 + 命名模型）。
 * 单独成一个组件而不是直接展开进 GeneralSettings：聊天分区现有行的数量与
 * 开关结构由 UI 门禁测试固定（SettingsPanel.test.mjs 只统计该分区的行），
 * 这里复用同一套 settings-chat-* 样式类，但作为独立控件组渲染。
 */
function TitleSettingsControls({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [titleAuto, setTitleAuto] = useState(true);
  const [titleModel, setTitleModelState] = useState<{ provider: string; modelId: string } | null>(null);
  const [titleModelOptions, setTitleModelOptions] = useState<{ provider: string; modelId: string; label: string }[]>([]);

  // 读取命名开关/模型，并监听其他面板或窗口的 storage 广播。
  useEffect(() => {
    const syncTitleSettings = () => {
      setTitleAuto(getTitleAutoEnabled());
      setTitleModelState(getTitleModel());
    };
    syncTitleSettings();
    window.addEventListener("storage", syncTitleSettings);
    return () => window.removeEventListener("storage", syncTitleSettings);
  }, []);

  // 命名模型下拉的候选项复用现有 /api/models 拉取方式。
  useEffect(() => {
    const url = cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
    let cancelled = false;
    void fetch(url)
      .then((response) => response.ok ? response.json() : null)
      .then((data: { modelList?: { id: string; name?: string; provider: string }[] } | null) => {
        if (cancelled) return;
        const options = (data?.modelList ?? [])
          .filter((model) => model.id && model.provider)
          .map((model) => ({
            provider: model.provider,
            modelId: model.id,
            label: `${model.name || model.id} · ${model.provider}`,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setTitleModelOptions(options);
      })
      .catch(() => {
        if (!cancelled) setTitleModelOptions([]);
      });
    return () => { cancelled = true; };
  }, [cwd]);

  const setTitleAutoAndPersist = (enabled: boolean) => {
    setTitleAuto(enabled);
    setTitleAutoEnabled(enabled);
  };

  const setTitleModelAndPersist = (value: string) => {
    if (!value) {
      clearTitleModel();
      setTitleModelState(null);
      return;
    }
    const separator = value.indexOf(":");
    if (separator <= 0) return;
    const provider = value.slice(0, separator);
    const modelId = value.slice(separator + 1);
    setTitleModel(provider, modelId);
    setTitleModelState({ provider, modelId });
  };

  const titleModelValue = titleModel ? `${titleModel.provider}:${titleModel.modelId}` : "";

  return (
    <>
      <div className="settings-chat-option settings-chat-switch-option">
        <span>{t("settings.titleAutoGenerate")}</span>
        <ConfigSwitch
          checked={titleAuto}
          label={t("settings.titleAutoGenerate")}
          onChange={setTitleAutoAndPersist}
        />
      </div>
      <p className="settings-chat-range-hint">{t("settings.titleAutoGenerateDescription")}</p>
      <div className="settings-chat-option settings-chat-range-option">
        <span className="settings-chat-option-label">{t("settings.titleModel")}</span>
        <select
          className="settings-select"
          value={titleModelValue}
          aria-label={t("settings.titleModel")}
          onChange={(event) => setTitleModelAndPersist(event.target.value)}
        >
          <option value="">{t("settings.titleModelNone")}</option>
          {titleModelOptions.map((option) => (
            <option key={`${option.provider}:${option.modelId}`} value={`${option.provider}:${option.modelId}`}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="settings-chat-range-hint">{t("settings.titleModelDescription")}</p>
      </div>
    </>
  );
}

function GeneralSettings({ cwd, sessionId, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange }: Pick<Props, "cwd" | "sessionId" | "onSessionReloaded" | "quoteSelectionEnabled" | "onQuoteSelectionChange">) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const { borderDepth, setBorderDepth } = useBorderDepth();
  const { uiDensity, setUiDensity } = useUiDensity();
  const [stepExpansion, setStepExpansion] = useState<StepExpansion>(loadStepExpansion);
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
            // A palette is the only theme source now: the pi CLI overlay was
            // removed, so selection is a plain comparison.
            const selected = preference === option.id;
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
          {/* D2-PR-22：自动命名开关 + 命名模型（独立控件组，样式类与所在分区一致）。 */}
          <TitleSettingsControls cwd={cwd} />
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
          {/* fork:step-expansion — 时间线里哪几类步骤默认摊开。原来这里是
              「过程显示：传统 / 时间线 / 标签」三选一，现在只剩时间线一种视图，
              这个下拉框换成了三个按类别控制的开关。 */}
          <p className="settings-chat-range-hint">{t("settings.stepExpandHint")}</p>
          {([
            ["reasoning", "settings.stepExpandReasoning"],
            ["command", "settings.stepExpandCommand"],
            ["tool", "settings.stepExpandTool"],
          ] as const).map(([category, labelKey]) => {
            const label = t(labelKey);
            const on = stepExpansion[category];
            return (
              <div key={category} className="settings-chat-option settings-chat-switch-option">
                <span>{label}</span>
                {/* 开关旁边写明当前状态：光看拨杆分不清「展开」是哪一边。 */}
                <span className="settings-chat-switch-status">
                  <span className={on ? "settings-chat-switch-state is-on" : "settings-chat-switch-state"}>
                    {t(on ? "settings.stepExpandOn" : "settings.stepExpandOff", { name: label })}
                  </span>
                  <ConfigSwitch
                    checked={on}
                    label={label}
                    onChange={(enabled) => setStepExpansion(setStepCategoryExpanded(category, enabled))}
                  />
                </span>
              </div>
            );
          })}
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

// fork:zc-15 — the section keyword table moved into `lib/settings-navigation.ts`
export function SettingsPanel({ cwd, sessionId, initialSection, onClose, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange, onOpenSession, onOpenFile }: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
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
    // fork:zc-04 / fork:zc-03 / fork:zc-16 — global sections.
    { id: "shortcuts", label: t("settings.shortcuts.title"), requiresProject: false },
    { id: "usage", label: t("usage.title"), requiresProject: false },
    { id: "prompts", label: t("prompts.title"), requiresProject: false },
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
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="settings-section-tab"
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
          </nav>

          <main className="settings-dialog-main">
            {sectionHost("general", <GeneralSettings cwd={cwd} sessionId={sessionId} onSessionReloaded={onSessionReloaded} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} />)}
            {sectionHost("models", <ModelsConfig embedded onClose={onClose} />)}
            {cwd && sectionHost("skills", <SkillsConfig embedded key={cwd} cwd={cwd} onClose={onClose} />)}
            {cwd && sectionHost("agents", <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {cwd && sectionHost("plugins", <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {/* fork:cron / fork:memory / fork:mcp-section — global pages, no project needed. */}
            {sectionHost("mcp", <McpConfig cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {sectionHost("cron", <CronConfig cwd={cwd} onOpenSession={onOpenSession} />)}
            {sectionHost("memory", <PiMemoryConfig cwd={cwd} onOpenFile={onOpenFile} />)}
            {/* fork:zc-04 / fork:zc-03 / fork:zc-16 — shortcut table, usage stats, prompt files. */}
            {sectionHost("shortcuts", <ShortcutsSettings />)}
            {sectionHost("usage", <UsageStatsPanel />)}
            {sectionHost("prompts", <PromptsConfig onOpenFile={onOpenFile} />)}
          </main>
        </div>
      </div>
    </div>
  );
}
