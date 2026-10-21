/**
 * time.js — the reader's own clock.
 *
 * The app's dates are dates, not instants: a task is due on the 21st,
 * and a competition closes on the 23rd. "Today" therefore has to mean
 * the reader's today, not the server's. The browser knows the reader's
 * zone, so these helpers use the browser's own clock rather than UTC.
 *
 * This is the client half of src/timezone.ts, which does the same
 * arithmetic on the server.
 */

/** "YYYY-MM-DD" in the reader's own time zone. */
export function todayLocal(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Whole days from today until a date, counted in calendar days.
 *
 * `new Date("2026-10-23")` is midnight UTC, which is the previous
 * evening for anyone west of Greenwich. Comparing that with the local
 * clock is how a deadline ends up "tomorrow" when it is today. Both
 * sides are turned into local calendar days first.
 */
export function daysUntilLocal(dateString, now = new Date()) {
  if (!dateString) return null;
  const target = String(dateString).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return null;
  const [y, m, d] = target.split("-").map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = new Date(y, m - 1, d);
  return Math.round((targetDate - today) / 86400000);
}

/** The reader's time zone, as an IANA name. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** The reader's zone, with its current offset, e.g. "Europe/Dublin (UTC+01:00)". */
export function describeBrowserZone(now = new Date()) {
  const zone = browserTimeZone();
  if (!zone) return "";
  try {
    const offset = -now.getTimezoneOffset();
    const sign = offset < 0 ? "-" : "+";
    const abs = Math.abs(offset);
    const hours = String(Math.floor(abs / 60)).padStart(2, "0");
    const minutes = String(abs % 60).padStart(2, "0");
    return `${zone} (UTC${sign}${hours}:${minutes})`;
  } catch {
    return zone;
  }
}
