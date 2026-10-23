import { Hono } from "hono";

function randomUUID() {
  return globalThis.crypto.randomUUID();
}

const CHECKPOINT_TABLES = [
  "lists",
  "todos",
  "settings",
  "hackathon_profile",
  "capacity",
  "push_subscriptions",
  "email_subscriptions",
];

function snapshot(sql: any) {
  const payload: Record<string, unknown[]> = {};
  for (const table of CHECKPOINT_TABLES) {
    try {
      payload[table] = sql.exec(`SELECT * FROM ${table}`).toArray();
    } catch (e) {
      payload[table] = [];
    }
  }
  return payload;
}

function restore(sql: any, payload: Record<string, unknown[]>) {
  for (const table of CHECKPOINT_TABLES) {
    const rows = payload[table];
    if (!Array.isArray(rows)) continue;
    try {
      sql.exec(`DELETE FROM ${table}`);
    } catch {
      // table may not exist
    }
    if (rows.length === 0) continue;
    const keys = Object.keys(rows[0]);
    const cols = keys.join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    for (const row of rows) {
      const values = keys.map((k) => (row as any)[k] ?? null);
      sql.exec(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`, ...values);
    }
  }
}

export function registerCheckpointRoutes(app: Hono, sql: any) {
  app.get("/api/checkpoints", (c) => {
    try {
      const rows = sql.exec("SELECT id, tag, label, kind, created_at FROM checkpoints ORDER BY created_at DESC").toArray();
      return c.json({ checkpoints: rows });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/checkpoints", async (c) => {
    try {
      const body = await c.req.json();
      const tag = String(body.tag || "manual").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "manual";
      const label = String(body.label || tag).slice(0, 200);
      const kind = String(body.kind || "manual").slice(0, 40);
      const id = randomUUID();
      const payload = JSON.stringify(snapshot(sql));
      sql.exec(
        "INSERT INTO checkpoints (id, tag, label, kind, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
        id, tag, label, kind, Date.now(), payload
      );
      return c.json({ ok: true, id, tag, label, kind, created_at: Date.now() });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  app.post("/api/checkpoints/:id/rollback", async (c) => {
    try {
      const id = c.req.param("id");
      const row = sql.exec("SELECT payload FROM checkpoints WHERE id = ?", id).one();
      if (!row) return c.json({ ok: false, error: "checkpoint not found" }, 404);
      const payload = JSON.parse(row.payload as string);
      restore(sql, payload);
      return c.json({ ok: true, id, restored_tables: Object.keys(payload) });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  app.post("/api/checkpoints/forward", async (c) => {
    try {
      const body = await c.req.json();
      const tag = String(body.tag || "manual");
      const row = sql.exec(
        "SELECT id, payload FROM checkpoints WHERE tag = ? ORDER BY created_at DESC LIMIT 1",
        tag
      ).one();
      if (!row) return c.json({ ok: false, error: "no checkpoint with tag: " + tag }, 404);
      const payload = JSON.parse(row.payload as string);
      restore(sql, payload);
      return c.json({ ok: true, id: row.id, tag, restored_tables: Object.keys(payload) });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  app.delete("/api/checkpoints/:id", (c) => {
    try {
      const id = c.req.param("id");
      sql.exec("DELETE FROM checkpoints WHERE id = ?", id);
      return c.json({ ok: true, id });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });
}
