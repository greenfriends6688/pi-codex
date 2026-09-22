import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { CRON_EXAMPLES, cronMatchesDay, parseCronExpression } = await jiti.import("@/lib/cron-expression");
const { computeNextRun, isInsideIdleWindow, normalizeIdleWindow } = await jiti.import("@/lib/cron-schedule");
const { isKnownTimezone, zonedParts, zonedTimeToInstant } = await jiti.import("@/lib/cron-timezone");

const iso = (date) => (date ? date.toISOString() : null);

test("expressions parse, and bad ones explain themselves", () => {
  const parsed = parseCronExpression("*/5 9-17 * * 1,3");
  assert.notEqual(typeof parsed, "string", `should parse, got: ${parsed}`);
  assert.equal(parsed.source, "*/5 9-17 * * 1,3");
  assert.deepEqual(parsed.minutes, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(parsed.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(parsed.daysOfWeek, [1, 3]);
  assert.equal(parsed.dayOfMonthRestricted, false);

  for (const bad of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 32 * *", "* * * 13 *", "* * * * 8", "5-1 * * * *", "*/0 * * * *", "a * * * *"]) {
    assert.equal(typeof parseCronExpression(bad), "string", `should reject: "${bad}"`);
  }

  // Sunday is both 0 and 7.
  assert.deepEqual(parseCronExpression("0 0 * * 7").daysOfWeek, [0]);
});

test("Nth-weekday tokens (`D#N`) parse and match the right occurrence", () => {
  const parsed = parseCronExpression("0 9 * * 1#2");
  assert.notEqual(typeof parsed, "string", `should parse, got: ${parsed}`);
  assert.deepEqual(parsed.daysOfWeek, []);
  assert.deepEqual(parsed.dayOfWeekOrdinals, [{ weekday: 1, nth: 2 }]);
  // 2026-09-14 is the second Monday of September 2026.
  assert.equal(cronMatchesDay(parsed, 2026, 9, 14, 1), true);
  assert.equal(cronMatchesDay(parsed, 2026, 9, 7, 1), false);
  // Sunday 7 normalises to 0.
  assert.deepEqual(parseCronExpression("0 9 * * 7#1").dayOfWeekOrdinals, [{ weekday: 0, nth: 1 }]);

  for (const bad of ["0 9 * * 1#0", "0 9 * * 1#6", "0 9 * * 8#1", "0 9 * * 1#x", "0 9 * * #2"]) {
    assert.equal(typeof parseCronExpression(bad), "string", `should reject: "${bad}"`);
  }
});

test("the Vixie OR rule for day fields", () => {
  const either = parseCronExpression("0 0 1 * 1");
  // 2026-09-01 is a Tuesday (2); 2026-09-07 is a Monday.
  assert.equal(cronMatchesDay(either, 2026, 9, 1, 2), true, "the 1st matches on day-of-month");
  assert.equal(cronMatchesDay(either, 2026, 9, 7, 1), true, "a Monday matches on day-of-week");
  assert.equal(cronMatchesDay(either, 2026, 9, 8, 2), false);

  const allDays = parseCronExpression("0 0 * * *");
  assert.equal(cronMatchesDay(allDays, 2026, 9, 8, 2), true);
});

test("next run for the UI's own examples", () => {
  const from = new Date(2026, 8, 17, 8, 3, 0); // 2026-09-17 08:03 local (Thursday)
  const next = (expression) => iso(computeNextRun({ kind: "cron", times: [], expression }, from));

  assert.equal(next("*/5 * * * *"), iso(new Date(2026, 8, 17, 8, 5, 0)), "every 5 minutes");
  assert.equal(next("0 * * * *"), iso(new Date(2026, 8, 17, 9, 0, 0)), "hourly");
  assert.equal(next("0 9 * * 1"), iso(new Date(2026, 8, 21, 9, 0, 0)), "Monday 9am");
  assert.equal(next("0 9,17 * * *"), iso(new Date(2026, 8, 17, 9, 0, 0)), "9am and 5pm");
  assert.equal(next("0 0 1 * *"), iso(new Date(2026, 9, 1, 0, 0, 0)), "first of the month");
  // Every example in the UI must actually work — a broken shortcut is worse than none.
  for (const example of CRON_EXAMPLES) {
    assert.equal(typeof parseCronExpression(example.expression), "object", `${example.expression} parses`);
    assert.ok(computeNextRun({ kind: "cron", times: [], expression: example.expression }, from), `${example.expression} has a next run`);
  }
});

test("an impossible expression gives up instead of scanning forever", () => {
  const from = new Date(2026, 0, 1, 0, 0, 0);
  assert.equal(computeNextRun({ kind: "cron", times: [], expression: "0 0 30 2 *" }, from), null, "Feb 30 never happens");
});

test("idle windows understand cross-midnight and reject nonsense", () => {
  const night = normalizeIdleWindow({ start: "22:00", end: "06:00" });
  assert.deepEqual(night, { start: "22:00", end: "06:00" });
  assert.equal(isInsideIdleWindow(23 * 60, night), true);
  assert.equal(isInsideIdleWindow(2 * 60, night), true);
  assert.equal(isInsideIdleWindow(12 * 60, night), false);

  const day = normalizeIdleWindow({ start: "09:00", end: "17:00" });
  assert.equal(isInsideIdleWindow(9 * 60, day), true);
  assert.equal(isInsideIdleWindow(17 * 60, day), false, "the end is exclusive");

  assert.equal(normalizeIdleWindow({ start: "09:00", end: "09:00" }), undefined, "a zero-length window is not a window");
  assert.equal(normalizeIdleWindow({ start: "bogus", end: "17:00" }), undefined);
  assert.equal(isInsideIdleWindow(0, undefined), true, "no window means always allowed");
});

test("a hit outside the window is deferred to the window start, not dropped", () => {
  const from = new Date(2026, 8, 17, 8, 0, 0);
  // 09:00 fires outside a 13:00–18:00 window → deferred to 13:00 the same day.
  assert.equal(
    iso(computeNextRun({ kind: "cron", times: [], expression: "0 9 * * *", idleWindow: { start: "13:00", end: "18:00" } }, from)),
    iso(new Date(2026, 8, 17, 13, 0, 0)),
  );
  // A 22:00 hit with a 02:00–05:00 window belongs to the next morning.
  assert.equal(
    iso(computeNextRun({ kind: "cron", times: [], expression: "0 22 * * *", idleWindow: { start: "02:00", end: "05:00" } }, from)),
    iso(new Date(2026, 8, 18, 2, 0, 0)),
  );
  // Inside the window nothing moves.
  assert.equal(
    iso(computeNextRun({ kind: "cron", times: [], expression: "0 14 * * *", idleWindow: { start: "13:00", end: "18:00" } }, from)),
    iso(new Date(2026, 8, 17, 14, 0, 0)),
  );
});

test("timezones change the wall-clock answer, and DST does not lose the run", () => {
  assert.equal(isKnownTimezone("Asia/Shanghai"), true);
  assert.equal(isKnownTimezone("Mars/Olympus"), false);

  // 09:00 in Shanghai is 01:00 UTC.
  const shanghai = zonedTimeToInstant({ year: 2026, month: 9, day: 18, hour: 9, minute: 0 }, "Asia/Shanghai");
  assert.equal(iso(shanghai), iso(new Date("2026-09-18T01:00:00.000Z")));
  assert.deepEqual(
    { hour: zonedParts(shanghai, "Asia/Shanghai").hour, day: zonedParts(shanghai, "Asia/Shanghai").day },
    { hour: 9, day: 18 },
  );

  // 09:00 in New York on the day DST ends (2026-11-01) still resolves to 09:00 local.
  const newYork = zonedTimeToInstant({ year: 2026, month: 11, day: 1, hour: 9, minute: 0 }, "America/New_York");
  const parts = zonedParts(newYork, "America/New_York");
  assert.deepEqual({ hour: parts.hour, minute: parts.minute }, { hour: 9, minute: 0 });

  // A zoned expression runs at the zone's 9am. (Compare against a zone that is not
  // the host's — this test box is already at +08:00, so Shanghai would be a no-op.)
  const from = new Date("2026-09-17T00:00:00.000Z");
  const newYorkRun = computeNextRun({ kind: "cron", times: [], expression: "0 9 * * *", timezone: "America/New_York" }, from);
  assert.equal(zonedParts(newYorkRun, "America/New_York").hour, 9, "the zone's 9am is what runs");
  const hostRun = computeNextRun({ kind: "cron", times: [], expression: "0 9 * * *" }, from);
  assert.equal(zonedParts(hostRun).hour, 9, "the host expression runs at the host's 9am");
  if (new Date().getTimezoneOffset() !== 240) {
    assert.notEqual(iso(hostRun), iso(newYorkRun), "different zones, different instants");
  }
});
