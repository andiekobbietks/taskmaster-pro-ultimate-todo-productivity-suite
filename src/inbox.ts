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

    // Try to match to an existing hackathon ticket by sender domain
    let ticketId = null;
    if (platform) {
      const rows = sql.exec(
        "SELECT id FROM hackathons WHERE platform = ? ORDER BY updated_at DESC LIMIT 1",
        platform
      ).toArray();
      if (rows.length > 0) ticketId = rows[0].id;
    }

    sql.exec(
      `INSERT INTO inbox (id, sender, subject, received_at, body_preview, body_html, has_attachments, attachment_names, is_platform, platform, ticket_id, read, processed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      id, sender, subject, received_at,
      body_text.slice(0, 500), body_html,
      has_attachments ? 1 : 0,
      JSON.stringify(attachment_names),
      is_platform || platform !== null ? 1 : 0,
      platform, ticketId, ts
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

  // --- Get inbox stats ------------------------------------------------

  app.get("/api/inbox/stats", (c) => {
    const total = sql.exec("SELECT COUNT(*) as c FROM inbox").one().c;
    const unread = sql.exec("SELECT COUNT(*) as c FROM inbox WHERE read = 0").one().c;
    const unprocessed = sql.exec("SELECT COUNT(*) as c FROM inbox WHERE processed = 0").one().c;
    const platform = sql.exec("SELECT COUNT(*) as c FROM inbox WHERE is_platform = 1").one().c;
    return c.json({ total, unread, unprocessed, platform });
  });
}
