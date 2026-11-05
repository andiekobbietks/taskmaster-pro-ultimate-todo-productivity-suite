import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { makeSql } from "./do-sql.mjs";
import { SCHEMA } from "../src/schema.ts";
import { registerCheckpointRoutes } from "../src/checkpoints.ts";
import { decryptSetting, encryptSetting } from "../src/settings-crypto.ts";

const db = new DatabaseSync(":memory:");
for (const statement of SCHEMA) db.exec(statement);
const sql = makeSql(db);
const transaction = (work) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
const app = new Hono();
const env = { SETTINGS_ENCRYPTION_KEY: "checkpoint-test-key" };
registerCheckpointRoutes(app, sql, transaction, env);
const call = (method, path, body) => app.request(path, {
  method,
  ...(body === undefined ? {} : {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
});

const binary = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
sql.exec("INSERT INTO lists (id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?)", "inbox", "Inbox", "#123456", "inbox", 0);
sql.exec("INSERT INTO todos (title, description, completed, priority, list_id, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", "Original task", "before snapshot", 0, "high", "inbox", '["restore"]', 100);
sql.exec("INSERT INTO hackathons (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", "hack-1", "Original event", 100, 100);
sql.exec("INSERT INTO hackathon_profile (id, profile_json, updated_at) VALUES (?, ?, ?)", "main", '{"residencies":["GB"]}', 100);
sql.exec("INSERT INTO attachments (id, ticket_id, filename, mime_type, data, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", "att-1", "hack-1", "evidence.bin", "application/octet-stream", binary, binary.length, 100);
sql.exec("INSERT INTO archive_sources (id, name, type, api_key, enabled, base_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", "archive-1", "Archive", "wayback", "secret-key", 1, "https://web.archive.org", 100);
sql.exec("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)", "main", '{"theme":"dark"}', 100);
sql.exec("INSERT INTO capacity (day_of_week, hours_available, notes) VALUES (?, ?, ?)", 1, 4, "Focus time");
sql.exec("INSERT INTO inbox (id, sender, subject, received_at, body_preview, body_html, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", "mail-1", "sender@example.test", "Original mail", 100, "preview", "<p>body</p>", 100);
sql.exec("INSERT INTO capture_jobs (id, source_url, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "cap-1", "https://example.test", "Capture", "complete", 100, 100);
sql.exec("INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)", "https://push.example.test", "p256dh", "auth", 100);
sql.exec("INSERT INTO email_subscriptions (address, created_at) VALUES (?, ?)", "reader@example.test", 100);
sql.exec("INSERT INTO email_deliveries (address, subject, status, created_at) VALUES (?, ?, ?, ?)", "reader@example.test", "Digest", "sent", 100);

const created = await call("POST", "/api/checkpoints", { tag: "recovery-test", label: "Recovery test" });
assert.equal(created.status, 200);
const checkpoint = await created.json();
assert.equal(checkpoint.tables, 13);
assert.ok(checkpoint.payload_bytes > 0);
const storedCheckpoint = db.prepare("SELECT payload FROM checkpoints WHERE id = ?").get(checkpoint.id).payload;
assert.ok(storedCheckpoint.startsWith("enc:v1:"), "checkpoint payload is encrypted at rest");
assert.ok(!storedCheckpoint.includes("secret-key"), "archive source API keys are not visible in checkpoint storage");
const decryptedCheckpoint = await decryptSetting(storedCheckpoint, env);
assert.ok(decryptedCheckpoint.includes("secret-key"), "the encrypted checkpoint retains the archive key for restore");
const largePlaintext = "checkpoint-data-".repeat(20000);
const largeCiphertext = await encryptSetting(largePlaintext, env);
assert.equal(await decryptSetting(largeCiphertext, env), largePlaintext, "large checkpoint payloads use safe chunked base64 encoding");
const wrongKeyApp = new Hono();
registerCheckpointRoutes(wrongKeyApp, sql, transaction, { SETTINGS_ENCRYPTION_KEY: "incorrect-key" });
const wrongKeyResponse = await wrongKeyApp.request(`/api/checkpoints/${checkpoint.id}/rollback`, { method: "POST" });
assert.equal(wrongKeyResponse.status, 409, "wrong encryption keys fail closed before restore");
assert.equal(db.prepare("SELECT api_key FROM archive_sources WHERE id = 'archive-1'").get().api_key, "secret-key");
const missingRollback = await call("POST", "/api/checkpoints/missing/rollback");
assert.equal(missingRollback.status, 404, "missing checkpoint IDs return 404");
const missingForward = await call("POST", "/api/checkpoints/forward", { tag: "missing" });
assert.equal(missingForward.status, 404, "missing checkpoint tags return 404");
const checkpointRow = db.prepare("SELECT payload FROM checkpoints WHERE id = ?").get(checkpoint.id);
// Base64 expansion means this attachment pushes the JSON snapshot above 1 MiB.
sql.exec("UPDATE attachments SET data = ?, size = ? WHERE id = 'att-1'", new Uint8Array(800 * 1024).fill(7), 800 * 1024);
const oversized = await call("POST", "/api/checkpoints", { tag: "oversized" });
assert.equal(oversized.status, 413, "oversized snapshots are rejected before the SQLite INSERT");
assert.equal(db.prepare("SELECT count(*) AS n FROM checkpoints WHERE tag = 'oversized'").get().n, 0);
sql.exec("UPDATE attachments SET data = ?, size = ? WHERE id = 'att-1'", binary, binary.length);
const storedPayload = JSON.parse(checkpointRow.payload);
assert.equal(storedPayload.version, 2);
assert.equal(storedPayload.tables.hackathons.length, 1);
assert.equal(storedPayload.tables.inbox.length, 1);
assert.equal(storedPayload.tables.attachments.length, 1);
assert.equal(storedPayload.tables.attachments[0].data.$taskmaster_type, "blob");

sql.exec("UPDATE todos SET title = 'Changed after snapshot' WHERE title = 'Original task'");
sql.exec("UPDATE hackathons SET name = 'Changed event' WHERE id = 'hack-1'");
sql.exec("UPDATE inbox SET subject = 'Changed mail' WHERE id = 'mail-1'");
sql.exec("UPDATE attachments SET data = ? WHERE id = 'att-1'", new Uint8Array([9, 9, 9]));
sql.exec("INSERT INTO rate_limits (ip, count, window_start) VALUES (?, ?, ?)", "127.0.0.1", 4, 200);
sql.exec("INSERT INTO audit_log (ts, actor, action, resource) VALUES (?, ?, ?, ?)", 200, "test", "after-checkpoint", "test");

db.exec("CREATE TRIGGER fail_checkpoint_restore BEFORE INSERT ON hackathons BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END");
const failedRestore = await call("POST", `/api/checkpoints/${checkpoint.id}/rollback`);
assert.equal(failedRestore.status, 500);
assert.equal(db.prepare("SELECT title FROM todos").get().title, "Changed after snapshot", "failed restore must roll back earlier deletes/inserts");
assert.equal(db.prepare("SELECT name FROM hackathons").get().name, "Changed event", "failed restore must preserve current rows");
db.exec("DROP TRIGGER fail_checkpoint_restore");

const restored = await call("POST", `/api/checkpoints/${checkpoint.id}/rollback`);
assert.equal(restored.status, 200);
const restoredBody = await restored.json();
assert.equal(restoredBody.restored_tables.length, 13);
assert.equal(db.prepare("SELECT title FROM todos").get().title, "Original task");
assert.equal(db.prepare("SELECT name FROM hackathons").get().name, "Original event");
assert.equal(db.prepare("SELECT subject FROM inbox").get().subject, "Original mail");
assert.deepEqual(
  Array.from(db.prepare("SELECT data FROM attachments WHERE id = 'att-1'").get().data),
  Array.from(binary),
  "attachment BLOB bytes must survive checkpoint and restore",
);
assert.equal(db.prepare("SELECT api_key FROM archive_sources WHERE id = 'archive-1'").get().api_key, "secret-key");
assert.equal(db.prepare("SELECT count FROM rate_limits WHERE ip = '127.0.0.1'").get().count, 4, "operational rate limits are not rewound");
assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'after-checkpoint'").get().n, 1, "audit history is not rewound");
assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'checkpoint.restored'").get().n, 1, "successful restore is itself audited");

const legacyId = "legacy-partial";
sql.exec("INSERT INTO checkpoints (id, tag, label, kind, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
  legacyId, "legacy", "Old partial checkpoint", "manual", 300, JSON.stringify({ lists: [] }));
const legacy = await call("POST", `/api/checkpoints/${legacyId}/rollback`);
assert.equal(legacy.status, 409, "old incomplete checkpoint formats must fail closed");
assert.equal(db.prepare("SELECT title FROM todos").get().title, "Original task", "invalid restore must not mutate data");

console.log("Checkpoint recovery: all assertions passed");
db.close();
