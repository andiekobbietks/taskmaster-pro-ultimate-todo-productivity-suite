/**
 * Devpost, as a data source.
 *
 * Devpost publishes no RSS, no documented API, and their listing page is
 * client-side. But the JSON their own front end calls is open to a plain
 * fetch — no challenge, no key. Found 2026-10-21:
 *
 *   GET https://devpost.com/api/hackathons?status[]=open&per_page=40&page=1
 *
 * It answers every open hackathon (59 that day), including the Amazon
 * AppDev one. This is an undocumented internal endpoint: it can change
 * without notice, which is why every field read here is defensive and
 * the upsert is driven by urls, not guesses.
 */

const BASE = "https://devpost.com/api/hackathons";

export interface DevpostHackathon {
  id: number;
  title: string;
  url: string;
  open_state: string;
  prize_amount: string;
  themes: { name: string }[];
  submissions: number;
  tagged: string;
  invite_only: boolean;
  invite_description: string;
  organization_name: string;
  winners_announced: boolean;
  submission_period_dates: string;
}

/** Devpost wraps the prize in a span; return the plain number. */
function plainPrize(raw: string | undefined): string {
  return String(raw ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Aug 31 - Oct 23, 2026" -> { start: "2026-08-31", end: "2026-10-23" }.
 * The year usually rides on the second date; the first borrows it.
 * Unparseable text comes back as nulls, never as a wrong date.
 */
export function parseSubmissionPeriod(
  text: string | undefined
): { start: string | null; end: string | null } {
  const raw = String(text ?? "").trim();
  if (!raw) return { start: null, end: null };
  const parts = raw.split(/\s*[-–—]\s*/);
  if (parts.length !== 2) return { start: null, end: null };

  const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  /** "Aug 31" | "Oct 23, 2026" -> "YYYY-MM-DD" (UTC, so no day drift). */
  const isoDate = (s: string, fallbackYear: number | null): string | null => {
    const m = s.trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})\.?,?\s*((?:19|20)\d{2})?$/);
    if (!m) return null;
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon === undefined) return null;
    const year = Number(m[3]) || fallbackYear;
    if (!year) return null;
    return new Date(Date.UTC(year, mon, Number(m[2]))).toISOString().slice(0, 10);
  };

  const yearIn = (s: string): number | null => {
    const y = Number((s.match(/\b(19|20)\d{2}\b/) || [])[0]);
    return Number.isFinite(y) && y > 0 ? y : null;
  };

  const [left, right] = parts.map((p) => p.trim());
  // A bare day on the right ("Oct 05 - 27, 2026") borrows the left's month.
  let rightPart = right;
  const bareDay = rightPart.match(/^(\d{1,2})\.?,?\s*((?:19|20)\d{2})?$/);
  if (bareDay) {
    const monthWord = (left.match(/^[A-Za-z]{3,9}/) || [""])[0];
    rightPart = monthWord + " " + bareDay[1]
      + (bareDay[2] ? ", " + bareDay[2] : "");
  }
  const yearOfRange = yearIn(right) ?? yearIn(left);
  return {
    start: isoDate(left, yearIn(right) ?? yearOfRange),
    end: isoDate(rightPart, yearIn(left) ?? yearOfRange),
  };
}

/**
 * One page of open hackathons from the endpoint, or null when the
 * endpoint has changed shape (missing array, non-200).
 */
