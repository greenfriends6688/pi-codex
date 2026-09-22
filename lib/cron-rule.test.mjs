import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/*
 * fork:zc-19 — the human-readable frequency compiler.
 *
 * The load-bearing test is the round trip: compile a structure, parse the
 * expression back, and get exactly the same structure. Without that, opening an
 * existing task in the editor and saving it could silently change the schedule.
 * DST days, month ends and Feb 29 are checked against the real scheduler math.
 */

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  compileCronRule,
  parseCronRule,
  validateCronRule,
  parseClockTime,
  formatClockTime,
} = await jiti.import("@/lib/cron-rule");
const { computeNextRun } = await jiti.import("@/lib/cron-schedule");
const { cronMatchesDay, parseCronExpression } = await jiti.import("@/lib/cron-expression");
const { zonedParts } = await jiti.import("@/lib/cron-timezone");

const ROUND_TRIP_RULES = [
  { kind: "minutes", interval: 1 },
  { kind: "minutes", interval: 5 },
  { kind: "minutes", interval: 59 },
  { kind: "hours", interval: 1, minute: 0 },
  { kind: "hours", interval: 3, minute: 30 },
  { kind: "daily", time: "09:00" },
  { kind: "daily", time: "23:59", endDate: "2026-12-31" },
  { kind: "weekly", time: "08:15", weekdays: [1, 3, 5] },
  { kind: "weekly", time: "08:15", weekdays: [0, 6] },
  { kind: "monthly", mode: "date", time: "00:00", day: 1 },
  { kind: "monthly", mode: "date", time: "18:45", day: 31 },
  { kind: "monthly", mode: "weekday", time: "12:00", weekday: 3, ordinal: 2 },
  { kind: "monthly", mode: "weekday", time: "12:00", weekday: 0, ordinal: 5 },
  { kind: "yearly", time: "09:30", month: 2, day: 29 },
  { kind: "yearly", time: "09:30", month: 12, day: 25, endDate: "2030-01-01" },
];

test("round trip: structure → cron → structure is identity", () => {
  for (const rule of ROUND_TRIP_RULES) {
    const compiled = compileCronRule(rule);
    assert.equal(compiled.ok, true, `should compile: ${JSON.stringify(rule)}`);
    if (!compiled.ok) continue;
    const parsed = parseCronRule(compiled.expression, compiled.endDate);
    assert.deepEqual(parsed, rule, `${JSON.stringify(rule)} → "${compiled.expression}" → back`);
  }
});

test("compile emits the documented 5-field expressions", () => {
  const expression = (rule) => {
    const result = compileCronRule(rule);
    assert.equal(result.ok, true, JSON.stringify(rule));
    return result.ok ? result.expression : "";
  };
  assert.equal(expression({ kind: "minutes", interval: 1 }), "* * * * *");
  assert.equal(expression({ kind: "minutes", interval: 5 }), "*/5 * * * *");
  assert.equal(expression({ kind: "hours", interval: 1, minute: 0 }), "0 * * * *");
  assert.equal(expression({ kind: "hours", interval: 6, minute: 45 }), "45 */6 * * *");
  assert.equal(expression({ kind: "daily", time: "09:05" }), "5 9 * * *");
  assert.equal(expression({ kind: "weekly", time: "09:05", weekdays: [1, 2, 3, 4, 5] }), "5 9 * * 1,2,3,4,5");
  assert.equal(expression({ kind: "monthly", mode: "date", time: "09:05", day: 15 }), "5 9 15 * *");
  assert.equal(expression({ kind: "monthly", mode: "weekday", time: "09:05", weekday: 5, ordinal: 2 }), "5 9 * * 5#2");
  assert.equal(expression({ kind: "yearly", time: "09:05", month: 2, day: 29 }), "5 9 29 2 *");
});

test("invalid rules fail loudly instead of being rounded", () => {
  const invalid = [
    { kind: "minutes", interval: 0 },
    { kind: "minutes", interval: 60 },
    { kind: "minutes", interval: 2.5 },
    { kind: "hours", interval: 24, minute: 0 },
    { kind: "hours", interval: 1, minute: 60 },
    { kind: "daily", time: "9:00" },
    { kind: "daily", time: "24:00" },
    { kind: "weekly", time: "09:00", weekdays: [] },
    { kind: "weekly", time: "09:00", weekdays: [7] },
    { kind: "monthly", mode: "date", time: "09:00", day: 32 },
    { kind: "monthly", mode: "weekday", time: "09:00", weekday: 1, ordinal: 6 },
    { kind: "yearly", time: "09:00", month: 13, day: 1 },
    { kind: "yearly", time: "09:00", month: 1, day: 0 },
    { kind: "daily", time: "09:00", endDate: "2026-13-01" },
  ];
  for (const rule of invalid) {
    assert.notEqual(validateCronRule(rule), null, `should be invalid: ${JSON.stringify(rule)}`);
    assert.equal(compileCronRule(rule).ok, false, `should not compile: ${JSON.stringify(rule)}`);
  }
});

