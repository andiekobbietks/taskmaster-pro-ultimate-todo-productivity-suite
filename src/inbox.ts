/**
 * Inbox module — receive and manage parsed emails from Cloudflare Email Worker.
 *
 * Design notes:
 * - Emails are parsed by the Email Worker (postal-mime) and POSTed here
 * - Stored in SQLite (Durable Object) with sender, subject, body, attachments metadata
 * - Linked to hackathon tickets via ticket_id (auto-matched by sender domain)
 * - No raw email storage — only extracted metadata (data minimisation per GDPR)
 * - Supports mark-as-read, mark-as-processed, and delete
 *
 * Dependencies:
 * - postal-mime (MIT license) — used in the Email Worker, not here
 * - No external dependencies in this module
 */
import { Hono } from "hono";

// ── Types ────────────────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  sender: string;
  subject: string;
  received_at: number;
  body_preview: string;
  body_html: string;
  has_attachments: boolean;
  attachment_names: string[];
  is_platform: boolean;
  platform: string | null;
  ticket_id: string | null;
  match_confidence: number;
  match_method: string;
  read: boolean;
  processed: boolean;
  created_at: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function now(): number { return Date.now(); }

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function rowToInboxItem(r: any): InboxItem {
  return {
    id: r.id,
    sender: r.sender,
    subject: r.subject,
    received_at: r.received_at,
    body_preview: r.body_preview,
    body_html: r.body_html,
    has_attachments: Boolean(r.has_attachments),
    attachment_names: parseJson(r.attachment_names, []),
    is_platform: Boolean(r.is_platform),
    platform: r.platform,
    ticket_id: r.ticket_id,
    match_confidence: r.match_confidence ?? 0,
    match_method: r.match_method || "none",
    read: Boolean(r.read),
    processed: Boolean(r.processed),
    created_at: r.created_at,
  };
}

// ── Platform detection ───────────────────────────────────────────────

const PLATFORM_DOMAINS: Record<string, string> = {
  "devpost.com": "devpost",
  "devpost.org": "devpost",
  "mlh.io": "mlh",
  "mlh.com": "mlh",
  "kaggle.com": "kaggle",
  "lablab.ai": "lablab",
  "ethglobal.com": "ethglobal",
  "devfolio.co": "devfolio",
  "unstop.com": "unstop",
  "hackerrank.com": "hackerrank",
  "hackerearth.com": "hackerearth",
};

function detectPlatform(sender: string): string | null {
  const domain = sender.toLowerCase().split("@")[1] || "";
  for (const [d, platform] of Object.entries(PLATFORM_DOMAINS)) {
    if (domain.includes(d)) return platform;
  }
  return null;
}

/**
 * Normalise a string for fuzzy comparison: lowercase, strip punctuation,
 * collapse whitespace. Used to compare an email subject against a hackathon
 * name without being defeated by "Amazon Developer Hackathon" vs
 * "Amazon - Developer Hackathon".
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words that appear in nearly every competition name and therefore carry no
 * discriminating power. Excluded when scoring.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "for", "to", "in", "on", "at", "by",
  "hackathon", "competition", "challenge", "contest", "x", "with", "2026", "2025",
]);

/**
 * Score how well an email subject matches a hackathon name.
 *
 * Returns 0-1. A match needs at least one non-stop word from the hackathon
 * name to appear in the subject, plus a bonus for matching a longer run of
 * words. This is deliberately simple and predictable: it puts the email on the
 * right ticket without needing an embedding model.
 */
function matchScore(subject: string, hackathonName: string): number {
  const s = normalise(subject);
  const h = normalise(hackathonName);
  if (!s || !h) return 0;

  const subjectWords = new Set(s.split(" ").filter((w) => w.length > 2));
  const nameWords = h.split(" ").filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (nameWords.length === 0) return 0;

  const hits = nameWords.filter((w) => subjectWords.has(w));
  if (hits.length === 0) return 0;

  // Base: fraction of the name's meaningful words that appear in the subject.
  let score = hits.length / nameWords.length;

  // Bonus: the hackathon name appears in the subject as a contiguous run.
  if (h.length > 6 && s.includes(h)) score += 0.5;

  return Math.min(1, score);
}

/**
 * Find the hackathon ticket an email most likely belongs to.
 *
 * Tries content matching first (subject against hackathon name), because two
 * competitions on the same platform are otherwise indistinguishable. Falls
 * back to the platform only when nothing matches by name, and reports how
 * confident the match is.
 */
function findTicket(
  sql: any,
  platform: string | null,
  subject: string,
  bodyPreview: string
): { ticketId: string | null; confidence: number; method: string } {
  const rows = sql
    .exec("SELECT id, name, platform FROM hackathons")
    .toArray();

  let best: { id: string; score: number } | null = null;

  for (const row of rows) {
    const score = matchScore(subject, row.name);
    if (!best || score > best.score) best = { id: row.id, score };
  }

  if (best && best.score >= 0.5) {
    return { ticketId: best.id, confidence: best.score, method: "content" };
  }

  // Content matching failed. Fall back to the platform, but only if it is
  // unambiguous — one hackathon on that platform, so the match is safe.
  if (platform) {
    const samePlatform = rows.filter((r: any) => r.platform === platform);
    if (samePlatform.length === 1) {
      return { ticketId: samePlatform[0].id, confidence: 0.4, method: "platform-unique" };
    }
    if (samePlatform.length > 1) {
      // Ambiguous. Leave it unlinked rather than attach to the wrong ticket.
      return { ticketId: null, confidence: 0, method: "ambiguous" };
    }
  }

  return { ticketId: null, confidence: 0, method: "none" };
}

