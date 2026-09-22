"use client";

import type { ReactNode } from "react";
import { TEXT } from "@/lib/typography";

/*
 * fork:zc-03 — inline SVG charts for the usage panel.
 *
 * Why no chart library: the plan is zero-new-dependency, and the three charts
 * are simple enough to own outright (a rect grid, a path arc, a polyline). The
 * reference project uses recharts and had to add lazy loading + a local error
 * boundary to work around its Electron/Linux module init crash; hand-written
 * SVG has no such failure mode and contributes ~0 KB.
 *
 * All colours come from CSS variables so light/dark/auto keep working.
 */

export interface UsageDayPointLike {
  day: string;
  sessions: number;
  messages: number;
  tokens: number;
  cost: number;
}

function dayMs(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, date ?? 1);
}

function monthLabel(day: string): string {
  const [, month] = day.split("-").map(Number);
  return `${month ?? 1}月`;
}

const CELL = 13;
const GAP = 3;

export function UsageHeatmap({
  days,
  metric,
  label,
}: {
  days: readonly UsageDayPointLike[];
  metric: "sessions" | "tokens";
  label: string;
}): ReactNode {
  if (days.length === 0) {
    return <p style={{ margin: 0, fontSize: TEXT.xs, color: "var(--text-dim)" }}>—</p>;
  }

  const values = days.map((day) => (metric === "sessions" ? day.sessions : day.tokens));
  const max = Math.max(1, ...values);
  const firstWeekday = new Date(dayMs(days[0].day)).getUTCDay();
  const columns = Math.ceil((days.length + firstWeekday) / 7);
  const width = 30 + columns * (CELL + GAP);
  const height = 16 + 7 * (CELL + GAP);
  const levels = (value: number): number => {
    if (value <= 0) return 0;
    return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
  };
  const opacityFor = (level: number): number => (level === 0 ? 0 : 0.18 + level * 0.2);

  const monthMarks: { x: number; label: string }[] = [];
  let lastMonth = "";
  for (let column = 0; column < columns; column += 1) {
    const index = column * 7 - firstWeekday;
    const source = days[Math.max(0, Math.min(days.length - 1, index))];
    if (!source) continue;
    const month = source.day.slice(0, 7);
    if (month !== lastMonth && (column === 0 || Number(source.day.slice(8, 10)) <= 7)) {
      monthMarks.push({ x: 30 + column * (CELL + GAP), label: monthLabel(source.day) });
      lastMonth = month;
    }
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ display: "block" }}
      >
        {monthMarks.map((mark) => (
          <text
            key={`${mark.x}-${mark.label}`}
            x={mark.x}
            y={10}
            fill="var(--text-dim)"
            fontSize={9}
          >
            {mark.label}
          </text>
        ))}
        {days.map((day, index) => {
          const value = metric === "sessions" ? day.sessions : day.tokens;
          const level = levels(value);
          const slot = index + firstWeekday;
          const column = Math.floor(slot / 7);
          const row = slot % 7;
          return (
            <rect
              key={day.day}
              x={30 + column * (CELL + GAP)}
              y={16 + row * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={3}
              fill={level === 0 ? "var(--bg-hover)" : "var(--accent)"}
              fillOpacity={level === 0 ? 1 : opacityFor(level)}
            >
              <title>{`${day.day} · ${value}`}</title>
            </rect>
          );
        })}
      </svg>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: TEXT["2xs"], color: "var(--text-dim)" }}>
        <span>0</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            style={{
              width: CELL,
              height: CELL,
              borderRadius: 3,
              background: level === 0 ? "var(--bg-hover)" : "var(--accent)",
              opacity: level === 0 ? 1 : opacityFor(level),
            }}
          />
        ))}
        <span>{max}</span>
      </div>
    </div>
  );
}

export interface UsageModelPointLike {
  model: string;
  messages: number;
  tokens: number;
  cost: number;
  share: number;
}

function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const [x1, y1] = polar(cx, cy, outer, start);
  const [x2, y2] = polar(cx, cy, outer, end);
  const [x3, y3] = polar(cx, cy, inner, end);
  const [x4, y4] = polar(cx, cy, inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
}

