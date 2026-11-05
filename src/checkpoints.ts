import { Hono } from "hono";

const FORMAT = "taskmaster-pro-checkpoint";
const VERSION = 2;
const MAX_PAYLOAD_BYTES = 1024 * 1024;

// These are application-owned SQLite records. Operational history and the
// checkpoint catalogue itself are deliberately not rewound by a restore.
type TableSpec = { name: string; columns: string[]; blobColumns?: string[] };

const TABLES: TableSpec[] = [
  { name: "lists", columns: ["id", "name", "color", "icon", "sort_order"] },
  { name: "todos", columns: ["id", "title", "description", "completed", "priority", "due_date", "list_id", "tags", "is_pinned", "estimated_pomodoros", "pomodoro_count", "created_at", "completed_at"] },
  { name: "hackathons", columns: ["id", "name", "platform", "url", "description", "prize", "start_date", "end_date", "registration_deadline", "submission_deadline", "eligibility_json", "status", "notes", "displayed_location", "prizes_counts", "time_left_to_submission", "featured", "created_at", "updated_at"] },
  { name: "hackathon_profile", columns: ["id", "profile_json", "updated_at"] },
  { name: "attachments", columns: ["id", "ticket_id", "filename", "mime_type", "data", "size", "created_at", "deleted_at", "purge_at"], blobColumns: ["data"] },
  { name: "archive_sources", columns: ["id", "name", "type", "api_key", "enabled", "base_url", "created_at"] },
  { name: "settings", columns: ["key", "value", "updated_at"] },
  { name: "capacity", columns: ["day_of_week", "hours_available", "notes"] },
  { name: "inbox", columns: ["id", "sender", "subject", "received_at", "body_preview", "body_html", "has_attachments", "attachment_names", "is_platform", "platform", "ticket_id", "read", "processed", "created_at", "match_confidence", "match_method"] },
  { name: "capture_jobs", columns: ["id", "source_url", "name", "status", "wacz_size", "extracted_json", "error", "created_at", "updated_at"] },
  { name: "push_subscriptions", columns: ["endpoint", "p256dh", "auth", "user_agent", "created_at", "last_ok", "last_error", "failures"] },
  { name: "email_subscriptions", columns: ["id", "address", "name", "active", "created_at", "last_sent", "last_error"] },
  { name: "email_deliveries", columns: ["id", "address", "subject", "status", "message_id", "error", "created_at"] },
] as const;

type CheckpointPayload = {
  format: string;
  version: number;
  created_at: number;
  scope: string;
  tables: Record<string, unknown[]>;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBlob(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { $taskmaster_type: "blob", base64: bytesToBase64(value) };
  }
  if (value instanceof ArrayBuffer) {
    return { $taskmaster_type: "blob", base64: bytesToBase64(new Uint8Array(value)) };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      $taskmaster_type: "blob",
      base64: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    };
  }
  // Cloudflare's SQLite cursor may expose a BLOB as an ArrayBuffer or
  // Uint8Array. Refuse an unexpected representation rather than corrupt it.
  throw new Error("Attachment BLOB has an unsupported runtime representation");
}

function decodeBlob(value: unknown): Uint8Array {
  if (!value || typeof value !== "object") {
    throw new Error("Attachment BLOB is missing or malformed");
  }
  const blob = value as Record<string, unknown>;
  if (blob.$taskmaster_type !== "blob" || typeof blob.base64 !== "string") {
    throw new Error("Attachment BLOB encoding is invalid");
  }
  return base64ToBytes(blob.base64);
}

function snapshot(sql: any): CheckpointPayload {
  const tables: Record<string, unknown[]> = {};
  for (const spec of TABLES) {
    const rows = sql.exec(`SELECT * FROM ${spec.name}`).toArray();
    tables[spec.name] = rows.map((source: Record<string, unknown>) => {
      const row: Record<string, unknown> = {};
      for (const column of spec.columns) {
        const value = source[column];
        row[column] = spec.blobColumns?.includes(column) && value != null
          ? encodeBlob(value)
          : value ?? null;
      }
      return row;
    });
  }
  return {
    format: FORMAT,
    version: VERSION,
    created_at: Date.now(),
    scope: "application-sqlite-data",
    tables,
  };
}

