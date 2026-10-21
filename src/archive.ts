/**
 * Archive integration module — fetch hackathon data from web archives.
 * 
 * Instead of scraping live sites (ToS issues, rate limits, maintenance burden),
 * this module fetches from public web archives like the Wayback Machine.
 * 
 * Design:
 * - Archive sources are configurable via settings API
 * - Each source has a fetch function that returns archived HTML
 * - HTML is parsed for hackathon metadata (deadlines, prizes, rules)
 * - Archived snapshots are stored as attachments (immutable records)
 * - Drift detection: compare archived vs current data
 * 
 * Supported sources:
 * 1. Wayback Machine (web.archive.org) — free, no auth, CDX API
 * 2. archive.today — free, limited API
 * 3. Perma.cc — free tier, API key required
 * 
 */

import { Hono } from "hono";
import { readWacz, findResponse, recordText, MAX_INFLATED_BYTES } from "./wacz.ts";

/**
 * The most a capture may be on the wire.
 *
 * The Durable Object is single-threaded: one large upload stalls every
 * request the app serves. A real capture of a competition page is a few
 * megabytes.
 */
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * The page's own title, cleaned up.
 */
function titleOf(html: string): string {
  const m = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html);
  if (!m) return "";
  return m[1]
    .replace(/\s+/g, " ")
    .replace(/^[^\w(]+|[^\w)]+$/g, "")
    .trim()
    .slice(0, 120);
}

/**
 * The last segment of a URL, with the dashes turned back into spaces.
 */
function slugOf(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const last = path.split("/").pop() || "";
    return last.replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

/**
 * Create a competition from what a capture found.
 *
 * The name is a guess from the URL, because the capture's own title is
 * not always in the extracted fields. It is a placeholder that the
 * person can correct, not a claim.
 */
function createHackathonFromCapture(sql: any, data: any): { id: string } {
  const id = "hack-" + Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2, 8);
  const ts = Date.now();
  const name = titleOf(data.html || "") || slugOf(data.url || "") || "Untitled competition";
  const eligibility = {
    eligibility_type: "unrestricted",
    regions: ["Global"],
    age_min: 13,
  };
  sql.exec(
    `INSERT INTO hackathons (id, name, platform, url, description, prize, start_date, end_date, registration_deadline, submission_deadline, eligibility_json, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 'open', ?, ?, ?)`,
    id, name, data.platform || "devpost",
    data.url || "", "Captured from " + (data.url || ""),
    data.extracted?.prize || "", JSON.stringify(eligibility),
    "Captured from a WACZ archive. " + JSON.stringify(data.extracted || {}),
    ts, ts
  ).toArray();
  return { id };
}

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

/**
 * Pull the useful fields out of a competition page.
 *
 * Three sources, in the order that works best:
 *
 *   1. The structured data. Most competition pages publish JSON-LD with an
 *      Event or a CreativeWork, which carries the name, the dates and
 *      sometimes the description.
 *   2. The visible prose, with patterns loose enough to match how people
 *      actually write: "submissions close", "ends on", "due by".
 *   3. The money, wherever it is next to a word that means prize.
 *
 * The scripts and the styles are removed first. Without that, a pattern
 * for "rules" matches JavaScript - which is how "Rules.length ?
 * d.deleteRule(x)" ended up as an eligibility rule.
 */
function extractHackathonData(html: string): ArchivedPage["extracted"] {
  const result: ArchivedPage["extracted"] = {};

  // 1. The structured data.
  const ld = findJsonLd(html);
  if (ld) {
    const events = Array.isArray(ld) ? ld : [ld];
    for (const node of events) {
      if (!node || typeof node !== "object") continue;
      const type = String(node["@type"] || "").toLowerCase();
      if (type !== "event" && type !== "hackathon" && type !== "contest") continue;
      if (node.name && !result.name) result.name = String(node.name).slice(0, 160);
      if (node.endDate && !result.deadline) {
        result.deadline = String(node.endDate).slice(0, 40);
      }
      if (node.startDate && !result.start_date) {
        result.start_date = String(node.startDate).slice(0, 40);
      }
      if (node.description && !result.eligibility) {
        result.eligibility = String(node.description).replace(/\s+/g, " ").slice(0, 300);
      }
    }
  }

  // The visible text, with the scripts and the styles out of the way.
  const text = stripNoise(html);

  // 2. The deadline.
  if (!result.deadline) {
    const deadlinePatterns = [
      /\b(?:submissions?|entries|projects?|registration|applications?)\s+(?:close[sd]?|ends?|end|deadline|due)\s*(?:on|at|by)?\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i,
      /\b(?:deadline|due|closes|ends|until)\s+(?:on|at|by|is)?\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i,
      /\b([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})[^<]{0,40}\b(?:deadline|closing|closes|submissions? close|ends)\b/i,
      /\b(\d{4}-\d{2}-\d{2})\b/,
    ];
    for (const pat of deadlinePatterns) {
      const m = text.match(pat);
      if (m) { result.deadline = m[1].trim().replace(/\s+/g, " "); break; }
    }
  }

  // 3. The money.
  if (!result.prize) {
    const prizePatterns = [
      /\bprize(?:s)?\b[^$£€]{0,60}\$([\d,]{3,})/i,
      /\$([\d,]{3,})[^<]{0,40}\b(?:prize|in prizes|prize pool|total prize|reward)\b/i,
      /\b(?:prize pool|total prize|prize money)\b[^$£€]{0,40}\$([\d,]{3,})/i,
      /\b(?:USD|EUR|GBP)\s*([\d,]{3,})/i,
    ];
    for (const pat of prizePatterns) {
      const m = text.match(pat);
      if (m) { result.prize = "$" + m[1].trim(); break; }
    }
  }

  // 4. The rules and the format.
  if (!result.eligibility) {
    const m = text.match(/\b(?:eligib\w+|who can (?:enter|participate|join)|open to|open only to)\b[^.]{0,220}/i);
    if (m) result.eligibility = m[0].split(/\s+/).join(" ").slice(0, 300);
  }
  if (!result.submission_format) {
    const m = text.match(/\bsubmission format\b[^.]{0,200}/i);
    if (m) result.submission_format = m[0].split(/\s+/).join(" ").slice(0, 220);
  }

  return result;
}

