/**
 * In-process test harness — drives the real Hono routes with a real SQLite
 * database, without needing workerd (which is unstable in this sandbox).
 */
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { makeSql } from "./do-sql.mjs";
import { registerHackathonRoutes } from "../src/hackathons.ts";
import { registerInboxRoutes } from "../src/inbox.ts";
import { registerAttachmentRoutes } from "../src/attachments.ts";
import { registerSettingsRoutes } from "../src/settings.ts";
import { registerCapacityRoutes } from "../src/capacity.ts";
import { registerArchiveRoutes } from "../src/archive.ts";
import { SCHEMA } from "../src/schema.ts";

const db = new DatabaseSync(":memory:");

for (const statement of SCHEMA) db.exec(statement);

const sql = makeSql(db);

const app = new Hono();
app.get("/health", (c) => c.json({ status: "ok", version: "1.0.0", timestamp: Date.now() }));
registerHackathonRoutes(app, sql);
registerInboxRoutes(app, sql);
registerAttachmentRoutes(app, sql);
registerSettingsRoutes(app, sql);
registerCapacityRoutes(app, sql);
registerArchiveRoutes(app, sql);

const call = (method, path, body, isForm) => {
  const init = { method };
  if (isForm) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return app.request(path, init);
};

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  console.log("  %s %s%s", ok ? "\x1b[92mPASS\x1b[0m" : "\x1b[91mFAIL\x1b[0m", name, detail ? " - " + detail : "");
  ok ? passed++ : (failed++, failures.push(name + (detail ? " - " + detail : "")));
}

const HACKATHONS = [
  { name: "Build, Ship, Shape: Amazon Developer Hackathon", platform: "devpost", prize: "$138,000",
    start_date: "2026-10-01", end_date: "2026-10-23", submission_deadline: "2026-10-23",
    status: "open", notes: "51k teams",
    eligibility: { eligibility_type: "unrestricted", age_min: 18, regions: ["Global"] } },
  { name: "Qloo Agentic Hackathon", platform: "devpost", prize: "$25,000",
    start_date: "2026-10-01", end_date: "2026-10-30", submission_deadline: "2026-10-30",
    status: "open", notes: "720 teams",
    eligibility: { eligibility_type: "unrestricted", age_min: 18, regions: ["Global"] } },
  { name: "EU Citizens Only AI Challenge", platform: "devpost", prize: "$10,000",
    start_date: "2026-10-01", end_date: "2026-11-30", submission_deadline: "2026-11-30",
    status: "open", notes: "citizenship test",
    eligibility: { eligibility_type: "citizenship", regions: ["EU"], age_min: 18,
      citizenships: ["IT", "DE", "FR", "ES", "NL", "BE", "AT", "IE", "PT", "GR", "FI", "SE", "DK"] } },
  { name: "UK Residents Only Build Challenge", platform: "devpost", prize: "$8,000",
    start_date: "2026-10-01", end_date: "2026-11-30", submission_deadline: "2026-11-30",
    status: "open", notes: "residency test",
    eligibility: { eligibility_type: "residency", regions: ["UK"], residencies: ["GB"], age_min: 18 } },
  { name: "Students Only Campus Hack", platform: "devpost", prize: "$2,000",
    start_date: "2026-10-01", end_date: "2026-11-30", submission_deadline: "2026-11-30",
    status: "open", notes: "student test",
    eligibility: { eligibility_type: "unrestricted", student_only: true, age_min: 18, regions: ["Global"] } },
  { name: "Hacktoberfest 2026", platform: "mlh", prize: "Stickers",
    start_date: "2026-10-01", end_date: "2026-10-31", submission_deadline: "2026-10-31",
    status: "open", notes: "free 13+",
    eligibility: { eligibility_type: "unrestricted", age_min: 13, regions: ["Global"] } },
];

console.log("\n=== 1. Health check ===");
{
  const r = await call("GET", "/health");
  const b = await r.json();
  check("GET /health", r.status === 200 && b.status === "ok", JSON.stringify(b));
}

