/**
 * fork:cron — timezone helpers (pure, no dependency).
 *
 * Cron fields are matched against **local wall-clock time in the task's zone**, so
 * the same `0 9 * * 1` means 09:00 where the user lives, not 09:00 UTC. Node gives us
 * the zone database through `Intl`, so this is a matter of two conversions:
 *
 *   zonedParts(instant, tz)        instant -> wall clock in tz
 *   zonedTimeToInstant(tz, parts)  wall clock in tz -> instant
 *
 * The reverse direction needs the zone offset, and the offset is a function of the
 * instant we are trying to find — so it is solved the standard way: guess with the
 * naive UTC value, read the offset there, correct, and repeat once. That is exact for
 * every zone except the hour that a DST jump skips (where the requested wall time
 * does not exist); that case lands on the instant after the jump, which is what a
 * scheduler should do anyway.
 */

export const HOST_TIMEZONE = "host";

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday, in the target zone. */
  weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Is this a zone name the runtime can actually resolve? */
export function isKnownTimezone(timeZone: string): boolean {
  if (timeZone === HOST_TIMEZONE) return true;
  try {
    formatterFor(timeZone).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(timeZone: string | undefined): string | undefined {
  if (!timeZone || timeZone === HOST_TIMEZONE) return undefined;
  return isKnownTimezone(timeZone) ? timeZone : undefined;
}

/** Wall-clock parts of an instant in a zone (host zone when `timeZone` is undefined). */
export function zonedParts(instant: Date, timeZone?: string): ZonedParts {
  if (!timeZone) {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
      hour: instant.getHours(),
      minute: instant.getMinutes(),
      weekday: instant.getDay(),
    };
  }
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "0";
  const weekday = WEEKDAYS.indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Intl renders midnight as 24 in some engines with hour12:false.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

/** Offset of a zone at an instant, in minutes east of UTC. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  // Drop seconds so the two sides are comparable to the minute.
  const floored = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - floored) / 60_000);
}

/** Instant for a wall-clock time in a zone (see the DST note in the file header). */
export function zonedTimeToInstant(parts: Omit<ZonedParts, "weekday">, timeZone?: string): Date {
  if (!timeZone) return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let instant = new Date(naive);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = offsetMinutes(instant, timeZone);
    const corrected = new Date(naive - offset * 60_000);
    if (corrected.getTime() === instant.getTime()) break;
    instant = corrected;
  }
  return instant;
}

/** Local parts of an instant, shifted by whole days in the zone (day scanning). */
export function addZonedDays(parts: Omit<ZonedParts, "weekday">, days: number): Omit<ZonedParts, "weekday"> {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}
