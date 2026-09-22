/**
 * fork:cron — a 5-field cron expression matcher (pure, no dependency).
 *
 * Supports what people actually type and what the UI's example list uses:
 * `*`, `N`, `a-b`, `a,b`, `*​/n` and `a-b/n` — minute, hour, day-of-month, month,
 * day-of-week. No names (`mon`), no `@daily` aliases, no seconds: an alias table is
 * another thing to document, and the reference implementation's examples are all
 * plain numbers.
 *
 * The Vixie rule for the day fields is kept: when BOTH day-of-month and day-of-week
 * are restricted, a date matches if EITHER matches (that is why `0 0 1 * 1` runs on
 * the 1st *and* on every Monday, which surprises people until they read it here).
 */

// fork:zc-19 — 第几个周几（Quartz/DOS 的 `D#N` 记法）。人类频率编辑器要能表达
// 「每月第二个周三」，而 5 字段 cron 里只有这一个写法；解析器必须认识它，
// 否则编译出的表达式会被自己的校验拒掉。
export interface CronWeekdayOrdinal {
  /** 0 = Sunday … 6 = Saturday。 */
  weekday: number;
  /** 当月第几次（1–5）。 */
  nth: number;
}

export interface CronExpression {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** `D#N` 形式的星期约束；与 `daysOfWeek` 是并集关系。 */
  dayOfWeekOrdinals: CronWeekdayOrdinal[];
  /** Whether the day fields were `*` — needed for the Vixie OR rule. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
  source: string;
}

const FIELD_LIMITS: Array<{ name: string; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  // 7 is Sunday as well (cron tradition) and is normalised to 0 below.
  { name: "day of week", min: 0, max: 7 },
];

interface ParsedField {
  values: number[];
  // fork:zc-19 — `D#N` tokens are kept separate so the matcher can require the
  // Nth occurrence of that weekday inside the month.
  ordinals?: CronWeekdayOrdinal[];
}

function parseField(raw: string, index: number): ParsedField | string {
  const { name, min, max } = FIELD_LIMITS[index];
  const values = new Set<number>();
  const ordinals: CronWeekdayOrdinal[] = [];

  for (const partRaw of raw.split(",")) {
    const part = partRaw.trim();
    if (!part) continue;

    // fork:zc-19 — `D#N` is only meaningful for day-of-week.
    if (index === 4 && part.includes("#")) {
      const [dayText, nthText, ...rest] = part.split("#");
      if (rest.length > 0 || !/^\d+$/.test(dayText) || !/^\d+$/.test(nthText)) {
        return `invalid weekday occurrence in ${name}: "${part}"`;
      }
      const day = Number(dayText);
      const nth = Number(nthText);
      if (day < 0 || day > 7) return `${name} must be between 0 and 6: "${part}"`;
      if (nth < 1 || nth > 5) return `${name} occurrence must be between 1 and 5: "${part}"`;
      ordinals.push({ weekday: day % 7, nth });
      continue;
    }

    let step = 1;
    let body = part;
    const slash = part.indexOf("/");
    if (slash >= 0) {
      body = part.slice(0, slash);
      const stepText = part.slice(slash + 1);
      if (!/^\d+$/.test(stepText)) return `invalid step in ${name}: "${part}"`;
      step = Number(stepText);
      if (step < 1) return `step must be at least 1 in ${name}`;
    }

    let start: number;
    let end: number;
    if (body === "*") {
      start = min;
      end = max;
    } else {
      const dash = body.indexOf("-");
      if (dash > 0) {
        const startText = body.slice(0, dash);
        const endText = body.slice(dash + 1);
        if (!/^\d+$/.test(startText) || !/^\d+$/.test(endText)) return `invalid range in ${name}: "${part}"`;
        start = Number(startText);
        end = Number(endText);
        if (start > end) return `range is backwards in ${name}: "${part}"`;
      } else {
        if (!/^\d+$/.test(body)) return `invalid value in ${name}: "${part}"`;
        start = Number(body);
        end = slash >= 0 ? max : start;
      }
    }

    if (start < min || end > max) return `${name} must be between ${min} and ${max === 7 ? 6 : max}: "${part}"`;
    for (let value = start; value <= end; value += step) {
      // Day-of-week accepts 7 as Sunday; normalise to 0.
      values.add(index === 4 ? value % 7 : value);
    }
  }

  if (values.size === 0 && ordinals.length === 0) return `empty ${name}`;
  return {
    values: [...values].sort((a, b) => a - b),
    ...(ordinals.length > 0 ? { ordinals } : {}),
  };
}

/** Parse, or return the reason it cannot be used (shown verbatim in the UI). */
export function parseCronExpression(expression: string): CronExpression | string {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) return "An expression needs exactly 5 fields: minute hour day month weekday";

  const parsed: ParsedField[] = [];
  for (let index = 0; index < 5; index += 1) {
    const result = parseField(fields[index]!, index);
    if (typeof result === "string") return result;
    parsed.push(result);
  }

  return {
    minutes: parsed[0]!.values,
    hours: parsed[1]!.values,
    daysOfMonth: parsed[2]!.values,
    months: parsed[3]!.values,
    daysOfWeek: parsed[4]!.values,
    dayOfWeekOrdinals: parsed[4]!.ordinals ?? [],
    dayOfMonthRestricted: fields[2] !== "*",
    dayOfWeekRestricted: fields[4] !== "*",
    source: fields.join(" "),
  };
}

export function isCronExpression(value: unknown): value is CronExpression {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as CronExpression).minutes);
}

// fork:zc-19 — `D#N` matches when the date is the Nth occurrence of that weekday
// in the month: days 1–7 are the 1st, 8–14 the 2nd, ….
export function weekdayOrdinalOfMonth(day: number): number {
  return Math.floor((day - 1) / 7) + 1;
}

/** Does a wall-clock date match the day fields? */
export function cronMatchesDay(expression: CronExpression, year: number, month: number, day: number, weekday: number): boolean {
  if (!expression.months.includes(month)) return false;
  const dayOfMonthHit = expression.daysOfMonth.includes(day);
  const ordinalHit = (expression.dayOfWeekOrdinals ?? []).some(
    (entry) => entry.weekday === weekday && entry.nth === weekdayOrdinalOfMonth(day),
  );
  const dayOfWeekHit = expression.daysOfWeek.includes(weekday) || ordinalHit;
  if (expression.dayOfMonthRestricted && expression.dayOfWeekRestricted) return dayOfMonthHit || dayOfWeekHit;
  if (expression.dayOfMonthRestricted) return dayOfMonthHit;
  if (expression.dayOfWeekRestricted) return dayOfWeekHit;
  return true;
}

export function cronMatchesMinute(expression: CronExpression, hour: number, minute: number): boolean {
  return expression.hours.includes(hour) && expression.minutes.includes(minute);
}

/** The example rows shown next to the expression input (same wording as the reference). */
export const CRON_EXAMPLES: Array<{ expression: string; labelKey: string }> = [
  { expression: "*/5 * * * *", labelKey: "cron.example5min" },
  { expression: "0 * * * *", labelKey: "cron.exampleHourly" },
  { expression: "0 9 * * 1", labelKey: "cron.exampleMonday9" },
  { expression: "0 9,17 * * *", labelKey: "cron.example9and17" },
  { expression: "0 0 1 * *", labelKey: "cron.exampleFirstOfMonth" },
];