test("expressions the visual editor cannot represent parse back as null", () => {
  for (const expression of [
    "*/5 1 * * *", // minute step plus a fixed hour
    "0 0 */2 * *", // every N days (no human rule for it)
    "0 9 * * 1#1,5", // mixed ordinal and plain weekday
    "0 9 1-7 * 1", // Vixie OR across two day fields
    "0 9 * 1 *", // monthly is expressed through the day field
    "not a cron",
  ]) {
    assert.equal(parseCronRule(expression), null, expression);
  }
  // A raw multi-time daily task is not one of the human shapes either.
  assert.equal(parseCronRule("0 9,17 * * *"), null);
});

test("Nth-weekday matching uses the occurrence inside the month", () => {
  const parsed = parseCronExpression("0 9 * * 1#2");
  assert.notEqual(typeof parsed, "string");
  // September 2026: Mondays are 7, 14, 21, 28 — the 2nd is the 14th.
  assert.equal(cronMatchesDay(parsed, 2026, 9, 7, 1), false);
  assert.equal(cronMatchesDay(parsed, 2026, 9, 14, 1), true);
  assert.equal(cronMatchesDay(parsed, 2026, 9, 21, 1), false);
  assert.equal(cronMatchesDay(parsed, 2026, 9, 15, 2), false);
});

test("clock parsing is strict and formatting is zero-padded", () => {
  assert.deepEqual(parseClockTime("09:30"), { hour: 9, minute: 30 });
  assert.equal(parseClockTime("9:30"), null);
  assert.equal(parseClockTime("24:00"), null);
  assert.equal(formatClockTime(9, 5), "09:05");
});

test("a compiled monthly-by-date 31 skips months that have no 31st", () => {
  const compiled = compileCronRule({ kind: "monthly", mode: "date", time: "09:00", day: 31 });
  assert.equal(compiled.ok, true);
  const from = new Date(2026, 3, 1, 0, 0, 0); // 2026-04-01 local
  const next = computeNextRun({ kind: "cron", times: [], expression: compiled.expression }, from);
  assert.deepEqual(
    { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate(), hour: next.getHours() },
    { year: 2026, month: 5, day: 31, hour: 9 },
  );
});

test("a compiled yearly Feb 29 only fires in a leap year", () => {
  const compiled = compileCronRule({ kind: "yearly", time: "09:00", month: 2, day: 29 });
  assert.equal(compiled.ok, true);
  // Start close enough that the scheduler's bounded day scan can reach the leap year.
  const from = new Date(2027, 2, 1, 0, 0, 0);
  const next = computeNextRun({ kind: "cron", times: [], expression: compiled.expression }, from);
  assert.deepEqual(
    { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate(), hour: next.getHours() },
    { year: 2028, month: 2, day: 29, hour: 9 },
  );
});

test("a compiled daily rule still fires on a DST transition day", () => {
  const compiled = compileCronRule({ kind: "daily", time: "02:30" });
  assert.equal(compiled.ok, true);
  const schedule = { kind: "cron", times: [], expression: compiled.expression, timezone: "America/New_York" };

  // Spring forward (2026-03-08): 02:30 does not exist locally, but the run must
  // still be scheduled on that day (the zone helper lands just around the jump).
  const spring = computeNextRun(schedule, new Date("2026-03-08T04:00:00.000Z"));
  assert.notEqual(spring, null);
  const springParts = zonedParts(spring, "America/New_York");
  assert.deepEqual({ day: springParts.day, month: springParts.month, year: springParts.year }, { day: 8, month: 3, year: 2026 });

  // Fall back (2026-11-01): 02:30 exists on both sides of the repeated hour and
  // must resolve to the zone's wall clock.
  const fall = computeNextRun(schedule, new Date("2026-11-01T04:00:00.000Z"));
  assert.notEqual(fall, null);
  const fallParts = zonedParts(fall, "America/New_York");
  assert.deepEqual(
    { day: fallParts.day, hour: fallParts.hour, minute: fallParts.minute },
    { day: 1, hour: 2, minute: 30 },
  );
});

test("an end date is carried next to the expression and stops future runs", () => {
  const compiled = compileCronRule({ kind: "daily", time: "09:00", endDate: "2026-09-22" });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.endDate, "2026-09-22");
  const schedule = { kind: "cron", times: [], expression: compiled.expression, endDate: compiled.endDate };

  const before = computeNextRun(schedule, new Date(2026, 8, 21, 0, 0, 0));
  assert.deepEqual({ day: before.getDate(), hour: before.getHours() }, { day: 21, hour: 9 });
  assert.equal(computeNextRun(schedule, new Date(2026, 8, 22, 10, 0, 0)), null, "nothing after the end date");
});
