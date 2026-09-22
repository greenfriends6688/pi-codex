/**
 * fork:zc-19 — human-readable frequency ↔ 5-field cron (pure, two-way).
 *
 * WHY: the schedule editor exposed raw cron expressions right next to the
 * simple daily/weekly shapes, which meant the most common requests ("every 3
 * hours", "the second Wednesday of the month", "yearly on Feb 29") required the
 * user to know cron. This module is the compiler between a small structure the
 * UI can render as selects/inputs and the *existing* 5-field expression — there
 * is deliberately no second runtime schedule format: the store stays
 * `{ kind: "cron", expression }` and `cron-schedule.ts` keeps parsing it.
 *
 * Round-trip contract (asserted by cron-rule.test.mjs): compiling a valid rule
 * and parsing the result back yields the same structure, so editing an existing
 * expression and saving it again cannot silently change the schedule.
 *
 * End dates are not part of cron; they travel next to the expression and are
 * carried through `CronSchedule.endDate`.
 */

import { parseCronExpression } from "./cron-expression";
import { parseCronDate } from "./cron-schedule";

export type CronRuleKind = "minutes" | "hours" | "daily" | "weekly" | "monthly" | "yearly";
export type CronRuleMonthlyMode = "date" | "weekday";

interface CronRuleBase {
  /** Inclusive last day the rule may fire ("YYYY-MM-DD"); carried outside cron. */
  endDate?: string;
}

export interface CronMinutesRule extends CronRuleBase {
  kind: "minutes";
  /** Every N minutes, 1–59 (a single cron step can express at most 59). */
  interval: number;
}

export interface CronHoursRule extends CronRuleBase {
  kind: "hours";
  /** Every N hours, 1–23. */
  interval: number;
  /** Minute of the hour, 0–59. */
  minute: number;
}

export interface CronDailyRule extends CronRuleBase {
  kind: "daily";
  /** "HH:MM" wall-clock time. */
  time: string;
}

export interface CronWeeklyRule extends CronRuleBase {
  kind: "weekly";
  time: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
}

export interface CronMonthlyDateRule extends CronRuleBase {
  kind: "monthly";
  mode: "date";
  time: string;
  day: number;
}

export interface CronMonthlyWeekdayRule extends CronRuleBase {
  kind: "monthly";
  mode: "weekday";
  time: string;
  weekday: number;
  /** 1 = first occurrence in the month … 5 = fifth. */
  ordinal: number;
}

export interface CronYearlyRule extends CronRuleBase {
  kind: "yearly";
  time: string;
  /** 1–12. */
  month: number;
  day: number;
}

export type CronRule =
  | CronMinutesRule
  | CronHoursRule
  | CronDailyRule
  | CronWeeklyRule
  | CronMonthlyDateRule
  | CronMonthlyWeekdayRule
  | CronYearlyRule;

export const CRON_RULE_KINDS: readonly CronRuleKind[] = ["minutes", "hours", "daily", "weekly", "monthly", "yearly"];

/** Largest interval each unit can express as a single cron step. */
export const CRON_RULE_MAX_INTERVAL: Record<"minutes" | "hours", number> = { minutes: 59, hours: 23 };

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ClockTime {
  hour: number;
  minute: number;
}

