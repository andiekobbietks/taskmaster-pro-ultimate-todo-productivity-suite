/**
 * Major League Hacking (MLH), as a data source.
 *
 * MLH publishes no documented public API for its season event listings,
 * but the server-rendered season page embeds the data as JSON inside an
 * inline <script> tag:
 *
 *   GET https://mlh.io/seasons/2026/events
 *
 * The 4th <script> block is a JSON object with component:"SeasonEvents/Index"
 * and props.upcomingEvents / props.pastEvents arrays. This is an internal
 * implementation detail: it can change without notice, so every read is
 * defensive and the upsert is driven by stable ids derived from the event
 * UUIDs and URLs.
 */

const BASE = "https://mlh.io/seasons";

export interface MlhEvent {
  id: string;
  slug: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string;
  dateRange: string;
  url: string;
  location: string;
  formatType: "physical" | "digital" | "hybrid" | string;
  backgroundUrl: string;
  logoUrl: string;
  websiteUrl: string | null;
  region: string;
  customFields: {
    underserved_types?: string[];
  };
  venueAddress?: {
    city?: string;
    state?: string;
    country?: string;
  };
}

/** Extract the embedded Inertia/MLH props blob from the season page HTML. */
function extractPropsBlob(html: string): any | null {
  // The JSON lives in a plain <script>...</script> block, not in
  // data-page or __NEXT_DATA__. Pick the first script whose content starts
  // with a JSON object that has a "component" key.
  const matches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
  if (!Array.isArray(matches)) return null;

  for (const block of matches) {
    const content = block
      .replace(/^<script[^>]*>/, "")
      .replace(/<\/script>$/, "")
      .trim();
    if (!content.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(content);
      if (parsed?.component && parsed?.props) return parsed.props;
    } catch {
      // Not the right script; keep looking.
    }
  }
  return null;
}

function isoToDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function eventUrl(event: MlhEvent): string {
  if (event.websiteUrl) return event.websiteUrl;
  if (event.url?.startsWith("http")) return event.url;
  if (event.url) return "https://mlh.io" + event.url;
  return "https://mlh.io/events/" + event.slug;
}

function eventStatus(event: MlhEvent): string {
  const status = String(event.status || "").toLowerCase();
  if (status === "ended" || status === "closed") return "closed";
  if (status === "open") return "open";
  const end = new Date(event.endsAt);
  if (Number.isFinite(end.getTime()) && end.getTime() < Date.now()) return "closed";
  return "open";
}

/**
 * One season page of MLH events, or null when the page has changed shape
 * (missing arrays, non-200, unparseable JSON).
 */
export async function fetchMlhEvents(
  season = "2026",
  doFetch: typeof fetch = fetch
): Promise<MlhEvent[] | null> {
  const url = `${BASE}/${encodeURIComponent(season)}/events`;
  let res: Response;
  try {
    res = await doFetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "taskmaster-pro",
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let html: string;
  try {
    html = await res.text();
  } catch {
    return null;
  }
  if (!html.includes("upcomingEvents") && !html.includes("pastEvents")) return null;

  const props = extractPropsBlob(html);
  if (!props) return null;

  const upcoming = Array.isArray(props.upcomingEvents) ? props.upcomingEvents : [];
  const past = Array.isArray(props.pastEvents) ? props.pastEvents : [];
  const combined = [...upcoming, ...past];
  if (combined.length === 0) return [];

  return combined.map((h: any) => ({
    id: String(h.id || h.slug || ""),
    slug: String(h.slug || ""),
    name: String(h.name || "Untitled"),
    status: String(h.status || ""),
    startsAt: String(h.startsAt || ""),
    endsAt: String(h.endsAt || ""),
    dateRange: String(h.dateRange || ""),
    url: String(h.url || ""),
    location: String(h.location || ""),
    formatType: String(h.formatType || ""),
    backgroundUrl: String(h.backgroundUrl || ""),
    logoUrl: String(h.logoUrl || ""),
    websiteUrl: h.websiteUrl ? String(h.websiteUrl) : null,
    region: String(h.region || "Global"),
    customFields: h.customFields || {},
    venueAddress: h.venueAddress || {},
  }));
}

/**
 * Ingest MLH season events into the competitions table.
 *
 * The platform id is part of the row id, so a re-import updates its own
 * rows instead of duplicating them. Returns what happened, honestly:
 * fetched / imported / updated, and the endpoint state.
 */
export async function ingestMlh(
  sql: any,
  opts: { season?: string; fetchImpl?: typeof fetch } = {}
): Promise<{
  fetched: number;
  imported: number;
  updated: number;
  endpoint_ok: boolean;
  problems: string[];
}> {
  const doFetch = opts.fetchImpl || fetch;
  const season = opts.season || "2026";

  const problems: string[] = [];
  const events = await fetchMlhEvents(season, doFetch);
  if (events === null) {
    problems.push("MLH season page did not answer as expected");
    return { fetched: 0, imported: 0, updated: 0, endpoint_ok: false, problems };
  }

  let imported = 0;
  let updated = 0;
  const ts = Date.now();

  for (const e of events) {
    if (!e.id || !e.name) continue;
    const id = "hack-mlh-" + e.id;
    const url = eventUrl(e);
    const start = isoToDate(e.startsAt);
    const end = isoToDate(e.endsAt);
    const status = eventStatus(e);

    const eligibility = {
      eligibility_type: "unrestricted",
      regions: [e.region || "Global"],
      age_min: 18,
      _format: e.formatType,
      _underserved_types: Array.isArray(e.customFields?.underserved_types)
        ? e.customFields.underserved_types
        : [],
      _venue: e.venueAddress,
    };
    const notes = JSON.stringify({
      source: "mlh-scrape",
      season,
      format: e.formatType,
      region: e.region,
      logo: e.logoUrl || undefined,
    });

    const existing = sql.exec("SELECT id FROM hackathons WHERE id = ?", id).toArray();
    if (existing.length > 0) {
      sql.exec(
        `UPDATE hackathons SET name=?, url=?, start_date=?, end_date=?,
         submission_deadline=?, eligibility_json=?, status=?, notes=?,
         displayed_location=?, updated_at=? WHERE id=?`,
        e.name,
        url,
        start,
        end,
        end,
        JSON.stringify(eligibility),
        status,
        notes,
        e.location,
        ts,
        id
      ).toArray();
      updated++;
    } else {
      sql.exec(
        `INSERT INTO hackathons (id, name, platform, url, description, prize,
         start_date, end_date, registration_deadline, submission_deadline,
         eligibility_json, status, notes, displayed_location, prizes_counts,
         time_left_to_submission, featured, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        e.name,
        "mlh",
        url,
        `Imported from MLH ${season} season`,
        "",
        start,
        end,
        start,
        end,
        JSON.stringify(eligibility),
        status,
        notes,
        e.location,
        "",
        null,
        0,
        ts,
        ts
      ).toArray();
      imported++;
    }
  }

  return {
    fetched: events.length,
    imported,
    updated,
    endpoint_ok: problems.length === 0,
    problems,
  };
}
