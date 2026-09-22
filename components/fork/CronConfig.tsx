"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton, ConfigSwitch } from "../SettingsUi";
import { CRON_EXAMPLES } from "@/lib/cron-expression";
import { compileCronRule, parseClockTime, type CronRule } from "@/lib/cron-rule";
import type { CronRunRecord, CronSchedule, CronTaskView } from "@/lib/cron-schedule";
import { TEXT } from "@/lib/typography";

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LABELS: Record<(typeof THINKING_LEVELS)[number], string> = {
  auto: "auto", off: "off", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
};

/** Zones the runtime knows, big list first; falls back to a short fixed set. */
function timezoneOptions(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (supported && supported.length > 0) return supported;
  } catch {
    // Older runtimes: the select still works with the host zone only.
  }
  return ["UTC", "Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York", "America/Los_Angeles"];
}

/*
 * fork:cron — the scheduled-task page inside Settings.
 *
 * Scope: create / enable / run now / delete + the run history and a
 * human-readable frequency editor. fork:zc-14 adds the history region (start/end,
 * status, output excerpt, open-session and delete-a-row, 8 rows per page);
 * fork:zc-19 adds the frequency editor, which compiles the readable structure
 * down to the same 5-field cron the scheduler already runs — there is no second
 * schedule format at runtime.
 */

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const ORDINALS = [1, 2, 3, 4, 5] as const;

/** fork:zc-19 — the editor modes. `once`/`cron` keep the previous escape hatches. */
type EditorMode = "minutes" | "hours" | "daily" | "weekly" | "monthly" | "yearly" | "once" | "cron";

/** fork:zc-14 — the reference browser shows 8 runs per page. */
const HISTORY_PAGE_SIZE = 8;

/**
 * fork:fix-cron-model-list — shape of `GET /api/models`.
 *
 * `models` is a `provider:id → display name` map used for lookups; the list a
 * picker must render is `modelList`. Reading the map here made `.map` throw,
 * the `.catch` swallowed the TypeError, and the picker silently kept a single
 * "default" option (see lib/models-cache.ts `ModelsData`).
 */
interface ModelsResponse {
  modelList?: { id: string; name?: string; provider: string }[];
  defaultModel?: { provider: string; modelId: string } | null;
  modelError?: string;
}

function toDateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const RUN_STATUS_COLOR: Record<string, string> = {
  ok: "var(--success)",
  error: "var(--danger)",
  skipped: "var(--text-dim)",
  running: "var(--accent)",
};

const RUN_STATUS_KEY: Record<string, string> = {
  ok: "cron.runStatus.ok",
  error: "cron.runStatus.error",
  skipped: "cron.runStatus.skipped",
  running: "cron.runStatus.running",
};

/**
 * fork:zc-14 — one task's run history: newest first, 8 rows per page, with the
 * output excerpt (or the skip reason / error) and a jump to the run's session.
 */
