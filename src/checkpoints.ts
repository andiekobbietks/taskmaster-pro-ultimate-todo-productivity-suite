import { Hono } from "hono";

function randomUUID() {
  return globalThis.crypto.randomUUID();
}

/**
 * A checkpoint is a recovery snapshot of application data, not a copy of the
 * entire Durable Object runtime. Operational rate limits, diagnostics, audit
 * history, and checkpoint history are intentionally not rewound.
 */
export const CHECKPOINT_TABLES = [
  "lists",
  "todos",
  "hackathons",
  "hackathon_profile",
  "attachments",
  "archive_sources",
  "settings",
  "capacity",
  "inbox",
  "capture_jobs",
  "push_subscriptions",
  "email_subscriptions",
  "email_deliveries",
] as const;

const FORMAT = "taskmaster-pro-checkpoint";
const FORMAT_VERSION = 2;
const BLOB_MARKER = "__taskmaster_blob_v1";

type Sql = {
  exec: (query: string, ...bindings: unknown[]) => {
    toArray: () => any[];
    one: () => any;
  };
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) {
    return { [BLOB_MARKER]: bytesToBase64(new Uint8Array(value)) };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      [BLOB_MARKER]: bytesToBase64(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    };
  }
  return value;
}

function decodeValue(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)[BLOB_MARKER] === "string"
  ) {
    return base64ToBytes((value as Record<string, string>)[BLOB_MARKER]);
  }
  return value;
}

function snapshot(sql: Sql, createdAt: number) {
  const tables: Record<string, unknown[]> = {};
  const tableCounts: Record<string, number> = {};
  for (const table of CHECKPOINT_TABLES) {
    // A missing table is a schema failure, not an empty table. Never produce
    // a checkpoint that looks complete after silently dropping data.
    const rows = sql.exec(`SELECT * FROM ${table}`).toArray();
    tables[table] = rows.map((row) => {
      const encoded: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) encoded[key] = encodeValue(value);
      return encoded;
    });
    tableCounts[table] = rows.length;
  }
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    created_at: createdAt,
    tables,
    table_counts: tableCounts,
  };
}

function isTableName(value: string): value is (typeof CHECKPOINT_TABLES)[number] {
  return (CHECKPOINT_TABLES as readonly string[]).includes(value);
}

function restore(sql: Sql, rawPayload: unknown): string[] {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new Error("Invalid checkpoint payload");
  }

  const payload = rawPayload as Record<string, unknown>;
  let tables: Record<string, unknown>;
  if (payload.format === FORMAT && payload.version === FORMAT_VERSION) {
    if (!payload.tables || typeof payload.tables !== "object" || Array.isArray(payload.tables)) {
      throw new Error("Invalid checkpoint tables");
    }
    tables = payload.tables as Record<string, unknown>;
  } else if (payload.format === undefined) {
    // Backward compatibility for checkpoints created before the versioned
    // format. Only the tables actually present in that legacy payload change.
    tables = payload;
  } else {
    throw new Error("Unsupported checkpoint format or version");
  }

  const selected = Object.keys(tables);
  for (const table of selected) {
    if (!isTableName(table)) throw new Error(`Checkpoint contains unsupported table: ${table}`);
    if (!Array.isArray(tables[table])) throw new Error(`Invalid rows for table: ${table}`);
    for (const row of tables[table] as unknown[]) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`Invalid row in table: ${table}`);
      }
      const keys = Object.keys(row);
      if (keys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
        throw new Error(`Invalid column name in table: ${table}`);
      }
    }
  }
  if (selected.length === 0) throw new Error("Checkpoint contains no restorable tables");

  // SAVEPOINT makes the restore all-or-nothing even when a later insert fails.
  // It also composes safely if a caller already has an outer transaction.
  const savepoint = "taskmaster_checkpoint_restore";
  sql.exec(`SAVEPOINT ${savepoint}`);
  try {
    for (const table of selected) {
      const rows = tables[table] as Record<string, unknown>[];
      sql.exec(`DELETE FROM ${table}`);
      for (const row of rows) {
        const keys = Object.keys(row);
        if (keys.length === 0) throw new Error(`Empty row in table: ${table}`);
        const columns = keys.join(", ");
        const placeholders = keys.map(() => "?").join(", ");
        const values = keys.map((key) => decodeValue(row[key]));
        sql.exec(
          `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`,
          ...values,
        );
      }
    }
    sql.exec(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    try {
      sql.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      sql.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch {
      // Preserve the original restore error; SQLite will surface a broken
      // transaction on the next operation if rollback itself was impossible.
    }
    throw error;
  }
  return selected;
}

export function registerCheckpointRoutes(app: Hono, sql: Sql) {
  app.get("/api/checkpoints", (c) => {
    try {
      const rows = sql.exec(
        "SELECT id, tag, label, kind, created_at FROM checkpoints ORDER BY created_at DESC",
      ).toArray();
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
      const createdAt = Date.now();
      const payload = snapshot(sql, createdAt);
      sql.exec(
        "INSERT INTO checkpoints (id, tag, label, kind, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
        id, tag, label, kind, createdAt, JSON.stringify(payload),
      );
      return c.json({
        ok: true, id, tag, label, kind, created_at: createdAt,
        format_version: FORMAT_VERSION,
        table_counts: payload.table_counts,
      });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  app.post("/api/checkpoints/:id/rollback", (c) => {
    try {
      const id = c.req.param("id");
      const row = sql.exec("SELECT payload FROM checkpoints WHERE id = ?", id).one();
      if (!row) return c.json({ ok: false, error: "checkpoint not found" }, 404);
      const restoredTables = restore(sql, JSON.parse(row.payload as string));
      return c.json({ ok: true, id, restored_tables: restoredTables });
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
        tag,
      ).one();
      if (!row) return c.json({ ok: false, error: "no checkpoint with tag: " + tag }, 404);
      const restoredTables = restore(sql, JSON.parse(row.payload as string));
      return c.json({ ok: true, id: row.id, tag, restored_tables: restoredTables });
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
