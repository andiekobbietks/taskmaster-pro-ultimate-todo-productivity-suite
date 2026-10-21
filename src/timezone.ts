/**
 * Time zones.
 *
 * The app stores dates, not instants: a competition's deadline is a
 * date, and a task's due date is a date. That is right for a deadline —
 * "closes on the 23rd" means the 23rd where the organiser is.
 *
 * But two things need a real clock: the "today" filter, and a digest
 * that lands at 08:00 in the reader's own morning. Both need to know
 * the reader's zone, so the profile carries one (an IANA name, e.g.
 * "Europe/Dublin") and this file does the arithmetic.
 *
 * Everything here uses Intl, which the Workers runtime ships with the
 * full zone database, so there is no table to maintain and no library.
 *
 * The tricky part is daylight saving. Two of the rules below exist only
 * for that: finding the instant whose LOCAL time is 08:00 is not the
 * same as adding 08:00 to UTC, and twice a year the local time either
 * does not happen or happens twice.
 */

/** Is this a time zone this runtime knows? */
export function isValidTimeZone(timeZone: unknown): boolean {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone's offset from UTC, in minutes, at a given instant.
 * Dublin in January is 0; in July it is 60.
 */
export function offsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  // Intl can render midnight as hour 24 in some locales; 24:00 is the
  // end of the day, not the start of the next one.
  const hour = get("hour") % 24;
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

/** The wall clock in a zone at an instant. */
export function localParts(timeZone: string, date: Date): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday),
  };
}

/** The date in a zone, as "YYYY-MM-DD". */
export function localDateString(timeZone: string, date: Date = new Date()): string {
  const p = localParts(timeZone, date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes since local midnight in a zone. */
export function localMinutesOfDay(
  timeZone: string,
  date: Date = new Date()
): number {
  const p = localParts(timeZone, date);
  return p.hour * 60 + p.minute;
}

/**
 * The instant whose LOCAL time in the zone is the given wall clock.
 *
 * This is the one that has to be right twice a year. On a spring-forward
 * day the requested local time may not exist (02:30 never happens), and
 * on a fall-back day it happens twice; the answer here is the first
 * instant that matches, which is what every calendar app does.
 */
export function instantForLocal(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0);
  // One guess, then one correction: the offset at the guessed instant
  // may differ from the offset at the real one.
  let guess = new Date(wallClock - offsetMinutes(timeZone, new Date(wallClock)) * 60000);
  guess = new Date(wallClock - offsetMinutes(timeZone, guess) * 60000);

  // On a fall-back day the requested local time can happen twice. The
  // first one is the answer, so if the wall clock also matches an hour
  // earlier, that earlier instant is it.
  const earlier = new Date(guess.getTime() - 3600000);
  const p = localParts(timeZone, earlier);
  if (
    p.year === year &&
    p.month === month &&
    p.day === day &&
    p.hour === hour &&
    p.minute === minute
  ) {
    guess = earlier;
  }
  return guess;
}

/**
 * How long until a local date, counted in whole days.
 *
 * Both ends are local dates, so the answer is a calendar difference and
 * not a number of hours divided by 24 — which is what makes it correct
 * at 23:00 in Auckland and at 00:30 in Los Angeles.
 *
 * The zone comes first: this function is about a place, and a date
 * without a place is exactly the mistake this one exists to stop.
 */
export function daysUntilInZone(
  timeZone: string,
  dateString: string,
  from: Date = new Date()
): number | null {
  if (!dateString) return null;
  const target = String(dateString).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return null;
  const [y, m, d] = target.split("-").map(Number);
  const today = localParts(timeZone, from);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  const targetUtc = Date.UTC(y, m - 1, d);
  return Math.round((targetUtc - todayUtc) / 86400000);
}

/** A readable zone name and offset, e.g. "Europe/Dublin (UTC+01:00)". */
export function describeZone(timeZone: string, date: Date = new Date()): string {
  if (!isValidTimeZone(timeZone)) return "Unknown time zone";
  const offset = offsetMinutes(timeZone, date);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${timeZone} (UTC${sign}${hours}:${minutes})`;
}