export function UsageModelPie({
  models,
  emptyLabel,
  label,
}: {
  models: readonly UsageModelPointLike[];
  emptyLabel: string;
  label: string;
}): ReactNode {
  const total = models.reduce((sum, model) => sum + model.tokens, 0);
  if (total <= 0) {
    return <p style={{ margin: 0, fontSize: TEXT.xs, color: "var(--text-dim)" }}>{emptyLabel}</p>;
  }

  // Top 6 slices, everything else collapses into one "other" arc.
  const sorted = [...models].sort((a, b) => b.tokens - a.tokens);
  const top = sorted.slice(0, 6);
  const rest = sorted.slice(6);
  const slices = rest.length > 0
    ? [...top, { model: "other", messages: rest.reduce((s, m) => s + m.messages, 0), tokens: rest.reduce((s, m) => s + m.tokens, 0), cost: rest.reduce((s, m) => s + m.cost, 0), share: rest.reduce((s, m) => s + m.share, 0) }]
    : top;

  let angle = -Math.PI / 2;
  const paths = slices.map((slice, index) => {
    const sweep = (slice.tokens / total) * Math.PI * 2;
    const path = arcPath(60, 60, 52, 30, angle, angle + Math.max(sweep, 0.0001));
    angle += sweep;
    return { slice, path, opacity: Math.max(0.25, 1 - index * 0.12) };
  });

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <svg role="img" aria-label={label} viewBox="0 0 120 120" width={112} height={112}>
        {paths.map(({ slice, path, opacity }) => (
          <path key={slice.model} d={path} fill="var(--accent)" fillOpacity={opacity}>
            <title>{`${slice.model} · ${Math.round(slice.share * 100)}%`}</title>
          </path>
        ))}
      </svg>
      <div style={{ display: "grid", gap: 3, minWidth: 180 }}>
        {paths.map(({ slice, opacity }) => (
          <div key={slice.model} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: TEXT.xs }}>
            <span
              aria-hidden="true"
              style={{ width: 9, height: 9, borderRadius: 2, background: "var(--accent)", opacity, flexShrink: 0 }}
            />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
              {slice.model}
            </span>
            <span style={{ color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
              {(slice.share * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UsageTrendChart({
  days,
  label,
}: {
  days: readonly UsageDayPointLike[];
  label: string;
}): ReactNode {
  if (days.length === 0) {
    return <p style={{ margin: 0, fontSize: TEXT.xs, color: "var(--text-dim)" }}>—</p>;
  }

  const width = 600;
  const height = 120;
  const padding = { top: 10, right: 8, bottom: 18, left: 34 };
  const max = Math.max(1, ...days.map((day) => day.tokens));
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index: number): number => padding.left + (days.length === 1 ? 0 : (index / (days.length - 1)) * plotWidth);
  const y = (value: number): number => padding.top + plotHeight - (value / max) * plotHeight;

  const line = days.map((day, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(day.tokens).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(days.length - 1).toFixed(1)} ${padding.top + plotHeight} L ${x(0).toFixed(1)} ${padding.top + plotHeight} Z`;

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: "block" }}>
      {[0, 0.5, 1].map((ratio) => (
        <line
          key={ratio}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + plotHeight * ratio}
          y2={padding.top + plotHeight * ratio}
          stroke="var(--border-faint)"
          strokeWidth={1}
        />
      ))}
      <text x={2} y={padding.top + 4} fill="var(--text-dim)" fontSize={9}>{max}</text>
      <text x={2} y={padding.top + plotHeight + 3} fill="var(--text-dim)" fontSize={9}>0</text>
      <path d={area} fill="var(--accent)" fillOpacity={0.16} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <text x={padding.left} y={height - 4} fill="var(--text-dim)" fontSize={9}>{days[0].day.slice(5)}</text>
      <text x={width - padding.right} y={height - 4} textAnchor="end" fill="var(--text-dim)" fontSize={9}>
        {days[days.length - 1].day.slice(5)}
      </text>
    </svg>
  );
}
