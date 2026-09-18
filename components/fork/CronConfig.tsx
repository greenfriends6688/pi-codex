"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton, ConfigSwitch } from "../SettingsUi";
import { CRON_EXAMPLES } from "@/lib/cron-expression";
import type { CronScheduleKind, CronTaskView } from "@/lib/cron-schedule";

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
 * Scope, on purpose: create / enable / run now / delete, with the schedule reduced
 * to what the scheduler actually supports (daily · weekly · once + times). MusePi's
 * task center adds a calendar view and a run-history browser; both are only useful
 * once runs exist, and neither is worth building before the runner has been proven
 * on real tasks.
 */

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function toDateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
  const [kind, setKind] = useState<CronScheduleKind>("daily");
  const [times, setTimes] = useState("09:00");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
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
  const zones = useMemo(() => timezoneOptions(), []);

  useEffect(() => {
    // Model list for the optional override; a failure is not fatal (the task then
    // runs with the app default, which is what an empty selection means anyway).
    // The route is scoped to a browsable cwd, so pass the panel's — without it the
    // request falls back to the server's own cwd and can be refused.
    const url = cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
    void fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { models?: { provider: string; id: string; name?: string }[] } | null) => {
        setModels((data?.models ?? []).map((model) => ({
          key: `${model.provider}/${model.id}`,
          label: `${model.name || model.id} · ${model.provider}`,
        })));
      })
      .catch(() => setModels([]));
  }, [cwd]);

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

  const create = async () => {
    setError(null);
    const window = idleStart && idleEnd ? { idleWindow: { start: idleStart, end: idleEnd } } : {};
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
      schedule: {
        kind,
        times: kind === "cron" ? [] : times.split(",").map((value) => value.trim()).filter(Boolean),
        ...(kind === "cron" ? { expression: expression.trim() } : {}),
        ...(kind === "weekly" ? { weekdays } : {}),
        ...(kind === "once" ? { date } : {}),
        ...(timezone !== "host" ? { timezone } : {}),
        ...window,
      },
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

  const describe = (task: CronTaskView) => {
    const names = WEEKDAY_KEYS.map((key) => t(`cron.weekday.${key}`));
    const zone = task.schedule.timezone ? ` · ${task.schedule.timezone}` : "";
    const window = task.schedule.idleWindow ? ` · ${t("cron.window")} ${task.schedule.idleWindow.start}–${task.schedule.idleWindow.end}` : "";
    if (task.schedule.kind === "cron") return `${task.schedule.expression ?? ""}${zone}${window}`;
    if (task.schedule.kind === "daily") return `${t("cron.daily")} ${task.schedule.times.join(", ")}${zone}${window}`;
    if (task.schedule.kind === "weekly") {
      const days = (task.schedule.weekdays ?? []).map((day) => names[day]).join("/");
      return `${days} ${task.schedule.times.join(", ")}${zone}${window}`;
    }
    return `${task.schedule.date ?? ""} ${task.schedule.times.join(", ")}${zone}${window}`;
  };

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
            <input className="settings-field-input" value={taskCwd} onChange={(event) => setTaskCwd(event.target.value)} placeholder={t("cron.cwdPlaceholder")} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 4, minWidth: 220 }}>
              <span className="settings-chat-option-label">{t("cron.model")}</span>
              <select className="settings-select" value={modelKey} onChange={(event) => setModelKey(event.target.value)}>
                <option value="">{t("cron.default")}</option>
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
            <label style={{ display: "grid", gap: 4 }}>
              <span className="settings-chat-option-label">{t("cron.scheduleType")}</span>
              <select className="settings-select" value={kind} onChange={(event) => setKind(event.target.value as CronScheduleKind)}>
                <option value="cron">{t("cron.kindCron")}</option>
                <option value="daily">{t("cron.daily")}</option>
                <option value="weekly">{t("cron.weekly")}</option>
                <option value="once">{t("cron.once")}</option>
              </select>
            </label>
            {kind !== "cron" && (
              <label style={{ display: "grid", gap: 4 }}>
                <span className="settings-chat-option-label">{t("cron.times")}</span>
                <input className="settings-field-input" value={times} onChange={(event) => setTimes(event.target.value)} placeholder="09:00, 18:30" style={{ width: 160, fontVariantNumeric: "tabular-nums" }} />
              </label>
            )}
            {kind === "once" && (
              <label style={{ display: "grid", gap: 4 }}>
                <span className="settings-chat-option-label">{t("cron.date")}</span>
                <input className="settings-field-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ width: 160 }} />
              </label>
            )}
          </div>

          {kind === "cron" && (
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
                        cursor: "pointer", fontSize: 12, whiteSpace: "nowrap",
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

          {kind === "weekly" && (
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
                      cursor: "pointer", fontSize: 11.5,
                    }}
                  >
                    {t(`cron.weekday.${key}`)}
                  </button>
                );
              })}
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
            <ConfigButton variant="primary" size="small" disabled={!prompt.trim() || !taskCwd.trim()} onClick={() => void create()}>
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
                <span style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.name}</span>
                <span style={{ fontSize: 11.5, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                  {describe(task)}
                  {task.nextRunAt ? ` · ${t("cron.next")} ${new Date(task.nextRunAt).toLocaleString()}` : ` · ${t("cron.noNext")}`}
                  {task.missed ? ` · ${t("cron.missed")}` : ""}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.cwd}>
                  {task.prompt}
                </span>
                {(task.model || task.thinking) && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                    {task.model ? `${task.model.provider}/${task.model.modelId}` : t("cron.default")}{task.thinking ? ` · ${task.thinking}` : ""}
                  </span>
                )}
                {task.history && task.history.length > 0 && (
                  <details style={{ marginTop: 2 }}>
                    <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--text-dim)" }}>
                      {t("cron.history")} · {task.history.length}
                    </summary>
                    <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 3 }}>
                      {task.history.slice(0, 8).map((run, index) => (
                        <li key={`${run.at}-${index}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: run.status === "error" ? "var(--danger)" : "var(--text-dim)" }}>
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>{new Date(run.at).toLocaleString()}</span>
                          <span>{t(`cron.status.${run.status}`)}</span>
                          {run.sessionId && (
                            <button
                              type="button"
                              onClick={() => onOpenSession?.(run.sessionId!)}
                              style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: 11, padding: 0 }}
                            >
                              {t("cron.openRun")}
                            </button>
                          )}
                          {run.error && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={run.error}>{run.error}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {task.lastStatus && (
                  <span style={{ fontSize: 11, color: task.lastStatus === "error" ? "var(--danger)" : "var(--text-dim)" }}>
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
