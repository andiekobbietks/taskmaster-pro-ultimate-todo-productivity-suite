/**
 * Attachment module — store, serve, and manage file attachments for tickets.
 *
 * Design notes:
 * - Attachments are stored as BLOBs inside the Durable Object's SQLite database.
 *   This keeps everything in one place (no external storage needed) and works
 *   with the existing per-(space,branch) isolation model.
 * - Each attachment links to a ticket via ticket_id (the hackathon/todo id).
 * - The API supports upload (POST), list (GET), download (GET), and delete.
 * - Screenshots are the primary use case: browser automation captures a page,
 *   uploads it here, and the frontend renders it inline as additional context.
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

export function registerAttachmentRoutes(app: Hono, sql: any) {
  // --- Upload attachment ---------------------------------------------------

  app.post("/api/todos/:id/attachments", async (c) => {
    const ticketId = c.req.param("id");

    // Verify the ticket exists
    const ticket = sql
      .exec("SELECT id FROM hackathons WHERE id = ?", ticketId)
      .one();
    if (!ticket) {
      // Also check todos table
      const todo = sql
        .exec("SELECT id FROM todos WHERE id = ?", ticketId)
        .one();
      if (!todo) {
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
    );

    const row = sql
      .exec("SELECT id, ticket_id, filename, mime_type, size, created_at FROM attachments WHERE id = ?", id)
      .one();

    return c.json(row, 201);
  });

  // --- List attachments for a ticket ---------------------------------------

  app.get("/api/todos/:id/attachments", (c) => {
    const ticketId = c.req.param("id");
    const rows = sql
      .exec(
        "SELECT id, ticket_id, filename, mime_type, size, created_at FROM attachments WHERE ticket_id = ? ORDER BY created_at DESC",
        ticketId,
      )
      .toArray();

    return c.json(rows);
  });

  // --- Download/preview an attachment --------------------------------------

  app.get("/api/attachments/:id", (c) => {
    const id = c.req.param("id");
    const rows = sql
      .exec("SELECT id, filename, mime_type, data, size FROM attachments WHERE id = ?", id)
      .toArray();

    if (rows.length === 0) {
      return c.json({ error: "Attachment not found" }, 404);
    }

    const row = rows[0];
    const data = row.data;
    const headers = new Headers();
    headers.set("Content-Type", row.mime_type || "application/octet-stream");
    headers.set("Content-Length", String(data.length));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    return new Response(data, { headers });
  });

  // --- Delete an attachment -------------------------------------------------

  app.delete("/api/attachments/:id", (c) => {
    const id = c.req.param("id");
    const before = sql.exec("SELECT id FROM attachments WHERE id = ?", id).toArray();
    if (before.length === 0) {
      return c.json({ error: "Attachment not found" }, 404);
    }
    sql.exec("DELETE FROM attachments WHERE id = ?", id);

    if (false) {
      return c.json({ error: "Attachment not found" }, 404);
    }

    return c.json({ success: true });
  });

  // --- List all attachments (for the managing feed) ------------------------

  app.get("/api/attachments", (c) => {
    const rows = sql
      .exec(
        "SELECT id, ticket_id, filename, mime_type, size, created_at FROM attachments ORDER BY created_at DESC LIMIT 100",
      )
      .toArray();

    return c.json(rows);
  });
}