console.log("\n=== 2. Hackathon CRUD ===");
const created = [];
for (const h of HACKATHONS) {
  const r = await call("POST", "/api/hackathons", h);
  const b = await r.json();
  if (r.status === 201) created.push(b);
}
check("POST /api/hackathons x6", created.length === 6, created.length + " created");
{
  const r = await call("GET", "/api/hackathons");
  const b = await r.json();
  check("GET /api/hackathons", b.length === 6, b.length + " rows");
  check("GET /api/hackathons returns parsed objects", b[0] && b[0].id && b[0].eligibility, b[0] ? "id=" + b[0].id : "");
}
{
  const id = created[0].id;
  const r = await call("GET", "/api/hackathons/" + id);
  const b = await r.json();
  check("GET /api/hackathons/:id", r.status === 200 && b.id === id, "HTTP " + r.status);
}
{
  const id = created[0].id;
  const r = await call("PATCH", "/api/hackathons/" + id, { prize: "$150,000", notes: "updated" });
  const b = await r.json();
  check("PATCH /api/hackathons/:id", r.status === 200 && b.prize === "$150,000", b.prize);
}
{
  const r = await call("GET", "/api/hackathons/nonexistent-id");
  check("GET /api/hackathons/:id on missing -> 404", r.status === 404, "HTTP " + r.status);
}
{
  const r = await call("POST", "/api/hackathons", { name: "   " });
  check("POST with blank name -> 400", r.status === 400, "HTTP " + r.status);
}

console.log("\n=== 3. Profile + eligibility engine ===");
{
  const r = await call("PUT", "/api/hackathons/profile", {
    citizenships: ["IT"], residencies: ["GB"], residency_status: "settled",
    age: 25, is_student: false, team_size: 1, employed_by_sponsor: false,
  });
  check("PUT /api/hackathons/profile", r.status === 200);
}
{
  const r = await call("GET", "/api/hackathons/eligibility");
  const b = await r.json();
  check("GET /api/hackathons/eligibility", r.status === 200, b.length + " results");

  const byName = {};
  for (const e of b) byName[e.hackathon.name] = e;

  const eu = byName["EU Citizens Only AI Challenge"];
  check("EU Citizens Only -> eligible via citizenship",
    eu && eu.eligible === true, eu ? eu.qualification_path : "missing");

  const uk = byName["UK Residents Only Build Challenge"];
  check("UK Residents Only -> eligible via residency",
    uk && uk.eligible === true, uk ? uk.qualification_path : "missing");

  const stu = byName["Students Only Campus Hack"];
  check("Students Only -> NOT eligible",
    stu && stu.eligible === false, stu ? stu.reasons.join("; ") : "missing");

  const amz = byName["Build, Ship, Shape: Amazon Developer Hackathon"];
  check("Unrestricted -> eligible", amz && amz.eligible === true, amz ? amz.qualification_path : "missing");

  for (const e of b) {
    console.log("     %s %-44s %s", e.eligible ? "OK " : "NO ",
      e.hackathon.name.slice(0, 44),
      (e.eligible ? e.qualification_path : e.reasons.join("; ")).slice(0, 58));
  }
}

console.log("\n=== 4. Ticket-scoped attachment routes ===");
const target = created.find((h) => h.name.includes("Amazon"));
{
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "image/png" }), "shot.png");
  const r = await call("POST", `/api/tickets/${target.id}/attachments`, form, true);
  const b = await r.json();
  check("POST /api/tickets/:id/attachments", r.status === 201, "ticket_id=" + b.ticket_id);

  const r2 = await call("GET", `/api/tickets/${target.id}/attachments`);
  const l = await r2.json();
  check("GET /api/tickets/:id/attachments", r2.status === 200 && l.length === 1, l.length + " rows");

  const r3 = await call("GET", `/api/attachments/${b.id}`);
  check("GET /api/attachments/:id (download)", r3.status === 200);

  const r4 = await call("POST", `/api/todos/${target.id}/attachments`, form, true);
  check("legacy /api/todos/:id alias works", r4.status === 201);
}
{
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([9])], { type: "image/png" }), "x.png");
  const r = await call("POST", "/api/tickets/bogus-id-xyz/attachments", form, true);
  check("bogus ticket id -> 404", r.status === 404, "HTTP " + r.status);
}
{
  // The todos routes live in index.ts, which this harness does not load.
  // Insert a todo directly so the ticket path can be exercised.
  db.prepare(
    "INSERT INTO todos (title, list_id, tags, created_at) VALUES (?, ?, ?, ?)"
  ).run("Test todo", "inbox", "[]", Date.now());
  const todoId = db.prepare("SELECT id FROM todos LIMIT 1").get().id;

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([7, 7])], { type: "image/png" }), "todo.png");
  const r2 = await call("POST", `/api/tickets/${todoId}/attachments`, form, true);
  const att = await r2.json();
  check("todo id works as a ticket", r2.status === 201, "ticket_id=" + att.ticket_id);
}