/**
 * Remove the scripts, the styles and the tags, so a pattern for a word
 * cannot land in the JavaScript.
 */
function stripNoise(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ");
}

/**
 * The JSON-LD blocks a page publishes, parsed.
 */
function findJsonLd(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed && parsed["@graph"]) out.push(...parsed["@graph"]);
      else out.push(parsed);
    } catch {
      // A malformed block is skipped.
    }
  }
  return out;
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
  // --- Ingest a WACZ archive ---------------------------------------------
  //
  // A WACZ is a zip of the raw HTTP transactions for a capture. It is
  // posted here, read, and the same extraction runs over the captured
  // HTML as the Wayback route uses. The difference is that the WACZ holds
  // the network traffic, not just the rendered page.
  app.post("/api/archive/wacz", async (c) => {
    let bytes: Uint8Array | null = null;
    let targetUrl = "";

    const contentType = c.req.header("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("file");
      targetUrl = String(form.get("url") || "");
      if (file instanceof File) {
        if (file.size > MAX_UPLOAD_BYTES) {
          return c.json({ error: "The capture is larger than " + MAX_UPLOAD_BYTES + " bytes" }, 413);
        }
        bytes = new Uint8Array(await file.arrayBuffer());
      }
    } else {
      // The raw file, with the URL in a header.
      targetUrl = c.req.header("x-target-url") || "";
      const declared = parseInt(c.req.header("content-length") || "0", 10);
      if (declared > MAX_UPLOAD_BYTES) {
        return c.json({ error: "The capture is larger than " + MAX_UPLOAD_BYTES + " bytes" }, 413);
      }
      bytes = new Uint8Array(await c.req.arrayBuffer());
    }

    if (!bytes || bytes.length === 0) {
      return c.json({ error: "No WACZ file was sent" }, 400);
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      return c.json({ error: "The capture is larger than " + MAX_UPLOAD_BYTES + " bytes" }, 413);
    }

    let archive;
    try {
      archive = await readWacz(bytes);
    } catch (err: any) {
      return c.json({ error: "Could not read the WACZ: " + (err?.message || "unknown") }, 400);
    }

    if (archive.pages.length === 0 && archive.records.length === 0) {
      return c.json({ error: "The WACZ has no pages and no records in it" }, 400);
    }

    // Work out which page was wanted. The URL in the request wins; if it
    // was not given, the first page in the capture is the one.
    const wanted = targetUrl || archive.pages[0]?.url || "";
    const record = wanted ? findResponse(archive.records, wanted) : archive.records[0];

    if (!record) {
      return c.json({
        error: "No response for " + wanted + " in the WACZ",
        captured: archive.pages.map((p) => p.url).slice(0, 20),
      }, 404);
    }

    const html = recordText(record);
    const extracted = extractHackathonData(html);

    // A capture that was queued as a job closes the job, and the
    // competition it found is created. That is the whole loop: capture,
    // post, and the app knows about the competition.
    const jobId = c.req.header("x-job-id") || "";
    let hackathonId = "";
    if (jobId) {
      const extractedName = (targetUrl || record.url || "").split("/").pop() || "";
      const created = createHackathonFromCapture(sql, {
        url: record.url || targetUrl,
        name: extractedName,
        extracted,
        platform: "devpost",
      });
      hackathonId = created.id;

      sql.exec(
        "UPDATE capture_jobs SET status = 'done', wacz_size = ?, extracted_json = ?, error = '', updated_at = ? WHERE id = ?",
        bytes.length, JSON.stringify(extracted), Date.now(), jobId
      ).toArray();
    }

    return c.json({
      job_id: jobId || null,
      hackathon_id: hackathonId || null,
      ok: true,
      url: record.url || wanted,
      source: "wacz",
      pages_captured: archive.pages.length,
      records: archive.records.length,
      extracted,
      // The raw HTML, so the caller can compile it rather than only read
      // the fields.
      html: html.slice(0, 2_000_000),
    });
  });

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
    ).toArray();

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
      ).toArray();
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
