// Wall-clock arithmetic in a named IANA zone with nothing but Intl — no date-fns-tz. The one
// place that knows how to turn "2026-10-03 19:00 in America/New_York" into an instant and back;
// ordering-core (menu availability windows in the setting's zone) and reservations-core (slot
// search and labels in the LOCATION's zone, never the visitor's) both import it. No imports of its
// own, so a strip to JS emits none; deploy copies every *-core.ts next to the transports.

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The wall-clock parts of an instant in `timeZone` ("" or an unknown zone → the runtime's zone). */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const hour = Number(get("hour")) % 24; // some engines print "24" for midnight
    return {
      year: Number(get("year")),
      month: Number(get("month")),
      day: Number(get("day")),
      hour,
      minute: Number(get("minute")),
      second: Number(get("second")),
      weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))),
    };
  } catch {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      weekday: date.getDay(),
    };
  }
}

/** "YYYY-MM-DD" of an instant in `timeZone`. */
export function zonedDayKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since midnight of an instant in `timeZone`. */
export function zonedMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * The instant at which the wall clock in `timeZone` reads `dayKey` ("YYYY-MM-DD") `hhmm` ("HH:mm"),
 * as an ISO string. Two offset iterations cover DST edges. Invalid input → "".
 */
export function zonedIso(dayKey: string, hhmm: string, timeZone: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  if (![y, m, d, h, mi].every(Number.isFinite)) return "";
  const target = Date.UTC(y, m - 1, d, h, mi, 0);
  let utc = target;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(utc), timeZone);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    utc = target - (wall - utc);
  }
  return new Date(utc).toISOString();
}

/** A short time label of an instant in `timeZone` in the visitor's language ("7:00 PM"); "" on failure. */
export function zonedTimeLabel(date: Date, timeZone: string, locale?: string): string {
  try {
    return date.toLocaleTimeString(locale || undefined, { hour: "numeric", minute: "2-digit", timeZone: timeZone || undefined });
  } catch {
    try {
      return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  }
}

/** A short date + time label of an instant in `timeZone` ("Fri, Oct 3, 7:00 PM"); "" on failure. */
export function zonedDateTimeLabel(date: Date, timeZone: string, locale?: string): string {
  try {
    return date.toLocaleString(locale || undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || undefined,
    });
  } catch {
    return "";
  }
}