// ── Route registration ───────────────────────────────────────────────

export function registerInboxRoutes(app: Hono, sql: any) {
  // --- Receive email (from Cloudflare Email Worker) -------------------

  app.post("/api/inbox", async (c) => {
    const data = await c.req.json();
    const {
      sender = "",
      subject = "",
      received_at = Date.now(),
      body_text = "",
      body_html = "",
      has_attachments = false,
      attachment_names = [],
      is_platform = false,
    } = data;

    if (!sender || !subject) {
      return c.json({ error: "Sender and subject are required" }, 400);
    }

    const platform = detectPlatform(sender);
    const id = `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = now();

    // Match to an existing hackathon ticket by content first, so two
    // competitions on the same platform stay distinguishable.
    const match = findTicket(sql, platform, subject, body_text.slice(0, 500));
    const ticketId = match.ticketId;

    sql.exec(
      `INSERT INTO inbox (id, sender, subject, received_at, body_preview, body_html, has_attachments, attachment_names, is_platform, platform, ticket_id, read, processed, created_at, match_confidence, match_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      id, sender, subject, received_at,
      body_text.slice(0, 500), body_html,
      has_attachments ? 1 : 0,
      JSON.stringify(attachment_names),
      is_platform || platform !== null ? 1 : 0,
      platform, ticketId, ts,
      Math.round(match.confidence * 100) / 100, match.method
    );

    const row = sql.exec("SELECT * FROM inbox WHERE id = ?", id).toArray();
    if (row.length === 0) return c.json({ error: "Failed to create inbox item" }, 500);
    return c.json(rowToInboxItem(row[0]), 201);
  });

  // --- List inbox items ----------------------------------------------

  app.get("/api/inbox", (c) => {
    const unread = c.req.query("unread");
    const platform = c.req.query("platform");
    const processed = c.req.query("processed");

    let query = "SELECT * FROM inbox WHERE 1=1";
    const params: any[] = [];

    if (unread === "true") {
      query += " AND read = 0";
    }
    if (platform) {
      query += " AND platform = ?";
      params.push(platform);
    }
    if (processed === "true") {
      query += " AND processed = 1";
    } else if (processed === "false") {
      query += " AND processed = 0";
    }

    query += " ORDER BY received_at DESC";
    const rows = sql.exec(query, ...params).toArray();
    return c.json(rows.map(rowToInboxItem));
  });

  // --- Get single inbox item -----------------------------------------

  app.get("/api/inbox/:id", (c) => {
    const rows = sql.exec("SELECT * FROM inbox WHERE id = ?", c.req.param("id")).toArray();
    if (rows.length === 0) return c.json({ error: "Inbox item not found" }, 404);
    return c.json(rowToInboxItem(rows[0]));
  });

  // --- Mark as read ---------------------------------------------------

  app.patch("/api/inbox/:id", async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();

    const rows = sql.exec("SELECT * FROM inbox WHERE id = ?", id).toArray();
    if (rows.length === 0) return c.json({ error: "Inbox item not found" }, 404);

    const sets: string[] = [];
    const params: any[] = [];

    if ("read" in data) {
      sets.push("read = ?");
      params.push(data.read ? 1 : 0);
    }
    if ("processed" in data) {
      sets.push("processed = ?");
      params.push(data.processed ? 1 : 0);
    }
    if ("ticket_id" in data) {
      sets.push("ticket_id = ?");
      params.push(data.ticket_id);
    }

    if (sets.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    params.push(id);
    sql.exec(`UPDATE inbox SET ${sets.join(", ")} WHERE id = ?`, ...params);

    const updated = sql.exec("SELECT * FROM inbox WHERE id = ?", id).toArray();
    return c.json(rowToInboxItem(updated[0]));
  });

  // --- Delete inbox item ----------------------------------------------

  app.delete("/api/inbox/:id", (c) => {
    const before = sql.exec("SELECT id FROM inbox WHERE id = ?", c.req.param("id")).toArray();
    if (before.length === 0) return c.json({ error: "Inbox item not found" }, 404);
    sql.exec("DELETE FROM inbox WHERE id = ?", c.req.param("id"));
    return c.json({ success: true });
  });

  // --- Re-link an inbox item to a specific ticket -----------------------

  app.post("/api/inbox/:id/relink", async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    const ticketId = data.ticket_id || null;

    const rows = sql.exec("SELECT id FROM inbox WHERE id = ?", id).toArray();
    if (rows.length === 0) return c.json({ error: "Inbox item not found" }, 404);

    if (ticketId) {
      const t = sql.exec("SELECT id FROM hackathons WHERE id = ?", ticketId).toArray();
      if (t.length === 0) return c.json({ error: "Ticket not found" }, 404);
    }

    sql.exec(
      "UPDATE inbox SET ticket_id = ?, match_confidence = 1.0, match_method = 'manual' WHERE id = ?",
      ticketId, id
    );

    const updated = sql.exec("SELECT * FROM inbox WHERE id = ?", id).toArray();
    return c.json(rowToInboxItem(updated[0]));
  });

  // --- Get inbox stats ------------------------------------------------

  app.get("/api/inbox/stats", (c) => {
    const total = sql.exec("SELECT COUNT(*) as c FROM inbox").one().c;
    const unread = sql.exec("SELECT COUNT(*) as c FROM inbox WHERE read = 0").one().c;
    const unprocessed = sql.exec("SELECT COUNT(*) as c FROM inbox WHERE processed = 0").one().c;
    const platform = sql.exec("SELECT COUNT(*) as c FROM inbox WHERE is_platform = 1").one().c;
    return c.json({ total, unread, unprocessed, platform });
  });
}