function TaskHistory({ task, onOpenSession, onDeleteRun }: {
  task: CronTaskView;
  onOpenSession?: (sessionId: string) => void;
  onDeleteRun: (runId: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const runs = task.history ?? [];
  const totalPages = Math.max(1, Math.ceil(runs.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = runs.slice((currentPage - 1) * HISTORY_PAGE_SIZE, currentPage * HISTORY_PAGE_SIZE);

  const detail = (run: CronRunRecord): string => {
    if (run.error) return run.error;
    if (run.skipReason) return t(`cron.skipReason.${run.skipReason}`);
    return run.outputExcerpt ?? "";
  };

  return (
    <details style={{ marginTop: 2 }}>
      <summary style={{ cursor: "pointer", fontSize: TEXT.xs, color: "var(--text-dim)" }}>
        {t("cron.history")} · {runs.length}
      </summary>
      {runs.length === 0 ? (
        <p className="settings-chat-range-hint" style={{ margin: "4px 0 0" }}>{t("cron.historyEmpty")}</p>
      ) : (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: "grid", gap: 2 }}>
            {paged.map((run, index) => {
              const started = new Date(run.at);
              const finished = run.finishedAt ? new Date(run.finishedAt) : null;
              const duration = finished ? finished.getTime() - started.getTime() : undefined;
              const text = detail(run);
              return (
                <div
                  key={run.id ?? `${run.at}-${index}`}
                  style={{
                    display: "grid",
                    gap: 2,
                    padding: "5px 7px",
                    border: "1px solid var(--border-faint)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-panel)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: TEXT.xs }}>
                    <span style={{ color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                      {Number.isNaN(started.getTime()) ? run.at : started.toLocaleString()}
                      {finished && !Number.isNaN(finished.getTime()) ? ` → ${finished.toLocaleTimeString()}` : ""}
                    </span>
                    <span style={{ color: RUN_STATUS_COLOR[run.status] ?? "var(--text-dim)" }}>
                      ● {t(RUN_STATUS_KEY[run.status] ?? "cron.runStatus.error")}
                    </span>
                    {finished && <span style={{ color: "var(--text-dim)" }}>{formatDuration(duration)}</span>}
                    {run.trigger && <span style={{ color: "var(--text-dim)" }}>{t(`cron.trigger.${run.trigger}`)}</span>}
                    {run.attempt !== undefined && run.attempt > 1 && (
                      <span style={{ color: "var(--warning)" }}>{t("cron.history.attempt", { attempt: run.attempt })}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    {run.sessionId && onOpenSession && (
                      <button
                        type="button"
                        onClick={() => onOpenSession(run.sessionId!)}
                        style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: TEXT.xs, padding: 0 }}
                      >
                        {t("cron.openRun")}
                      </button>
                    )}
                    {run.id && (
                      <button
                        type="button"
                        title={t("cron.history.deleteRun")}
                        aria-label={t("cron.history.deleteRun")}
                        onClick={() => onDeleteRun(run.id!)}
                        style={{ border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: TEXT.xs, padding: 0 }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {text && (
                    <span
                      title={text}
                      style={{
                        fontSize: TEXT.xs,
                        color: run.error ? "var(--danger)" : "var(--text-dim)",
                        fontFamily: "var(--font-mono)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {text}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
              <button
                type="button"
                title={t("cron.history.prev")}
                aria-label={t("cron.history.prev")}
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                style={{ border: "1px solid var(--border-faint)", background: "transparent", color: "var(--text-dim)", cursor: "pointer", borderRadius: "var(--radius-sm)", fontSize: TEXT.xs, padding: "1px 6px" }}
              >
                ‹
              </button>
              <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                {t("cron.history.pageOf", { current: currentPage, total: totalPages })}
              </span>
              <button
                type="button"
                title={t("cron.history.next")}
                aria-label={t("cron.history.next")}
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
                style={{ border: "1px solid var(--border-faint)", background: "transparent", color: "var(--text-dim)", cursor: "pointer", borderRadius: "var(--radius-sm)", fontSize: TEXT.xs, padding: "1px 6px" }}
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

export function CronConfig({ cwd, onOpenSession }: { cwd?: string | null; onOpenSession?: (sessionId: string) => void }): ReactNode {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<CronTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [taskCwd, setTaskCwd] = useState(cwd ?? "");
  // fork:zc-19 — human-readable frequency editor state. It compiles to the
  // existing 5-field cron; the raw expression stays an escape hatch.
  const [mode, setMode] = useState<EditorMode>("daily");
  const [intervalValue, setIntervalValue] = useState("5");
  const [time, setTime] = useState("09:00");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [monthlyMode, setMonthlyMode] = useState<"date" | "weekday">("date");
  const [monthDay, setMonthDay] = useState("1");
  const [monthWeekday, setMonthWeekday] = useState(1);
  const [monthOrdinal, setMonthOrdinal] = useState(1);
  const [yearMonth, setYearMonth] = useState("1");
  const [yearDay, setYearDay] = useState("1");
  const [endDate, setEndDate] = useState("");
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [expression, setExpression] = useState("*/5 * * * *");
  const [idleStart, setIdleStart] = useState("");
  const [idleEnd, setIdleEnd] = useState("");
  const [timezone, setTimezone] = useState("host");
  const [thinking, setThinking] = useState("");
  const [modelKey, setModelKey] = useState("");
  // fork:fix-cron-lifecycle — 运行次数上限与子会话策略（不填即旧行为：不限次 + 每次新建）。
  const [maxRuns, setMaxRuns] = useState("");
  const [sessionMode, setSessionMode] = useState<"new" | "daily" | "reuse">("new");
  // fork:fix-cron-notify — 完成通知策略（默认只失败时通知）。
  const [notify, setNotify] = useState<"never" | "always" | "success" | "error">("error");
  const [taskEnabled, setTaskEnabled] = useState(true);
  const [models, setModels] = useState<{ key: string; label: string }[]>([]);
  const [defaultModelKey, setDefaultModelKey] = useState("");
  const [modelsError, setModelsError] = useState<string | null>(null);
  const zones = useMemo(() => timezoneOptions(), []);

  useEffect(() => {
    // Model list for the optional override; a failure is not fatal (the task then
    // runs with the app default, which is what an empty selection means anyway),
    // but it is surfaced — a picker that silently offers nothing is the bug this
    // replaced.
    // The route is scoped to a browsable cwd, so pass the panel's — without it the
    // request falls back to the server's own cwd and can be refused.
    const url = cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
    void fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const detail = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<ModelsResponse>;
      })
      .then((data) => {
        setModels((data.modelList ?? []).map((model) => ({
          key: `${model.provider}/${model.id}`,
          label: `${model.name || model.id} · ${model.provider}`,
        })));
        setDefaultModelKey(data.defaultModel ? `${data.defaultModel.provider}/${data.defaultModel.modelId}` : "");
        setModelsError(data.modelError ?? null);
      })
      .catch((cause: unknown) => {
        setModels([]);
        setDefaultModelKey("");
        setModelsError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [cwd]);

  // "Default" is the app's own default model, so name it: an unlabelled "default"
  // leaves the user guessing which model a scheduled run will actually use.
  const defaultModelLabel = useMemo(() => {
    if (!defaultModelKey) return "";
    return models.find((model) => model.key === defaultModelKey)?.label ?? defaultModelKey;
  }, [defaultModelKey, models]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cron", { cache: "no-store" });
      const data = await res.json() as { tasks?: CronTaskView[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTasks(data.tasks ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (cwd) setTaskCwd((current) => current || cwd);
  }, [cwd]);

  /**
   * fork:zc-19 — build the readable rule from the editor state. Returns null when
   * a field is not usable yet (the preview then shows the compile error instead).
   */
  const buildRule = (): CronRule | null => {
    const interval = Number(intervalValue);
    const parsedTime = parseClockTime(time);
    const end = endDate ? { endDate } : {};
    switch (mode) {
      case "minutes":
        return { kind: "minutes", interval, ...end };
      case "hours":
        return parsedTime ? { kind: "hours", interval, minute: parsedTime.minute, ...end } : null;
      case "daily":
        return parsedTime ? { kind: "daily", time, ...end } : null;
      case "weekly":
        return parsedTime ? { kind: "weekly", time, weekdays, ...end } : null;
      case "monthly":
        if (!parsedTime) return null;
        return monthlyMode === "date"
          ? { kind: "monthly", mode: "date", time, day: Number(monthDay), ...end }
          : { kind: "monthly", mode: "weekday", time, weekday: monthWeekday, ordinal: monthOrdinal, ...end };
      case "yearly":
        return parsedTime ? { kind: "yearly", time, month: Number(yearMonth), day: Number(yearDay), ...end } : null;
      default:
        return null;
    }
  };

  const compiled = buildRule();
  const compiledResult = compiled ? compileCronRule(compiled) : null;

  const scheduleForCreate = (): CronSchedule | null => {
    const window = idleStart && idleEnd ? { idleWindow: { start: idleStart, end: idleEnd } } : {};
    const shared = { ...(timezone !== "host" ? { timezone } : {}), ...window };
    if (mode === "once") return { kind: "once", times: [time], date, ...shared };
    if (mode === "cron") return { kind: "cron", times: [], expression: expression.trim(), ...shared };
    const result = compiledResult;
    if (!result || !result.ok) {
      setError(result && !result.ok ? result.error : t("cron.ruleInvalid"));
      return null;
    }
    // fork:zc-19 — readable structure compiles down to the one runtime format.
    return {
      kind: "cron",
      times: [],
      expression: result.expression,
      ...(result.endDate ? { endDate: result.endDate } : {}),
      ...shared,
    };
  };

  const create = async () => {
    setError(null);
    const schedule = scheduleForCreate();
    if (!schedule) return;
    const body = {
      name: name.trim(),
      prompt: prompt.trim(),
      // Empty is allowed: the runner uses the default working directory.
      cwd: taskCwd.trim(),
      enabled: taskEnabled,
      ...(modelKey ? { model: { provider: modelKey.split("/")[0], modelId: modelKey.split("/").slice(1).join("/") } } : {}),
      ...(thinking ? { thinking } : {}),
      ...(Number.isFinite(Number(maxRuns)) && Number(maxRuns) > 0 ? { maxRuns: Math.floor(Number(maxRuns)) } : {}),
      ...(sessionMode !== "new" ? { sessionMode } : {}),
      ...(notify !== "error" ? { notify } : {}),
      schedule,
    };
    try {
      const res = await fetch("/api/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setName("");
      setPrompt("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/cron", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await fetch(`/api/cron?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  // fork:zc-14 — drop one run row without touching the task itself.
  const removeRun = async (taskId: string, runId: string) => {
    setBusyId(taskId);
    try {
      await fetch(`/api/cron?id=${encodeURIComponent(taskId)}&runId=${encodeURIComponent(runId)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const describe = (task: CronTaskView) => {
    const names = WEEKDAY_KEYS.map((key) => t(`cron.weekday.${key}`));
    const zone = task.schedule.timezone ? ` · ${task.schedule.timezone}` : "";
    const window = task.schedule.idleWindow ? ` · ${t("cron.window")} ${task.schedule.idleWindow.start}–${task.schedule.idleWindow.end}` : "";
    const end = task.schedule.endDate ? ` · ${t("cron.endDate")} ${task.schedule.endDate}` : "";
    if (task.schedule.kind === "cron") return `${task.schedule.expression ?? ""}${zone}${window}${end}`;
    if (task.schedule.kind === "daily") return `${t("cron.daily")} ${task.schedule.times.join(", ")}${zone}${window}${end}`;
    if (task.schedule.kind === "weekly") {
      const days = (task.schedule.weekdays ?? []).map((day) => names[day]).join("/");
      return `${days} ${task.schedule.times.join(", ")}${zone}${window}${end}`;
    }
    return `${task.schedule.date ?? ""} ${task.schedule.times.join(", ")}${zone}${window}${end}`;
  };

  const intervalInput = (unit: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        className="settings-field-input"
        inputMode="numeric"
        value={intervalValue}
        onChange={(event) => setIntervalValue(event.target.value.replace(/[^0-9]/g, ""))}
        style={{ width: 70, fontVariantNumeric: "tabular-nums" }}
      />
      <span style={{ fontSize: TEXT.sm, color: "var(--text-dim)" }}>{unit}</span>
    </div>
  );

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("cron.title")}</h2>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("cron.newTask")}</h3>
        <div className="settings-chat-option settings-chat-range-option" style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="settings-chat-option-label">{t("cron.name")}</span>
            <input className="settings-field-input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t("cron.namePlaceholder")} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="settings-chat-option-label">{t("cron.prompt")}</span>
            <textarea
              className="settings-field-input"
              value={prompt}
              rows={3}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("cron.promptPlaceholder")}
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="settings-chat-option-label">{t("cron.cwd")}</span>
            <input className="settings-field-input" value={taskCwd} onChange={(event) => setTaskCwd(event.target.value)} placeholder={t("cron.cwdPlaceholder")} style={{ fontFamily: "var(--font-mono)", fontSize: TEXT.sm }} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 4, minWidth: 220 }}>
              <span className="settings-chat-option-label">{t("cron.model")}</span>
              <select className="settings-select" value={modelKey} onChange={(event) => setModelKey(event.target.value)}>
                <option value="">
                  {defaultModelLabel ? t("cron.modelDefault", { model: defaultModelLabel }) : t("cron.default")}
                </option>
                {models.map((model) => <option key={model.key} value={model.key}>{model.label}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="settings-chat-option-label">{t("cron.thinking")}</span>
              <select className="settings-select" value={thinking} onChange={(event) => setThinking(event.target.value)}>
                <option value="">{t("cron.default")}</option>
                {THINKING_LEVELS.map((level) => <option key={level} value={level}>{THINKING_LABELS[level]}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="settings-chat-option-label">{t("cron.maxRuns")}</span>
              <input
                className="settings-field-input"
                inputMode="numeric"
                value={maxRuns}
                onChange={(event) => setMaxRuns(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder={t("cron.maxRunsPlaceholder")}
                title={t("cron.maxRunsHint")}
                style={{ width: 110, fontVariantNumeric: "tabular-nums" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="settings-chat-option-label">{t("cron.sessionMode")}</span>
              <select
                className="settings-select"
                value={sessionMode}
                onChange={(event) => setSessionMode(event.target.value as "new" | "daily" | "reuse")}
                title={t("cron.sessionModeHint")}
              >
                <option value="new">{t("cron.sessionModeNew")}</option>
                <option value="daily">{t("cron.sessionModeDaily")}</option>
                <option value="reuse">{t("cron.sessionModeReuse")}</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="settings-chat-option-label">{t("cron.notify")}</span>
              <select
                className="settings-select"
                value={notify}
                onChange={(event) => setNotify(event.target.value as "never" | "always" | "success" | "error")}
                title={t("cron.notifyHint")}
              >
                <option value="error">{t("cron.notifyError")}</option>
                <option value="success">{t("cron.notifySuccess")}</option>
                <option value="always">{t("cron.notifyAlways")}</option>
                <option value="never">{t("cron.notifyNever")}</option>
              </select>
            </label>
          </div>

          {modelsError && (
            <p className="settings-chat-range-hint" role="status">{t("cron.modelListError", { error: modelsError })}</p>
          )}

          {/* fork:zc-19 — human-readable frequency editor (compiles to 5-field cron). */}
          <label style={{ display: "grid", gap: 4 }}>
            <span className="settings-chat-option-label">{t("cron.frequency")}</span>
            <select className="settings-select" value={mode} onChange={(event) => setMode(event.target.value as EditorMode)}>
              <option value="minutes">{t("cron.freq.minutes")}</option>
              <option value="hours">{t("cron.freq.hours")}</option>
              <option value="daily">{t("cron.daily")}</option>
              <option value="weekly">{t("cron.weekly")}</option>
              <option value="monthly">{t("cron.freq.monthly")}</option>
              <option value="yearly">{t("cron.freq.yearly")}</option>
              <option value="once">{t("cron.once")}</option>
              <option value="cron">{t("cron.kindCron")}</option>
            </select>
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            {mode === "minutes" && (
              <label style={{ display: "grid", gap: 4 }}>
                <span className="settings-chat-option-label">{t("cron.interval")}</span>
                {intervalInput(t("cron.unit.minutes"))}
              </label>
            )}
            {mode === "hours" && (
              <>
                <label style={{ display: "grid", gap: 4 }}>
                  <span className="settings-chat-option-label">{t("cron.interval")}</span>
                  {intervalInput(t("cron.unit.hours"))}
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span className="settings-chat-option-label">{t("cron.atTime")}</span>
                  <input className="settings-field-input" type="time" value={time} onChange={(event) => setTime(event.target.value)} style={{ width: 130 }} />
                </label>
              </>
            )}
            {(mode === "daily" || mode === "weekly" || mode === "monthly" || mode === "yearly" || mode === "once") && (
              <label style={{ display: "grid", gap: 4 }}>
                <span className="settings-chat-option-label">{t("cron.atTime")}</span>
                <input className="settings-field-input" type="time" value={time} onChange={(event) => setTime(event.target.value)} style={{ width: 130 }} />
              </label>
            )}
            {mode === "once" && (
              <label style={{ display: "grid", gap: 4 }}>
                <span className="settings-chat-option-label">{t("cron.date")}</span>
                <input className="settings-field-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ width: 160 }} />
              </label>
            )}
            {mode === "monthly" && (
              <>
                <label style={{ display: "grid", gap: 4 }}>
                  <span className="settings-chat-option-label">{t("cron.monthlyMode")}</span>
                  <select className="settings-select" value={monthlyMode} onChange={(event) => setMonthlyMode(event.target.value as "date" | "weekday")}>
                    <option value="date">{t("cron.monthlyByDate")}</option>
                    <option value="weekday">{t("cron.monthlyByWeekday")}</option>
                  </select>
                </label>
                {monthlyMode === "date" ? (
                  <label style={{ display: "grid", gap: 4 }}>
                    <span className="settings-chat-option-label">{t("cron.dayOfMonth")}</span>
                    <input
                      className="settings-field-input"
                      inputMode="numeric"
                      value={monthDay}
                      onChange={(event) => setMonthDay(event.target.value.replace(/[^0-9]/g, ""))}
                      style={{ width: 80, fontVariantNumeric: "tabular-nums" }}
                    />
                  </label>
                ) : (
                  <>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span className="settings-chat-option-label">{t("cron.weekday")}</span>
                      <select className="settings-select" value={monthWeekday} onChange={(event) => setMonthWeekday(Number(event.target.value))}>
                        {WEEKDAY_KEYS.map((key, index) => <option key={key} value={index}>{t(`cron.weekday.${key}`)}</option>)}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span className="settings-chat-option-label">{t("cron.ordinal")}</span>
                      <select className="settings-select" value={monthOrdinal} onChange={(event) => setMonthOrdinal(Number(event.target.value))}>
                        {ORDINALS.map((ordinal) => <option key={ordinal} value={ordinal}>{t(`cron.ordinal.${ordinal}`)}</option>)}
                      </select>
                    </label>
                  </>
                )}
              </>
            )}
            {mode === "yearly" && (
              <>
                <label style={{ display: "grid", gap: 4 }}>
                  <span className="settings-chat-option-label">{t("cron.month")}</span>
                  <select className="settings-select" value={yearMonth} onChange={(event) => setYearMonth(event.target.value)}>
                    {MONTH_KEYS.map((key, index) => <option key={key} value={index + 1}>{t(`cron.month.${key}`)}</option>)}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span className="settings-chat-option-label">{t("cron.dayOfMonth")}</span>
                  <input
                    className="settings-field-input"
                    inputMode="numeric"
                    value={yearDay}
                    onChange={(event) => setYearDay(event.target.value.replace(/[^0-9]/g, ""))}
                    style={{ width: 80, fontVariantNumeric: "tabular-nums" }}
                  />
                </label>
              </>
            )}
            {mode !== "once" && (
              <label style={{ display: "grid", gap: 4 }}>
                <span className="settings-chat-option-label">{t("cron.endDate")}</span>
                <input className="settings-field-input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} style={{ width: 160 }} />
              </label>
            )}
          </div>

          {mode !== "once" && (
            <p className="settings-chat-range-hint">{t("cron.endDateHint")}</p>
          )}

          {mode === "weekly" && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {WEEKDAY_KEYS.map((key, index) => {
                const active = weekdays.includes(index);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setWeekdays((current) => (active ? current.filter((day) => day !== index) : [...current, index].sort()))}
                    style={{
                      minWidth: 34, height: 26, padding: "0 8px",
                      border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                      background: active ? "var(--bg-selected)" : "transparent",
                      color: active ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer", fontSize: TEXT.xs,
                    }}
                  >
                    {t(`cron.weekday.${key}`)}
                  </button>
                );
              })}
            </div>
          )}

          {mode === "cron" && (
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="settings-chat-option-label">{t("cron.expression")}</span>
                <input
                  className="settings-field-input"
                  value={expression}
                  onChange={(event) => setExpression(event.target.value)}
                  placeholder="*/5 * * * *"
                  aria-describedby="cron-expression-help"
                  style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
                />
              </label>
              <p id="cron-expression-help" className="settings-chat-range-hint">{t("cron.expressionHelp")}</p>
              <div style={{ display: "grid", gap: 4 }}>
                <span className="settings-chat-option-label">{t("cron.examples")}</span>
                <div style={{ display: "grid", gap: 4 }}>
                  {CRON_EXAMPLES.map((example) => (
                    <button
                      key={example.expression}
                      type="button"
                      onClick={() => setExpression(example.expression)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                        width: "100%", padding: "5px 8px",
                        border: "1px solid var(--border-faint)", borderRadius: "var(--radius-sm)",
                        background: expression === example.expression ? "var(--bg-selected)" : "transparent",
                        cursor: "pointer", fontSize: TEXT.sm, whiteSpace: "nowrap",
                      }}
                    >
                      <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{example.expression}</code>
                      <span style={{ color: "var(--text-muted)" }}>{t(example.labelKey)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {mode !== "cron" && mode !== "once" && (
            <div style={{ display: "grid", gap: 2 }}>
              <span className="settings-chat-option-label">{t("cron.compiled")}</span>
              {compiledResult?.ok ? (
                <>
                  <code style={{ fontSize: TEXT.sm, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{compiledResult.expression}</code>
                  <span className="settings-chat-range-hint">{t("cron.compiledHint")}</span>
                </>
              ) : (
                <span style={{ fontSize: TEXT.sm, color: "var(--danger)" }}>
                  {t("cron.ruleInvalid", { error: compiledResult && !compiledResult.ok ? compiledResult.error : "" })}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="settings-chat-option-label">{t("cron.windowStart")}</span>
              <input className="settings-field-input" type="time" value={idleStart} onChange={(event) => setIdleStart(event.target.value)} style={{ width: 140 }} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="settings-chat-option-label">{t("cron.windowEnd")}</span>
              <input className="settings-field-input" type="time" value={idleEnd} onChange={(event) => setIdleEnd(event.target.value)} style={{ width: 140 }} />
            </label>
            {(idleStart || idleEnd) && (
              <ConfigButton variant="ghost" size="small" onClick={() => { setIdleStart(""); setIdleEnd(""); }}>{t("cron.windowClear")}</ConfigButton>
            )}
            <label style={{ display: "grid", gap: 4, minWidth: 200 }}>
              <span className="settings-chat-option-label">{t("cron.timezone")}</span>
              <select className="settings-select" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option value="host">{t("cron.timezoneHost")}</option>
                {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
          </div>
          <p className="settings-chat-range-hint">{t("cron.windowHint")}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="settings-chat-option-label">{t("cron.enabled")}</span>
            <ConfigSwitch label={t("cron.enabled")} checked={taskEnabled} onChange={setTaskEnabled} />
          </div>
          <div>
            <ConfigButton variant="primary" size="small" disabled={!prompt.trim() || !taskCwd.trim() || (mode !== "once" && mode !== "cron" && !compiledResult?.ok)} onClick={() => void create()}>
              {t("cron.create")}
            </ConfigButton>
          </div>
          <p className="settings-chat-range-hint">{t("cron.hint")}</p>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("cron.tasks")}</h3>
        {loading && <p className="settings-chat-range-hint">{t("cron.loading")}</p>}
        {!loading && tasks.length === 0 && <p className="settings-chat-range-hint">{t("cron.empty")}</p>}
        <div style={{ display: "grid", gap: 6 }}>
          {tasks.map((task) => (
            <div
              key={task.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                border: "1px solid var(--border-faint)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-panel)",
              }}
            >
              <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                <span style={{ fontSize: TEXT.md, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.name}</span>
                <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                  {describe(task)}
                  {task.nextRunAt ? ` · ${t("cron.next")} ${new Date(task.nextRunAt).toLocaleString()}` : ` · ${t("cron.noNext")}`}
                  {task.missed ? ` · ${t("cron.missed")}` : ""}
                </span>
                <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.cwd}>
                  {task.prompt}
                </span>
                {(task.model || task.thinking) && (
                  <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                    {task.model ? `${task.model.provider}/${task.model.modelId}` : t("cron.default")}{task.thinking ? ` · ${task.thinking}` : ""}
                  </span>
                )}
                {/* fork:zc-19 — surface a pending backoff retry instead of hiding it. */}
                {task.retryAt && (
                  <span style={{ fontSize: TEXT.xs, color: "var(--warning)" }}>
                    {t("cron.retryScheduled", { at: new Date(task.retryAt).toLocaleTimeString() })}
                  </span>
                )}
                <TaskHistory
                  task={task}
                  {...(onOpenSession ? { onOpenSession } : {})}
                  onDeleteRun={(runId) => void removeRun(task.id, runId)}
                />
                {task.lastStatus && (
                  <span style={{ fontSize: TEXT.xs, color: task.lastStatus === "error" ? "var(--danger)" : "var(--text-dim)" }}>
                    {t(`cron.status.${task.lastStatus}`)}{task.lastError ? ` · ${task.lastError}` : ""}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ConfigSwitch
                  label={`${t("cron.enabled")} · ${task.name}`}
                  checked={task.enabled}
                  onChange={(next) => void patch(task.id, { enabled: next })}
                />
                <ConfigButton variant="secondary" size="small" disabled={busyId === task.id} onClick={() => void patch(task.id, { action: "run" })}>
                  {t("cron.runNow")}
                </ConfigButton>
                <ConfigButton variant="ghost" size="small" title={t("cron.delete")} aria-label={t("cron.delete")} disabled={busyId === task.id} onClick={() => void remove(task.id)}>
                  ×
                </ConfigButton>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error && <p role="alert" className="settings-general-error">{error}</p>}
    </div>
  );
}