console.log("\n=== 5. Inbox content-based matching ===");
{
  const amazon = created.find((h) => h.name.includes("Amazon"));
  const qloo = created.find((h) => h.name.includes("Qloo"));

  const r = await call("POST", "/api/inbox", {
    sender: "notifications@devpost.com",
    subject: "Build, Ship, Shape: Amazon Developer Hackathon - deadline extended",
    body_text: "The submission deadline for the Amazon hackathon has moved to Oct 30.",
    body_html: "<p>deadline extended</p>",
    has_attachments: false, attachment_names: [],
  });
  const item = await r.json();
  check("POST /api/inbox", r.status === 201, "id=" + item.id);
  check("matched the NAMED hackathon (not the other Devpost one)",
    item.ticket_id === amazon.id,
    "matched=" + (item.ticket_id === amazon.id ? "Amazon (correct)" : item.ticket_id) +
    " method=" + item.match_method + " confidence=" + item.match_confidence);
  check("did NOT match the other Devpost entry", item.ticket_id !== qloo.id);
}
{
  const r = await call("POST", "/api/inbox", {
    sender: "hello@devpost.com", subject: "Your Devpost account needs attention",
    body_text: "Please verify your email address.", body_html: "<p>verify</p>",
  });
  const item = await r.json();
  check("ambiguous email stays unlinked (no guessing)", item.ticket_id === null,
    "ticket_id=" + item.ticket_id + " method=" + item.match_method);
}
{
  const r = await call("POST", "/api/inbox", {
    sender: "someone@gmail.com", subject: "Lunch?", body_text: "Fancy lunch?",
  });
  const item = await r.json();
  check("non-platform email unlinked", item.ticket_id === null, "method=" + item.match_method);
}

console.log("\n=== 6. Inbox CRUD ===");
{
  const r = await call("GET", "/api/inbox");
  const l = await r.json();
  check("GET /api/inbox", r.status === 200, l.length + " rows");

  const r2 = await call("GET", "/api/inbox/stats");
  check("GET /api/inbox/stats", r2.status === 200, JSON.stringify(await r2.json()));

  if (l.length) {
    const r3 = await call("PATCH", `/api/inbox/${l[0].id}`, { read: true, processed: true });
    const u = await r3.json();
    check("PATCH /api/inbox/:id", u.read === true && u.processed === true);

    const r4 = await call("POST", `/api/inbox/${l[0].id}/relink`, { ticket_id: null });
    check("POST /api/inbox/:id/relink", r4.status === 200);

    const r5 = await call("DELETE", `/api/inbox/${l[0].id}`);
    check("DELETE /api/inbox/:id", r5.status === 200);

    const r6 = await call("DELETE", `/api/inbox/${l[0].id}`);
    check("DELETE on a missing inbox item -> 404", r6.status === 404, "HTTP " + r6.status);
  }
}

console.log("\n=== 7. Settings + capacity + archive ===");
{
  const r = await call("GET", "/api/settings");
  const s = await r.json();
  check("GET /api/settings", r.status === 200 && s.storage !== undefined);

  const r2 = await call("PATCH", "/api/settings/profile", { age: 26 });
  check("PATCH /api/settings/:section", r2.status === 200);

  const r3 = await call("GET", "/api/capacity");
  check("GET /api/capacity", r3.status === 200);

  const r4 = await call("GET", "/api/archive/sources");
  check("GET /api/archive/sources", r4.status === 200);

  const r5 = await call("GET", "/api/digest");
  check("GET /api/digest", r5.status === 200);
}

console.log("\n" + "=".repeat(62));
console.log("RESULT: %d passed, %d failed", passed, failed);
for (const f of failures) console.log("  FAILED: " + f);
console.log("=".repeat(62));
process.exit(failed > 0 ? 1 : 0);
