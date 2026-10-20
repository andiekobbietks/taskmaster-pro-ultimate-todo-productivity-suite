/**
 * Archive integration module — fetch hackathon data from web archives.

Instead of scraping live sites (ToS issues, rate limits, maintenance burden),
this module fetches from public web archives like the Wayback Machine.

Design:
- Archive sources are configurable via settings API
- Each source has a fetch function that returns archived HTML
- HTML is parsed for hackathon metadata (deadlines, prizes, rules)
- Archived snapshots are stored as attachments (immutable records)
- Drift detection: compare archived vs current data

Supported sources:
  1. Wayback Machine (web.archive.org) — free, no auth, CDX API
  2. archive.today — free, limited API
  3. Perma.cc — free tier, API key required
"""
import { Hono } from "hono";

export interface ArchiveSource {
  id: string;
  name: string;
  type: "wayback" | "archive-today" | "perma-cc";
  api_key?: string;
  enabled: boolean;
  base_url: string;
}

export interface ArchivedPage {
  url: string;
  snapshot_url: string;
  timestamp: string;
  html: string;
  extracted: {
    deadline?: string;
    prize?: string;
    rules?: string;
    eligibility?: string;
    submission_format?: string;
  };
}

// ── Wayback Machine adapter ──────────────────────────────────────────

async function waybackLatestSnapshot(url: string): Promise<{ snapshot_url: string; timestamp: string } | null> {
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=1&filter=statuscode:200&sort=reverse&from=20240101`;
  try {
    const resp = await fetch(cdxUrl, { headers: { "User-Agent": "TaskMaster-Pro-Archive-Fetcher/1.0" } });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || data.length < 2) return null;
    const row = data[1];
    // CDX format: urlkey, timestamp, original, mimetype, statuscode, digest, length
    const timestamp = row[1];
    const original = row[2];
    return {
      snapshot_url: `https://web.archive.org/web/${timestamp}/${original}`,
      timestamp: timestamp,
    };
  } catch {
    return null;
  }
}

async function waybackFetchSnapshot(snapshotUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(snapshotUrl, {
      headers: { "User-Agent": "TaskMaster-Pro-Archive-Fetcher/1.0" },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

// ── HTML parser for hackathon data ───────────────────────────────────

function extractHackathonData(html: string): ArchivedPage["extracted"] {
  const result: ArchivedPage["extracted"] = {};

  // Extract deadline patterns
  const deadlinePatterns = [
    /deadline[:\s]*([A-Za-z]+ \d{1,2},? \d{4})/i,
    /submit by[:\s]*([A-Za-z]+ \d{1,2},? \d{4})/i,
    /submission deadline[:\s]*([A-Za-z]+ \d{1,2},? \d{4})/i,
    /due[:\s]*([A-Za-z]+ \d{1,2},? \d{4})/i,
  ];
  for (const pat of deadlinePatterns) {
    const m = html.match(pat);
    if (m) { result.deadline = m[1].trim(); break; }
  }

  // Extract prize patterns
  const prizePatterns = [
    /prize[:\s]*\$([\d,]+)/i,
    /\$([\d,]+)\s*(in prizes|prize pool|total prize)/i,
    /prize pool[:\s]*\$([\d,]+)/i,
  ];
  for (const pat of prizePatterns) {
    const m = html.match(pat);
    if (m) { result.prize = "$" + m[1].trim(); break; }
  }

  // Extract eligibility/rules snippets
  const rulesMatch = html.match(/eligibility[^<]{0,200}/i);
  if (rulesMatch) result.eligibility = rulesMatch[0].trim();

  const rulesSection = html.match(/rules[^<]{0,300}/i);
  if (rulesSection) result.rules = rulesSection[0].trim();

  const formatMatch = html.match(/submission format[^<]{0,200}/i);
  if (formatMatch) result.submission_format = formatMatch[0].trim();

  return result;
}

// ── Route registration ───────────────────────────────────────────────

/**
 * Register all archive-related API routes on the Hono app.
 *
 * Routes:
 * - GET /api/archive/sources — List configured archive sources
 * - POST /api/archive/sources — Add an archive source
 * - DELETE /api/archive/sources/:id — Remove an archive source
 * - POST /api/archive/fetch — Fetch an archived page for a URL
 * - POST /api/archive/bulk — Bulk fetch for multiple URLs
 * - GET /api/archive/check — Check if a URL has archived snapshots
 *
 * @param app - Hono application instance
 * @param sql - SQLite storage interface from Durable Object
 */
