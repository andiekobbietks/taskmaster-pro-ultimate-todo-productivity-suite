/**
 * Attachment module — store, serve, and manage file attachments for tickets.
 *
 * Design notes:
 * - Attachments are stored as BLOBs inside the Durable Object's SQLite
 *   database. This keeps everything in one place (no external storage needed).
 * - Each attachment links to a ticket via ticket_id (the hackathon/todo id).
 * - The API supports upload (POST), list (GET), download (GET), replace (PUT)
 *   and delete.
 * - Screenshots are the primary use case: browser automation captures a page,
 *   uploads it here, and the frontend renders it inline as additional context.
 *
 * The trash bin
 * -------------
 * A delete is a soft delete: the row keeps its single copy of the bytes and
 * gains `deleted_at` plus a `purge_at` deadline. Nothing is duplicated, so the
 * bin cannot hoard storage — one copy per picture, restore is a pointer flip,
 * and the bytes are finally freed when the deadline passes. The deadline is
 * `trash.retention_days` in the settings blob (default 30, minimum 1), and
 * the hourly cron hard-deletes whatever has expired.
 */
import { Hono } from "hono";

export interface Attachment {
  id: string;
  ticket_id: string;
  filename: string;
  mime_type: string;
  size: number;
  created_at: number;
}

function now(): number {
  return Date.now();
}

function generateId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DAY_MS = 86400000;

/** Retention days from the settings blob; default 30, clamped to 1..365. */
function retentionDays(sql: any): number {
  try {
    const rows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
    const blob = rows.length ? JSON.parse(rows[0].value) : {};
    const days = Number(blob?.trash?.retention_days ?? 30);
    if (!Number.isFinite(days) || days < 1) return 30;
    return Math.min(365, Math.floor(days));
  } catch {
    return 30;
  }
}

/** Metadata columns — never the BLOB. */
const META = "id, ticket_id, filename, mime_type, size, created_at, deleted_at, purge_at";

/**
 * Register all attachment-related API routes on the Hono app.
 *
 * Routes:
 * - POST /api/tickets/:id/attachments (+ /api/todos/:id/attachments alias)
 * - GET  /api/tickets/:id/attachments (+ alias) — live attachments only
 * - GET  /api/attachments/:id       — download/preview (live only)
 * - PUT  /api/attachments/:id       — replace the file, same row (one copy)
 * - DELETE /api/attachments/:id     — soft delete into the bin
 * - GET  /api/attachments           — all live attachments
 * - GET  /api/trash                 — binned attachments + the retention rule
 * - POST /api/trash/:id/restore     — undo: pointer back to live
 * - POST /api/trash/purge           — free the bytes past their deadline
 */