/** Parse strict "HH:MM" (zero-padded, as produced by `<input type="time">`). */
export function parseClockTime(value: string | undefined): ClockTime | null {
  if (typeof value !== "string") return null;
  const match = CLOCK_RE.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function formatClockTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Validate a rule; returns an error message or null. */
export function validateCronRule(rule: CronRule): string | null {
  if (rule.endDate !== undefined && !parseCronDate(rule.endDate)) {
    return `endDate must be YYYY-MM-DD: "${rule.endDate}"`;
  }
  switch (rule.kind) {
    case "minutes":
      if (!isIntegerInRange(rule.interval, 1, CRON_RULE_MAX_INTERVAL.minutes)) {
        return `minutes interval must be 1–${CRON_RULE_MAX_INTERVAL.minutes}`;
      }
      return null;
    case "hours":
      if (!isIntegerInRange(rule.interval, 1, CRON_RULE_MAX_INTERVAL.hours)) {
        return `hours interval must be 1–${CRON_RULE_MAX_INTERVAL.hours}`;
      }
      if (!isIntegerInRange(rule.minute, 0, 59)) return "minute must be 0–59";
      return null;
    case "daily":
      return parseClockTime(rule.time) ? null : `time must be HH:MM: "${rule.time}"`;
    case "weekly": {
      const time = parseClockTime(rule.time);
      if (!time) return `time must be HH:MM: "${rule.time}"`;
      if (rule.weekdays.length === 0) return "a weekly rule needs at least one weekday";
      if (!rule.weekdays.every((day) => isIntegerInRange(day, 0, 6))) return "weekdays must be 0–6";
      return null;
    }
    case "monthly": {
      if (!parseClockTime(rule.time)) return `time must be HH:MM: "${rule.time}"`;
      if (rule.mode === "date") {
        return isIntegerInRange(rule.day, 1, 31) ? null : "day must be 1–31";
      }
      if (!isIntegerInRange(rule.weekday, 0, 6)) return "weekday must be 0–6";
      return isIntegerInRange(rule.ordinal, 1, 5) ? null : "ordinal must be 1–5";
    }
    case "yearly":
      if (!parseClockTime(rule.time)) return `time must be HH:MM: "${rule.time}"`;
      if (!isIntegerInRange(rule.month, 1, 12)) return "month must be 1–12";
      return isIntegerInRange(rule.day, 1, 31) ? null : "day must be 1–31";
  }
}

export type CompileCronRuleResult =
  | { ok: true; expression: string; endDate?: string }
  | { ok: false; error: string };

const weekdaysField = (weekdays: readonly number[]) =>
  [...new Set(weekdays)].sort((a, b) => a - b).join(",");

/**
 * Compile a rule into the 5-field expression the scheduler already runs.
 * A rule that cannot be represented (e.g. "every 90 minutes") fails loudly
 * instead of being rounded to something the user did not ask for.
 */
export function compileCronRule(rule: CronRule): CompileCronRuleResult {
  const error = validateCronRule(rule);
  if (error) return { ok: false, error };

  const end = rule.endDate ? { endDate: rule.endDate } : {};
  switch (rule.kind) {
    case "minutes":
      // `*` and `*/1` are the same schedule; keep the canonical short form.
      return { ok: true, expression: rule.interval === 1 ? "* * * * *" : `*/${rule.interval} * * * *`, ...end };
    case "hours":
      return {
        ok: true,
        expression: rule.interval === 1
          ? `${rule.minute} * * * *`
          : `${rule.minute} */${rule.interval} * * *`,
        ...end,
      };
    case "daily": {
      const time = parseClockTime(rule.time)!;
      return { ok: true, expression: `${time.minute} ${time.hour} * * *`, ...end };
    }
    case "weekly": {
      const time = parseClockTime(rule.time)!;
      return { ok: true, expression: `${time.minute} ${time.hour} * * ${weekdaysField(rule.weekdays)}`, ...end };
    }
    case "monthly": {
      const time = parseClockTime(rule.time)!;
      if (rule.mode === "date") {
        return { ok: true, expression: `${time.minute} ${time.hour} ${rule.day} * *`, ...end };
      }
      return { ok: true, expression: `${time.minute} ${time.hour} * * ${rule.weekday}#${rule.ordinal}`, ...end };
    }
    case "yearly": {
      const time = parseClockTime(rule.time)!;
      return { ok: true, expression: `${time.minute} ${time.hour} ${rule.day} ${rule.month} *`, ...end };
    }
  }
}

function withEnd(rule: CronRule, endDate: string | undefined): CronRule {
  return endDate ? { ...rule, endDate } : rule;
}

function isIntegerField(value: string | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

/**
 * Parse an expression back into a rule, or null when it is not one of the
 * shapes the visual editor can show (the UI then keeps the raw cron editor).
 * `endDate` is passed straight through — cron cannot carry it.
 */
export function parseCronRule(expression: string, endDate?: string): CronRule | null {
  const parsed = parseCronExpression(expression);
  if (typeof parsed === "string") return null;

  const [minRaw, hourRaw, domRaw, monRaw, dowRaw] = parsed.source.split(" ");
  if ([minRaw, hourRaw, domRaw, monRaw, dowRaw].some((field) => field === undefined)) return null;

  // fork:zc-19 — a single `D#N` token is representable; a mixed day field
  // (`1,5#2`) is not. Return null instead of silently dropping the ordinal.
  if (parsed.dayOfWeekOrdinals.length > 0 && !/^\d+#\d+$/.test(dowRaw)) return null;

  // Every N minutes: `*` or `*/N` in the minute field, everything else `*`.
  if ((minRaw === "*" || /^\*\/\d+$/.test(minRaw)) && hourRaw === "*" && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    const interval = minRaw === "*" ? 1 : Number(minRaw.slice(2));
    if (!isIntegerInRange(interval, 1, CRON_RULE_MAX_INTERVAL.minutes)) return null;
    return withEnd({ kind: "minutes", interval }, endDate);
  }

  if (!isIntegerField(minRaw)) return null;
  const minute = Number(minRaw);
  if (!isIntegerInRange(minute, 0, 59)) return null;

  // Every N hours with a fixed minute: `M * * * *` or `M */N * * *`.
  if ((hourRaw === "*" || /^\*\/\d+$/.test(hourRaw)) && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    const interval = hourRaw === "*" ? 1 : Number(hourRaw.slice(2));
    if (!isIntegerInRange(interval, 1, CRON_RULE_MAX_INTERVAL.hours)) return null;
    return withEnd({ kind: "hours", interval, minute }, endDate);
  }

  if (!isIntegerField(hourRaw)) return null;
  const hour = Number(hourRaw);
  if (!isIntegerInRange(hour, 0, 23)) return null;
  const time = formatClockTime(hour, minute);

  // Monthly by the Nth weekday: `M H * * D#N`.
  if (domRaw === "*" && monRaw === "*" && /^\d+#\d+$/.test(dowRaw)) {
    const [weekdayText, ordinalText] = dowRaw.split("#");
    const weekdayRaw = Number(weekdayText);
    if (!isIntegerInRange(weekdayRaw, 0, 7)) return null;
    const weekday = weekdayRaw % 7;
    const ordinal = Number(ordinalText);
    if (!isIntegerInRange(ordinal, 1, 5)) return null;
    return withEnd({ kind: "monthly", mode: "weekday", time, weekday, ordinal }, endDate);
  }

  // Daily: `M H * * *`.
  if (domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return withEnd({ kind: "daily", time }, endDate);
  }

  // Monthly by date: `M H D * *`.
  if (isIntegerField(domRaw) && monRaw === "*" && dowRaw === "*") {
    const day = Number(domRaw);
    if (!isIntegerInRange(day, 1, 31)) return null;
    return withEnd({ kind: "monthly", mode: "date", time, day }, endDate);
  }

  // Yearly: `M H D MON *`.
  if (isIntegerField(domRaw) && isIntegerField(monRaw) && dowRaw === "*") {
    const month = Number(monRaw);
    const day = Number(domRaw);
    if (!isIntegerInRange(month, 1, 12) || !isIntegerInRange(day, 1, 31)) return null;
    return withEnd({ kind: "yearly", time, month, day }, endDate);
  }

  // Weekly: `M H * * D(,D…|range)`. The parser has already expanded ranges, so
  // the stored weekdays are the exact set the expression matches.
  if (domRaw === "*" && monRaw === "*" && dowRaw !== "*") {
    const weekdays = [...new Set(parsed.daysOfWeek)].sort((a, b) => a - b);
    if (weekdays.length === 0 || !weekdays.every((day) => isIntegerInRange(day, 0, 6))) return null;
    return withEnd({ kind: "weekly", time, weekdays }, endDate);
  }

  return null;
}
