"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton } from "../SettingsUi";
import { TEXT } from "@/lib/typography";
import { UsageHeatmap, UsageModelPie, UsageTrendChart } from "./usage-charts";
import type { UsageRange, UsageStatsSummary } from "@/lib/usage-stats";

/*
 * fork:zc-03 — the "Usage" settings section.
 *
 * Data comes from `GET /api/usage-stats`, which aggregates `lib/session-stats`
 * numbers across every session file and caches per-file results by
 * (size, mtimeMs). The panel is read-only: there is no "clear usage" action
 * because the only source of truth is the session files themselves.
 *
 * The three charts are inline SVG (`usage-charts.tsx`) on purpose — see that
 * file's header for why this fork does not take a chart dependency.
 */

const RANGE_KEYS: Record<UsageRange, string> = {
  "7d": "usage.range7d",
  "30d": "usage.range30d",
  all: "usage.rangeAll",
};

function formatCompact(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

function formatCost(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }): ReactNode {
  return (
    <div
      style={{
        display: "grid",
        gap: 2,
        padding: "9px 11px",
        border: "1px solid var(--border-faint)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-panel)",
        minWidth: 110,
      }}
    >
      <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)" }}>{label}</span>
      <strong style={{ fontSize: TEXT.xl, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</strong>
      {hint && <span style={{ fontSize: TEXT["2xs"], color: "var(--text-dim)" }}>{hint}</span>}
    </div>
  );
}

export function UsageStatsPanel(): ReactNode {
  const { t, locale } = useI18n();
  const [range, setRange] = useState<UsageRange>("30d");
  const [metric, setMetric] = useState<"sessions" | "tokens">("sessions");
  const [summary, setSummary] = useState<UsageStatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextRange: UsageRange) => {
    setLoading(true);
    setError(null);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const query = new URLSearchParams({ range: nextRange });
      if (timeZone) query.set("tz", timeZone);
      const response = await fetch(`/api/usage-stats?${query.toString()}`, { cache: "no-store" });
      const data = await response.json() as UsageStatsSummary & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (!Array.isArray(data.days) || !Array.isArray(data.models) || !data.totals) {
        throw new Error("Malformed usage response");
      }
      setSummary(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const totals = summary?.totals;
  const hasActivity = (totals?.tokens ?? 0) > 0 || (totals?.sessions ?? 0) > 0;
  const tokenKinds = useMemo(() => {
    if (!totals) return [];
    return [
      { label: t("usage.inputTokens"), value: totals.tokensByKind.input },
      { label: t("usage.outputTokens"), value: totals.tokensByKind.output },
      { label: t("usage.cacheReadTokens"), value: totals.tokensByKind.cacheRead },
      { label: t("usage.cacheWriteTokens"), value: totals.tokensByKind.cacheWrite },
    ];
  }, [t, totals]);

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("usage.title")}</h2>
      <p className="settings-chat-range-hint" style={{ marginTop: -6 }}>{t("usage.subtitle")}</p>

      <section className="settings-general-section">
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {(["7d", "30d", "all"] as const).map((option) => (
            <ConfigButton
              key={option}
              variant={range === option ? "primary" : "secondary"}
              size="small"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {t(RANGE_KEYS[option])}
            </ConfigButton>
          ))}
          <span style={{ flex: 1 }} />
          <ConfigButton variant="ghost" size="small" disabled={loading} onClick={() => void load(range)}>
            {t("usage.refresh")}
          </ConfigButton>
        </div>
        {summary && (
          <p className="settings-chat-range-hint" style={{ marginBottom: 0 }}>
            {t("usage.scannedHint", { files: summary.scanned.files, parsed: summary.scanned.parsed })}
          </p>
        )}
      </section>

      {loading && !summary && (
        <p role="status" className="settings-chat-range-hint">{t("usage.loading")}</p>
      )}
      {error && <p role="alert" className="settings-general-error">{t("usage.error")} {error}</p>}

      {summary && (
        <>
          <section className="settings-general-section">
            <h3 className="settings-general-heading">{t("usage.totals")}</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <StatCard label={t("usage.sessions")} value={formatCompact(summary.totals.sessions, locale)} />
              <StatCard label={t("usage.messages")} value={formatCompact(summary.totals.messages, locale)} />
              <StatCard
                label={t("usage.tokens")}
                value={formatCompact(summary.totals.tokens, locale)}
                hint={tokenKinds.map((kind) => `${kind.label} ${formatCompact(kind.value, locale)}`).join(" · ")}
              />
              <StatCard label={t("usage.cost")} value={formatCost(summary.totals.cost, locale)} />
            </div>
          </section>

          {!hasActivity && (
            <p role="status" className="settings-chat-range-hint">{t("usage.empty")}</p>
          )}

          {hasActivity && (
            <>
              <section className="settings-general-section">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <h3 className="settings-general-heading" style={{ margin: 0 }}>{t("usage.heatmap")}</h3>
                  <span style={{ flex: 1 }} />
                  <ConfigButton
                    variant={metric === "sessions" ? "primary" : "ghost"}
                    size="small"
                    aria-pressed={metric === "sessions"}
                    onClick={() => setMetric("sessions")}
                  >
                    {t("usage.metricSessions")}
                  </ConfigButton>
                  <ConfigButton
                    variant={metric === "tokens" ? "primary" : "ghost"}
                    size="small"
                    aria-pressed={metric === "tokens"}
                    onClick={() => setMetric("tokens")}
                  >
                    {t("usage.metricTokens")}
                  </ConfigButton>
                </div>
                <UsageHeatmap
                  days={summary.days}
                  metric={metric}
                  label={t("usage.heatmap")}
                />
              </section>

              <section className="settings-general-section">
                <h3 className="settings-general-heading">{t("usage.trend")}</h3>
                <UsageTrendChart days={summary.days} label={t("usage.trend")} />
              </section>

              <section className="settings-general-section">
                <h3 className="settings-general-heading">{t("usage.modelShare")}</h3>
                <UsageModelPie models={summary.models} emptyLabel={t("usage.empty")} label={t("usage.modelShare")} />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
