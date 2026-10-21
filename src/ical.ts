/**
 * iCal generator for the TaskMaster Pro hackathon calendar.
 *
 * Produces RFC 5545 iCal 2.0 content from the competitions table.
 * No external deps — plain string construction, committed to the repo.
 *
 * Usage: serve the returned `text/calendar` body from an endpoint.
 * Calendars (Google, Outlook, Apple) subscribe to the URL and refresh
 * automatically; no API key, no auth, just a stable HTTP endpoint.
 *
 * The uid is deterministic per competition so subscribers never get
 * duplicate events on a re-import.
 */

export interface ICalEvent {
  uid: string;
  dtstart: string; // "YYYYMMDD" or "YYYYMMDDTHHMMSS"
  dtend: string;   // same format
  summary: string;
  description: string;
  url: string;
}

/** A UTC timestamp in the iCal form: 20261021T165233Z. */
function dtstamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Build the full iCal document from an array of ICalEvent. */
export function icalDocument(events: ICalEvent[]): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//TaskMaster Pro//Hackathon Calendar//EN");
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${dtstamp()}`);
    lines.push(`DTSTART:${e.dtstart}`);
    lines.push(`DTEND:${e.dtend}`);
    lines.push(`SUMMARY:${e.summary}`);
    // iCal DESCRIPTION may contain newlines; escape as needed
    const desc = e.description.replace(/\n/g, "\\n");
    lines.push(`DESCRIPTION:${desc}`);
    lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** Render one competition row from the hackathons table into an ICalEvent. */
export function hackathonToIcal(
  r: any,
  platformName: string
): ICalEvent | null {
  if (!r) return null;
  // The row ids already start with "hack-", so the uid is the id itself.
  // Prefixing again produced "hack-hack-devpost-31617".
  const uid = String(r.id).startsWith("hack-") ? String(r.id) : "hack-" + r.id;
  const title = String(r.name || "Untitled hackathon");
  // Prize may have markup; keep plain
  const prize = String(r.prize || "").replace(/<[^>]*>/g, "").trim();
  // Build description: platform + eligibility + prize note
  const rules = (r.eligibility_json ? JSON.parse(r.eligibility_json) : {});
  const eligibilityNote =
    rules.eligibility_type === "invite_only"
      ? "Invite-only: see qualification_path"
      : "Unrestricted";
  const bits: string[] = [platformName, prize || "", eligibilityNote].filter(Boolean);
  const description = bits.join(" · ");
  // The event covers the competition: it starts when the competition
  // starts and ends when submissions close. (Starting it at the
  // deadline was wrong: the event said "Oct 15" to "Oct 15".)
  const rawStart = r.start_date || r.registration_deadline || r.submission_deadline || r.end_date;
  const rawEnd = r.end_date || r.submission_deadline || r.start_date;
  let startDate: string | null = null;
  let endDate: string | null = null;

  if (rawStart) {
    startDate = normalizeDate(rawStart);
  }
  if (rawEnd) {
    endDate = normalizeDate(rawEnd);
  }
  // If we have no date fields at all, default to created_at
  if (!startDate && !endDate && r.created_at) {
    const d = new Date(r.created_at);
    startDate = d.toISOString().slice(0, 8);
    endDate = startDate; // same day if unknown
  }
  // Absolute fallback
  if (!startDate) startDate = "20250101";
  if (!endDate) endDate = "20251231";

  return {
    uid,
    dtstart: startDate,
    dtend: endDate,
    summary: title,
    description,
    url: String(r.url || ""),
  };
}

/** Normalize a date string to iCal format.
 * Accepts: "2026-08-31", "Aug 31 - Oct 23, 2026", "2026-08-31T14:30:00Z",
 *          epoch-ms, or any Date.parse-able string.
 * Returns: "YYYYMMDD" (date-only) for all cases.
 */
function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // Epoch milliseconds
  const ms = Number(s);
  if (!isNaN(ms)) {
    return new Date(ms).toISOString().slice(0, 8);
  }
  // Already ISO date-only
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s.replace(/-/g, "");
  }
  // ISO datetime with time
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return new Date(s).toISOString().slice(0, 8);
  }
  // Human range like "Aug 31 - Oct 23, 2026" — start only
  const range = s.split(/\s*[-–—]\s*/);
  if (range.length === 2) {
    const start = normalizeDate(range[0]);
    return start; // return start only; DTEND can be same or inferred
  }
  // Single human date like "Aug 31, 2026"
  const m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})/i);
  if (m) {
    const MONTHS: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon !== undefined) {
      return new Date(
        Number(m[3]),
        mon,
        Number(m[2])
      ).toISOString().slice(0, 8);
    }
  }
  // Last resort: try Date.parse then slice
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 8);
}

/** Pull all open competitions from the DB and render iCal events. */
export async function getICalEvents(sql: any): Promise<string> {
  const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open' ORDER BY created_at DESC").toArray();
  const platformName = "TaskMaster Pro";
  const events: ICalEvent[] = [];
  for (const r of rows) {
    const e = hackathonToIcal(r, platformName);
    if (e) events.push(e);
  }
  return icalDocument(events);
}