import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { makeSql } from "./do-sql.mjs";
import { SCHEMA } from "../src/schema.ts";
import { CHECKPOINT_TABLES, registerCheckpointRoutes } from "../src/checkpoints.ts";

const db = new DatabaseSync(":memory:");
for (const statement of SCHEMA) db.exec(statement);
const sql = makeSql(db);
const app = new Hono();
registerCheckpointRoutes(app, sql);

const call = (method, path, body) => app.request(path, {
  method,
  ...(body === undefined ? {} : {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
});

function seed() {
  db.exec(`
    INSERT INTO lists (id,name,color,icon,sort_order) VALUES ('inbox','Inbox','#000','inbox',0);
    INSERT INTO todos (title,created_at) VALUES ('before checkpoint',100);
    INSERT INTO hackathons (id,name,created_at,updated_at) VALUES ('h1','Hackathon',100,100);
    INSERT INTO hackathon_profile (id,profile_json,updated_at) VALUES ('profile','{}',100);
    INSERT INTO attachments (id,ticket_id,filename,mime_type,data,size,created_at)
      VALUES ('att1','h1','proof.bin','application/octet-stream',X'0001FEFF',4,100);
    INSERT INTO archive_sources (id,name,type,created_at) VALUES ('source1','Archive','web',100);
    INSERT INTO settings (key,value,updated_at) VALUES ('main','{"theme":"dark"}',100);
    INSERT INTO capacity (day_of_week,hours_available) VALUES (1,6);
    INSERT INTO inbox (id,sender,subject,received_at,created_at) VALUES ('mail1','a@example.test','Subject',100,100);
    INSERT INTO capture_jobs (id,source_url,status,created_at,updated_at) VALUES ('capture1','https://example.test','done',100,100);
    INSERT INTO push_subscriptions (endpoint,p256dh,auth,created_at) VALUES ('https://push.test','p256dh','auth',100);
    INSERT INTO email_subscriptions (address,created_at) VALUES ('a@example.test',100);
    INSERT INTO email_deliveries (address,subject,status,created_at) VALUES ('a@example.test','Hello','sent',100);
  `);
}

const counts = () => Object.fromEntries(CHECKPOINT_TABLES.map((table) => [
  table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
]));

seed();
const created = await call("POST", "/api/checkpoints", { tag: "recovery", label: "Before changes" });
assert.equal(created.status, 200);
const checkpoint = await created.json();
assert.equal(checkpoint.format_version, 2);
assert.deepEqual(Object.keys(checkpoint.table_counts).sort(), [...CHECKPOINT_TABLES].sort());
assert.ok(Object.values(checkpoint.table_counts).every((count) => count === 1));

// Mutate every restorable table, including clearing the binary attachment.
for (const table of CHECKPOINT_TABLES) db.exec(`DELETE FROM ${table}`);
db.exec("INSERT INTO todos (title,created_at) VALUES ('after checkpoint',200)");
const restored = await call("POST", `/api/checkpoints/${checkpoint.id}/rollback`);
assert.equal(restored.status, 200);
const restoreBody = await restored.json();
assert.deepEqual([...restoreBody.restored_tables].sort(), [...CHECKPOINT_TABLES].sort());
assert.deepEqual(counts(), Object.fromEntries(CHECKPOINT_TABLES.map((table) => [table, 1])));
assert.equal(db.prepare("SELECT title FROM todos").get().title, "before checkpoint");
assert.deepEqual(
  [...db.prepare("SELECT data FROM attachments WHERE id='att1'").get().data],
  [0, 1, 254, 255],
);

// The forward-by-tag path uses the same restore implementation.
db.exec("DELETE FROM lists");
const forward = await call("POST", "/api/checkpoints/forward", { tag: "recovery" });
assert.equal(forward.status, 200);
assert.equal(db.prepare("SELECT name FROM lists WHERE id='inbox'").get().name, "Inbox");

// A malformed later table must not leave earlier tables partially deleted.
const brokenPayload = JSON.stringify({
  format: "taskmaster-pro-checkpoint",
  version: 2,
  tables: {
    lists: [],
    todos: [{ not_a_real_column: "invalid" }],
  },
});
db.prepare(
  "INSERT INTO checkpoints (id,tag,label,kind,created_at,payload) VALUES (?,?,?,?,?,?)",
).run("broken", "broken", "Broken", "test", 300, brokenPayload);
const beforeFailure = counts();
const failedRestore = await call("POST", "/api/checkpoints/broken/rollback");
assert.equal(failedRestore.status, 500);
assert.deepEqual(counts(), beforeFailure);

// Unknown formats/tables and malformed row structures are rejected pre-write.
for (const payload of [
  { format: "other", version: 2, tables: {} },
  { format: "taskmaster-pro-checkpoint", version: 2, tables: { sqlite_master: [] } },
  { format: "taskmaster-pro-checkpoint", version: 2, tables: { todos: "not rows" } },
]) {
  db.prepare(
    "INSERT INTO checkpoints (id,tag,label,kind,created_at,payload) VALUES (?,?,?,?,?,?)",
  ).run(crypto.randomUUID(), "invalid", "Invalid", "test", 400, JSON.stringify(payload));
  const id = db.prepare("SELECT id FROM checkpoints WHERE tag='invalid' ORDER BY created_at DESC LIMIT 1").get().id;
  const before = counts();
  const response = await call("POST", `/api/checkpoints/${id}/rollback`);
  assert.equal(response.status, 500);
  assert.deepEqual(counts(), before);
}

console.log(`Checkpoint recovery: PASS (${CHECKPOINT_TABLES.length} application tables, BLOB fidelity, atomic rollback, forward restore, malformed payload rejection)`);