function validatePayload(payload: any): asserts payload is CheckpointPayload {
  if (!payload || payload.format !== FORMAT || payload.version !== VERSION ||
      payload.scope !== "application-sqlite-data" || !payload.tables ||
      typeof payload.tables !== "object" || Array.isArray(payload.tables)) {
    throw new Error("Unsupported or incomplete checkpoint format; refusing partial restore");
  }

  const expected = new Set(TABLES.map((table) => table.name));
  const actual = Object.keys(payload.tables);
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) {
    throw new Error("Checkpoint table inventory does not match this application version");
  }

  for (const spec of TABLES) {
    const rows = payload.tables[spec.name];
    if (!Array.isArray(rows)) throw new Error(`Checkpoint table ${spec.name} is not an array`);
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`Checkpoint contains an invalid row in ${spec.name}`);
      }
      const keys = Object.keys(row);
      if (keys.length !== spec.columns.length ||
          spec.columns.some((column) => !Object.prototype.hasOwnProperty.call(row, column)) ||
          keys.some((column) => !spec.columns.includes(column as never))) {
        throw new Error(`Checkpoint columns do not match the schema for ${spec.name}`);
      }
      for (const column of spec.blobColumns || []) {
        if ((row as any)[column] != null) decodeBlob((row as any)[column]);
      }
    }
  }
}

function restore(sql: any, payload: CheckpointPayload, transaction: (work: () => void) => void, audit: { id: string; actor: string; ip: string }): string[] {
  validatePayload(payload);

  transaction(() => {
    // No foreign keys are declared today, but delete in reverse dependency
    // order and insert in schema order so future relationships remain safe.
    for (const spec of [...TABLES].reverse()) {
      sql.exec(`DELETE FROM ${spec.name}`);
    }

    for (const spec of TABLES) {
      const rows = payload.tables[spec.name] as Record<string, unknown>[];
      for (const row of rows) {
        const columns = [...spec.columns];
        const placeholders = columns.map(() => "?").join(", ");
        const values = columns.map((column) => {
          const value = row[column];
          return spec.blobColumns?.includes(column) && value != null
            ? decodeBlob(value)
            : value;
        });
        sql.exec(
          `INSERT INTO ${spec.name} (${columns.join(", ")}) VALUES (${placeholders})`,
          ...values,
        );
      }
    }

    // The audit log is intentionally outside the snapshot inventory. Record
    // the restore in the same transaction so it survives future rollbacks.
    sql.exec(
      "INSERT INTO audit_log (ts, actor, action, resource, resource_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      Date.now(),
      audit.actor,
      "checkpoint.restored",
      "checkpoint",
      audit.id,
      JSON.stringify({ restored_tables: TABLES.map((table) => table.name) }),
      audit.ip,
    );
  });

  return TABLES.map((table) => table.name);
}

function payloadByteLength(payload: string): number {
  return new TextEncoder().encode(payload).byteLength;
}

export function registerCheckpointRoutes(
  app: Hono,
  sql: any,
  transaction: (work: () => void) => void = (work) => work(),
) {
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
      const id = globalThis.crypto.randomUUID();
      const createdAt = Date.now();
      const payload = JSON.stringify(snapshot(sql));
      const size = payloadByteLength(payload);
      if (size > MAX_PAYLOAD_BYTES) {
        return c.json({
          ok: false,
          error: "Checkpoint exceeds the 1 MiB application snapshot limit. Export attachments and data separately before retrying.",
          payload_bytes: size,
          max_payload_bytes: MAX_PAYLOAD_BYTES,
        }, 413);
      }
      sql.exec(
        "INSERT INTO checkpoints (id, tag, label, kind, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
        id, tag, label, kind, createdAt, payload,
      );
      return c.json({
        ok: true, id, tag, label, kind, created_at: createdAt,
        payload_bytes: size, tables: TABLES.length,
      });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  const restoreCheckpoint = (id: string, c: any) => {
    try {
      const rows = sql.exec("SELECT payload FROM checkpoints WHERE id = ?", id).toArray();
      const row = rows[0];
      if (!row) return c.json({ ok: false, error: "checkpoint not found" }, 404);
      let payload: any;
      try {
        payload = JSON.parse(row.payload as string);
        validatePayload(payload);
      } catch (e) {
        return c.json({ ok: false, error: String(e) }, 409);
      }
      const restoredTables = restore(sql, payload, transaction, {
        id,
        actor: c.req.header("X-Audit-Actor") || "system",
        ip: c.req.header("cf-connecting-ip") || "",
      });
      return c.json({ ok: true, id, restored_tables: restoredTables });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  };

  app.post("/api/checkpoints/:id/rollback", (c) => {
    return restoreCheckpoint(c.req.param("id"), c);
  });

  app.post("/api/checkpoints/forward", async (c) => {
    try {
      const body = await c.req.json();
      const tag = String(body.tag || "manual").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
      if (!tag) return c.json({ ok: false, error: "A valid checkpoint tag is required" }, 400);
      const rows = sql.exec(
        "SELECT id FROM checkpoints WHERE tag = ? ORDER BY created_at DESC LIMIT 1",
        tag,
      ).toArray();
      const row = rows[0];
      if (!row) return c.json({ ok: false, error: "no checkpoint with tag: " + tag }, 404);
      return restoreCheckpoint(row.id, c);
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
