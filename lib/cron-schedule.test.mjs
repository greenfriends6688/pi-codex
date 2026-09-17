import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  CRON_MISSED_WINDOW_MS,
  computeNextRun,
  cronDueState,
  describeCronSchedule,
  normalizeCronTimes,
  normalizeWeekdays,
  parseCronTime,
} = await jiti.import("@/lib/cron-schedule");

const at = (iso) => new Date(iso);
const iso = (date) => (date ? date.toISOString() : null);

test("times parse strictly and invalid entries are dropped", () => {
  assert.equal(parseCronTime("09:30"), 570);
  assert.equal(parseCronTime(" 00:00 "), 0);
  assert.equal(parseCronTime("23:59"), 1439);
  assert.equal(parseCronTime("24:00"), null);
  assert.equal(parseCronTime("9:30"), null, "must be zero-padded — no guessing at intent");
  assert.equal(parseCronTime("09:60"), null);
  assert.equal(parseCronTime("noon"), null);
  assert.deepEqual(normalizeCronTimes(["18:00", "09:00", "09:00", "bogus"]), [540, 1080]);
  assert.deepEqual(normalizeWeekdays([3, 1, 1, 9, -1]), [1, 3]);
});

test("daily picks the next time, rolling to tomorrow", () => {
  const schedule = { kind: "daily", times: ["09:00", "18:30"] };
  assert.equal(iso(computeNextRun(schedule, at("2026-09-17T08:00:00"))), iso(at("2026-09-17T09:00:00")));
  assert.equal(iso(computeNextRun(schedule, at("2026-09-17T09:00:00"))), iso(at("2026-09-17T18:30:00")), "the occurrence itself is exclusive");
  assert.equal(iso(computeNextRun(schedule, at("2026-09-17T20:00:00"))), iso(at("2026-09-18T09:00:00")));
});

test("weekly skips to the next selected day", () => {
  // 2026-09-17 is a Thursday (4).
  const schedule = { kind: "weekly", times: ["09:00"], weekdays: [1, 3] };
  assert.equal(iso(computeNextRun(schedule, at("2026-09-17T10:00:00"))), iso(at("2026-09-21T09:00:00")), "Monday next");
  assert.equal(iso(computeNextRun(schedule, at("2026-09-21T08:00:00"))), iso(at("2026-09-21T09:00:00")));
  assert.equal(iso(computeNextRun(schedule, at("2026-09-23T09:00:00"))), iso(at("2026-09-28T09:00:00")), "past Wednesday rolls a week");
});

test("once never fires twice and rejects a past date", () => {
  const schedule = { kind: "once", times: ["07:15"], date: "2026-09-20" };
  assert.equal(iso(computeNextRun(schedule, at("2026-09-17T00:00:00"))), iso(at("2026-09-20T07:15:00")));
  assert.equal(computeNextRun(schedule, at("2026-09-20T07:15:00")), null);
  assert.equal(computeNextRun({ kind: "once", times: ["07:15"], date: "2026-02-31" }, at("2026-01-01T00:00:00")), null, "rollover dates are not real dates");
});

test("an impossible schedule reports no next run instead of looping", () => {
  assert.equal(computeNextRun({ kind: "daily", times: [] }, at("2026-09-17T08:00:00")), null);
  assert.equal(computeNextRun({ kind: "weekly", times: ["09:00"], weekdays: [] }, at("2026-09-17T08:00:00")), null);
});

test("due state fires inside the tolerance window and skips an old occurrence", () => {
  const schedule = { kind: "daily", times: ["09:00"] };
  const anchor = at("2026-09-16T09:00:00");

  const waiting = cronDueState(schedule, anchor, at("2026-09-17T08:59:00"));
  assert.equal(waiting.due, false);
  assert.equal(iso(waiting.nextRunAt), iso(at("2026-09-17T09:00:00")));

  const onTime = cronDueState(schedule, anchor, at("2026-09-17T09:00:30"));
  assert.equal(onTime.due, true);

  const late = cronDueState(schedule, anchor, at("2026-09-17T09:00:00" + ""));
  assert.equal(late.due, true, "exactly at the occurrence counts as due");

  const missed = cronDueState(schedule, anchor, new Date(at("2026-09-17T09:00:00").getTime() + CRON_MISSED_WINDOW_MS + 1));
  assert.equal(missed.due, false, "a run missed while the server was down is not replayed");
  assert.equal(missed.missed, true);
  assert.equal(iso(missed.nextRunAt), iso(at("2026-09-18T09:00:00")));
});

test("a description exists for every kind", () => {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  assert.equal(describeCronSchedule({ kind: "daily", times: ["09:00"] }, names), "daily 09:00");
  assert.equal(describeCronSchedule({ kind: "weekly", times: ["09:00"], weekdays: [1, 5] }, names), "Mon/Fri 09:00");
  assert.equal(describeCronSchedule({ kind: "once", times: ["07:15"], date: "2026-09-20" }, names), "2026-09-20 07:15");
  assert.equal(describeCronSchedule({ kind: "daily", times: [] }, names), "—");
});