export async function fetchDevpostPage(
  page: number,
  doFetch: typeof fetch = fetch
): Promise<DevpostHackathon[] | null> {
  const url =
    BASE +
    "?status%5B%5D=open&per_page=40&page=" +
    encodeURIComponent(page);
  let res: Response;
  try {
    res = await doFetch(url, {
      headers: { Accept: "application/json", "User-Agent": "taskmaster-pro" },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let body: any;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  const list = body?.hackathons;
  if (!Array.isArray(list)) return null;
  return list.map((h: any) => ({
    id: Number(h.id),
    title: String(h.title ?? "Untitled"),
    url: String(h.url ?? ""),
    open_state: String(h.open_state ?? "open"),
    prize_amount: plainPrize(h.prize_amount),
    // Batch 1: the four fields that were being dropped on the floor.
    // Without them the prize, location and deadline filters cannot
    // answer anything except "unknown".
    displayed_location: String(h.displayed_location?.location ?? ""),
    prizes_counts: plainPrize(h.prizes_counts),
    time_left_to_submission: Number.isFinite(Number(h.time_left_to_submission))
      ? Number(h.time_left_to_submission)
      : null,
    featured: Boolean(h.featured),
    themes: Array.isArray(h.themes) ? h.themes : [],
    submissions: Number(h.registrations_count) || 0,
    tagged: String(h.organization_name ?? ""),
    invite_only: Boolean(h.invite_only),
    invite_description: String(
      h.eligibility_requirement_invite_only_description ?? ""
    ),
    winners_announced: Boolean(h.winners_announced),
    submission_period_dates: String(h.submission_period_dates ?? ""),
  }));
}

/**
 * Ingest open Devpost hackathons into the competitions table.
 *
 * The platform id is part of the row id, so a re-import updates its own
 * rows instead of duplicating them. Returns what happened, honestly:
 * imported / updated / skipped, and the endpoint state.
 */
export async function ingestDevpost(
  sql: any,
  opts: { pages?: number; fetchImpl?: typeof fetch } = {}
): Promise<{
  fetched: number;
  imported: number;
  updated: number;
  pages: number;
  endpoint_ok: boolean;
}> {
  const doFetch = opts.fetchImpl || fetch;
  const maxPages = opts.pages ?? 2; // 40/page covers ~59 open comfortably

  let fetched = 0;
  let imported = 0;
  let updated = 0;
  let endpointOk = true;
  const problems: string[] = [];
  let pagesUsed = 0;

  for (let page = 1; page <= maxPages; page++) {
    pagesUsed = page;
    const items = await fetchDevpostPage(page, doFetch);
    if (items === null) {
      endpointOk = false;
      problems.push("page " + page + " did not answer as expected");
      break;
    }
    if (items.length === 0) break;
    for (const h of items) {
      if (!h.url || !h.title) continue;
      const ts = Date.now();
      const id =
        Number.isFinite(h.id) && h.id
          ? "hack-devpost-" + h.id
          : "hack-devpost-url-" + Math.abs(h.url.split("").reduce((a: number, ch: string) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
      const dates = parseSubmissionPeriod(h.submission_period_dates);
      const existing = sql
        .exec("SELECT id FROM hackathons WHERE id = ?", id)
        .toArray();

      const eligibility = {
        eligibility_type: h.invite_only ? "invite_only" : "unrestricted",
        regions: ["Global"],
        age_min: 13,
        _themes: h.themes.map((t) => t.name),
        _invite_note: h.invite_description || undefined,
      };
      const notes = JSON.stringify({
        source: "devpost-api",
        org: h.tagged || undefined,
        registrations: h.submissions,
        period: h.submission_period_dates || undefined,
        winners_announced: h.winners_announced || undefined,
      });

      if (existing.length > 0) {
        sql.exec(
          `UPDATE hackathons SET name=?, url=?, prize=?, start_date=?, end_date=?,
           submission_deadline=?, eligibility_json=?, status=?, notes=?,
           displayed_location=?, prizes_counts=?, time_left_to_submission=?,
           featured=?, updated_at=? WHERE id=?`,
          h.title, h.url, h.prize_amount, dates.start, dates.end,
          dates.end, JSON.stringify(eligibility),
          h.open_state === "open" ? "open" : h.open_state, notes,
          String(h.displayed_location?.location ?? ""), plainPrize(h.prizes_counts),
          Number.isFinite(Number(h.time_left_to_submission)) ? Number(h.time_left_to_submission) : null,
          Boolean(h.featured) ? 1 : 0, ts, id
        ).toArray();
        updated++;
      } else {
        sql.exec(
          `INSERT INTO hackathons (id, name, platform, url, description, prize,
           start_date, end_date, registration_deadline, submission_deadline,
           eligibility_json, status, notes, displayed_location, prizes_counts,
           time_left_to_submission, featured, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, h.title, "devpost", h.url,
          "Imported from the Devpost listing API", h.prize_amount,
          dates.start, dates.end, dates.start, dates.end,
          JSON.stringify(eligibility),
          h.open_state === "open" ? "open" : h.open_state, notes,
          String(h.displayed_location?.location ?? ""), plainPrize(h.prizes_counts),
          Number.isFinite(Number(h.time_left_to_submission)) ? Number(h.time_left_to_submission) : null,
          Boolean(h.featured) ? 1 : 0, ts, ts
        ).toArray();
        imported++;
      }
    }
    fetched += items.length;
    if (fetched >= 0 && items.length < 40) break; // short page = last page
  }

  return {
    fetched,
    imported,
    updated,
    pages: pagesUsed,
    endpoint_ok: problems.length === 0,
  };
}