export function registerArchiveRoutes(app: Hono, sql: any) {
  // --- List archive sources -------------------------------------------

  app.get("/api/archive/sources", (c) => {
    const rows = sql
      .exec("SELECT * FROM archive_sources ORDER BY name")
      .toArray();
    return c.json(rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      enabled: Boolean(r.enabled),
      base_url: r.base_url,
    })));
  });

  // --- Add archive source ---------------------------------------------

  app.post("/api/archive/sources", async (c) => {
    const data = await c.req.json();
    const { name, type, api_key, base_url } = data;

    if (!name || !type) {
      return c.json({ error: "Name and type are required" }, 400);
    }

    const id = `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    sql.exec(
      `INSERT INTO archive_sources (id, name, type, api_key, enabled, base_url, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      id, name, type, api_key || null, base_url || "", Date.now()
    );

    return c.json({ id, name, type, enabled: true, base_url: base_url || "" }, 201);
  });

  // --- Remove archive source -------------------------------------------

  app.delete("/api/archive/sources/:id", (c) => {
    const id = c.req.param("id");
    const before = sql.exec("SELECT id FROM archive_sources WHERE id = ?", id).toArray();
    if (before.length === 0) return c.json({ error: "Source not found" }, 404);
    sql.exec("DELETE FROM archive_sources WHERE id = ?", id);
    return c.json({ success: true });
  });

  // --- Fetch archived page for a URL -----------------------------------

  app.post("/api/archive/fetch", async (c) => {
    const data = await c.req.json();
    const { url, source_type = "wayback" } = data;

    if (!url) return c.json({ error: "URL is required" }, 400);

    let snapshot: { snapshot_url: string; timestamp: string } | null = null;
    let html: string | null = null;

    if (source_type === "wayback") {
      snapshot = await waybackLatestSnapshot(url);
      if (snapshot) {
        html = await waybackFetchSnapshot(snapshot.snapshot_url);
      }
    }

    if (!snapshot || !html) {
      return c.json({ error: "No archived snapshot found for this URL" }, 404);
    }

    const extracted = extractHackathonData(html);

    // Store the snapshot as an attachment if ticket_id provided
    const ticketId = data.ticket_id;
    if (ticketId) {
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const encoder = new TextEncoder();
      const blob = encoder.encode(html);
      sql.exec(
        `INSERT INTO attachments (id, ticket_id, filename, mime_type, data, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id, ticketId, `archive-${snapshot.timestamp}.html`, "text/html", blob, blob.length, Date.now()
      );
    }

    return c.json({
      url,
      snapshot_url: snapshot.snapshot_url,
      timestamp: snapshot.timestamp,
      extracted,
      html_length: html.length,
    });
  });

  // --- Check if a URL has archived snapshots ---------------------------

  app.get("/api/archive/check", async (c) => {
    const url = c.req.query("url");
    if (!url) return c.json({ error: "URL parameter required" }, 400);

    const snapshot = await waybackLatestSnapshot(url);
    if (!snapshot) {
      return c.json({ archived: false, url });
    }

    return c.json({
      archived: true,
      url,
      snapshot_url: snapshot.snapshot_url,
      timestamp: snapshot.timestamp,
    });
  });

  // --- Bulk fetch for multiple URLs ------------------------------------

  app.post("/api/archive/bulk", async (c) => {
    const data = await c.req.json();
    const urls: string[] = data.urls || [];
    const results: any[] = [];

    for (const url of urls) {
      const snapshot = await waybackLatestSnapshot(url);
      if (snapshot) {
        const html = await waybackFetchSnapshot(snapshot.snapshot_url);
        const extracted = html ? extractHackathonData(html) : {};
        results.push({
          url,
          archived: true,
          snapshot_url: snapshot.snapshot_url,
          timestamp: snapshot.timestamp,
          extracted,
        });
      } else {
        results.push({ url, archived: false });
      }
    }

    return c.json(results);
  });
}