export function registerAttachmentRoutes(app: Hono, sql: any) {
  // --- Upload attachment ---------------------------------------------------

  const uploadHandler = async (c: any) => {
    const ticketId = c.req.param("id");

    // Verify the ticket exists
    const ticketRows = sql
      .exec("SELECT id FROM hackathons WHERE id = ?", ticketId)
      .toArray();
    if (ticketRows.length === 0) {
      const todoRows = sql.exec("SELECT id FROM todos WHERE id = ?", ticketId).toArray();
      if (todoRows.length === 0) {
        return c.json({ error: "Ticket not found" }, 404);
      }
    }

    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    const id = generateId();
    const ts = now();

    sql.exec(
      `INSERT INTO attachments (id, ticket_id, filename, mime_type, data, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      ticketId,
      file.name || "screenshot.png",
      file.type || "image/png",
      data,
      data.length,
      ts,
    ).toArray();

    const rows = sql
      .exec(`SELECT ${META} FROM attachments WHERE id = ?`, id)
      .toArray();

    if (rows.length === 0) return c.json({ error: "Attachment not found" }, 404);
    return c.json(rows[0], 201);
  };

  // A ticket is either a hackathon or a todo, so the namespace must not say
  // "todos" only. The /api/todos alias stays for older clients.
  app.post("/api/tickets/:id/attachments", uploadHandler);
  app.post("/api/todos/:id/attachments", uploadHandler);

  // --- List attachments for a ticket (live only) ---------------------------

  const listHandler = (c: any) => {
    const ticketId = c.req.param("id");
    const rows = sql
      .exec(
        `SELECT id, ticket_id, filename, mime_type, size, created_at
         FROM attachments
         WHERE ticket_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        ticketId,
      )
      .toArray();

    return c.json(rows);
  };

  app.get("/api/tickets/:id/attachments", listHandler);
  app.get("/api/todos/:id/attachments", listHandler);

  // --- Download/preview an attachment --------------------------------------

  app.get("/api/attachments/:id", (c) => {
    const id = c.req.param("id");
    const rows = sql
      .exec(
        "SELECT id, filename, mime_type, data, size, deleted_at FROM attachments WHERE id = ?",
        id,
      )
      .toArray();

    if (rows.length === 0) {
      return c.json({ error: "Attachment not found" }, 404);
    }

    const row = rows[0];
    if (row.deleted_at != null) {
      return c.json(
        { error: "in_bin", message: "This picture is in the bin. Restore it first." },
        404,
      );
    }

    const data = row.data;
    const headers = new Headers();
    headers.set("Content-Type", row.mime_type || "application/octet-stream");
    headers.set("Content-Length", String(data.length));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    return new Response(data, { headers });
  });

  // --- Replace: same row, new bytes (the PPT "replace picture" move) -------
  //
  // One copy per picture survives the swap — the old bytes simply stop
  // existing, so replace cannot double the storage either.
  app.put("/api/attachments/:id", async (c) => {
    const id = c.req.param("id");
    const live = sql
      .exec("SELECT id FROM attachments WHERE id = ? AND deleted_at IS NULL", id)
      .toArray();
    if (live.length === 0) {
      return c.json({ error: "Attachment not found" }, 404);
    }

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);

    sql.exec(
      `UPDATE attachments
       SET filename = ?, mime_type = ?, data = ?, size = ?
       WHERE id = ?`,
      file.name || "screenshot.png",
      file.type || "image/png",
      data,
      data.length,
      id,
    ).toArray();

    const rows = sql.exec(`SELECT ${META} FROM attachments WHERE id = ?`, id).toArray();
    return c.json(rows[0]);
  });

  // --- Soft delete into the bin --------------------------------------------

  app.delete("/api/attachments/:id", (c) => {
    const id = c.req.param("id");
    const ts = now();
    const days = retentionDays(sql);
    const purgeAt = ts + days * DAY_MS;

    const before = sql
      .exec("SELECT deleted_at FROM attachments WHERE id = ?", id)
      .toArray();
    if (before.length === 0) {
      return c.json({ error: "Attachment not found" }, 404);
    }
    if (before[0].deleted_at != null) {
      return c.json({ error: "already_in_bin" }, 409);
    }

    sql.exec(
      "UPDATE attachments SET deleted_at = ?, purge_at = ? WHERE id = ?",
      ts,
      purgeAt,
      id,
    ).toArray();

    const rows = sql.exec(`SELECT ${META} FROM attachments WHERE id = ?`, id).toArray();
    return c.json({
      success: true,
      attachment: rows[0] || null,
      retention_days: days,
      undo: "POST /api/trash/" + id + "/restore  (Ctrl+Z in the app)",
    });
  });

  // --- All attachments, live only (managing feed) --------------------------

  app.get("/api/attachments", (c) => {
    const rows = sql
      .exec(
        `SELECT id, ticket_id, filename, mime_type, size, created_at
         FROM attachments WHERE deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      )
      .toArray();

    return c.json(rows);
  });

  // --- The bin: what is in it, and the rule that empties it ----------------

  app.get("/api/trash", (c) => {
    const rows = sql
      .exec(
        `SELECT id, ticket_id, filename, mime_type, size, deleted_at, purge_at
         FROM attachments WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC`,
      )
      .toArray();
    const days = retentionDays(sql);
    return c.json({
      items: rows,
      count: rows.length,
      bytes: rows.reduce((n: number, r: any) => n + (r.size || 0), 0),
      retention_days: days,
      rule: "A binned picture keeps its one copy until purge_at, then the hourly cron frees the bytes. Set trash.retention_days in Settings (minimum 1 day).",
    });
  });

  // --- Undo: the pointer flips back, the copy was never duplicated ---------

  app.post("/api/trash/:id/restore", (c) => {
    const id = c.req.param("id");
    const before = sql
      .exec("SELECT deleted_at FROM attachments WHERE id = ?", id)
      .toArray();
    if (before.length === 0 || before[0].deleted_at == null) {
      return c.json({ error: "Attachment not found in the bin" }, 404);
    }

    sql.exec(
      "UPDATE attachments SET deleted_at = NULL, purge_at = NULL WHERE id = ?",
      id,
    ).toArray();

    const rows = sql.exec(`SELECT ${META} FROM attachments WHERE id = ?`, id).toArray();
    return c.json({ success: true, attachment: rows[0] || null });
  });

  // --- Purge: free the bytes past their deadline ---------------------------
  //
  // Called by the hourly cron and by hand. Only rows genuinely past
  // purge_at are removed — the bin never holds anything else.
  app.post("/api/trash/purge", (c) => {
    const ts = now();
    const expired = sql
      .exec(
        "SELECT id, filename, size FROM attachments WHERE deleted_at IS NOT NULL AND purge_at <= ?",
        ts,
      )
      .toArray();
    for (const row of expired) {
      sql.exec("DELETE FROM attachments WHERE id = ?", row.id).toArray();
    }
    return c.json({ purged: expired.length, bytes_freed: expired.reduce((n: number, r: any) => n + (r.size || 0), 0), checked_at: ts });
  });
}
