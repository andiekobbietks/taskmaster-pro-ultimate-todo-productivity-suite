
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { makeSql } from "./do-sql.mjs";
import { registerHackathonRoutes } from "../src/hackathons.ts";
import { registerInboxRoutes } from "../src/inbox.ts";
import { registerAttachmentRoutes } from "../src/attachments.ts";
import { registerSettingsRoutes } from "../src/settings.ts";
import { registerCapacityRoutes } from "../src/capacity.ts";
import { registerArchiveRoutes } from "../src/archive.ts";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
    description TEXT DEFAULT '', completed INTEGER DEFAULT 0, priority TEXT DEFAULT 'medium',
    due_date TEXT DEFAULT NULL, list_id TEXT DEFAULT 'inbox', tags TEXT DEFAULT '[]',
    is_pinned INTEGER DEFAULT 0, estimated_pomodoros INTEGER DEFAULT 1,
    pomodoro_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL, completed_at INTEGER DEFAULT NULL);
  CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
    icon TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
  CREATE TABLE hackathons (id TEXT PRIMARY KEY, name TEXT NOT NULL,
    platform TEXT DEFAULT 'manual', url TEXT DEFAULT '', description TEXT DEFAULT '',
    prize TEXT DEFAULT '', start_date TEXT DEFAULT NULL, end_date TEXT DEFAULT NULL,
    registration_deadline TEXT DEFAULT NULL, submission_deadline TEXT DEFAULT NULL,
    eligibility_json TEXT DEFAULT '{}', status TEXT DEFAULT 'open', notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE hackathon_profile (id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL);
  CREATE TABLE attachments (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL,
    filename TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL,
    size INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE inbox (id TEXT PRIMARY KEY, sender TEXT NOT NULL, subject TEXT NOT NULL,
    received_at INTEGER NOT NULL, body_preview TEXT DEFAULT '', body_html TEXT DEFAULT '',
    has_attachments INTEGER DEFAULT 0, attachment_names TEXT DEFAULT '[]',
    is_platform INTEGER DEFAULT 0, platform TEXT DEFAULT NULL, ticket_id TEXT DEFAULT NULL,
    read INTEGER DEFAULT 0, processed INTEGER DEFAULT 0, created_at INTEGER NOT NULL,
    match_confidence REAL DEFAULT 0, match_method TEXT DEFAULT 'none');
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE capacity (day_of_week INTEGER PRIMARY KEY,
    hours_available REAL NOT NULL DEFAULT 0, notes TEXT DEFAULT '');
  CREATE TABLE archive_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
    api_key TEXT DEFAULT NULL, enabled INTEGER DEFAULT 1, base_url TEXT DEFAULT '',
    created_at INTEGER NOT NULL);
`);

const sql = makeSql(db);
const app = new Hono();
app.get("/health", (c) => c.json({ status: "ok", version: "1.2.0" }));
registerHackathonRoutes(app, sql);
registerInboxRoutes(app, sql);
registerAttachmentRoutes(app, sql);
registerSettingsRoutes(app, sql);
registerCapacityRoutes(app, sql);
registerArchiveRoutes(app, sql);

const call = (method, path, body, isForm) => {
  const init = { method };
  if (isForm) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return app.request(path, init);
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "\x1b[92mPASS\x1b[0m" : "\x1b[91mFAIL\x1b[0m"} ${name}${detail ? " - " + detail : ""}`);
  ok ? pass++ : (fail++, failures.push(name + (detail ? " - " + detail : "")));
};

console.log("\n=== 1. Add Hackathon (the dead button) ===");
{
  const r = await call("POST", "/api/hackathons", {
    name: "Test Hackathon", platform: "devpost", prize: "$10,000",
    eligibility: { eligibility_type: "unrestricted", regions: ["Global"], age_min: 13 },
  });
  const b = await r.json();
  check("POST creates a hackathon", r.status === 201 && b.id, "id=" + b.id);

  const list = await (await call("GET", "/api/hackathons")).json();
  check("it appears in the list", list.some((x) => x.id === b.id), list.length + " rows");

  const one = await (await call("GET", "/api/hackathons/" + b.id)).json();
  check("it can be fetched by id", one.id === b.id);

  const p = await call("PATCH", "/api/hackathons/" + b.id, { prize: "$20,000", status: "closed" });
  const pb = await p.json();
  check("PATCH updates it", p.status === 200 && pb.prize === "$20,000" && pb.status === "closed");

  const d = await call("DELETE", "/api/hackathons/" + b.id);
  check("DELETE removes it", d.status === 200);
  const gone = await (await call("GET", "/api/hackathons/" + b.id)).json();
  check("it is really gone", gone.error === "Hackathon not found");
}

console.log("\n=== 2. Settings are populated ===");
{
  const r = await call("GET", "/api/settings");
  const s = await r.json();
  check("GET /api/settings does not crash", r.status === 200, "HTTP " + r.status);
  check("it returns the storage section", !!s.storage, JSON.stringify(s.storage || {}).slice(0, 60));
  check("it returns the email section", !!s.email);
  check("it returns the notifications section", !!s.notifications);
  check("it returns the profile section", !!s.profile);
  check("profile has the expected fields",
    s.profile && "citizenships" in s.profile && "residencies" in s.profile && "age" in s.profile,
    JSON.stringify(s.profile || {}).slice(0, 90));
}

console.log("\n=== 3. Settings reach the eligibility engine ===");
{
  // Write a profile through settings
  await call("PATCH", "/api/settings/profile", {
    citizenships: ["IT"], residencies: ["GB"], residency_status: "settled",
    age: 25, is_student: false, team_size: 1, employed_by_sponsor: false,
  });
  // The engine must now see it
  const p = await (await call("GET", "/api/hackathons/profile")).json();
  check("the engine reads the profile written via settings",
    Array.isArray(p.citizenships) && p.citizenships.includes("IT"),
    JSON.stringify(p).slice(0, 90));

  // And an EU-citizenship-only hackathon must now be eligible
  await call("POST", "/api/hackathons", {
    name: "EU Only Challenge", platform: "devpost",
    eligibility: { eligibility_type: "citizenship", regions: ["EU"], age_min: 18,
      citizenships: ["IT", "DE", "FR"] },
  });
  const elig = await (await call("GET", "/api/hackathons/eligibility")).json();
  const eu = elig.find((e) => e.hackathon.name === "EU Only Challenge");
  check("the EU-only hackathon is now eligible via that profile",
    eu && eu.eligible === true, eu ? eu.qualification_path : "not found");
}

console.log("\n=== 4. Per-card screenshot upload ===");
{
  const h = (await (await call("GET", "/api/hackathons")).json())[0];
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "shot.png");
  const r = await call("POST", `/api/tickets/${h.id}/attachments`, form, true);
  const b = await r.json();
  check("upload attaches to the right ticket", r.status === 201 && b.ticket_id === h.id,
    "ticket_id=" + b.ticket_id);

  const list = await (await call("GET", `/api/tickets/${h.id}/attachments`)).json();
  check("it is listed against that ticket", list.length >= 1, list.length + " rows");
}

console.log("\n=== 5. Multi-selection endpoints all work ===");
{
  // Create two known fixtures rather than relying on what earlier tests left.
  const fx = [];
  for (const n of ["Bulk A", "Bulk B"]) {
    const r = await call("POST", "/api/hackathons", {
      name: n, platform: "devpost",
      eligibility: { eligibility_type: "unrestricted", regions: ["Global"], age_min: 13 },
    });
    fx.push((await r.json()).id);
  }
  const list = fx.map((id) => ({ id, name: id }));
  if (list.length >= 2) {
    const a = list[0], b = list[1];
    // Bulk status change, one at a time as the UI does
    for (const t of [a, b]) {
      const r = await call("PATCH", `/api/hackathons/${t.id}`, { status: "closed" });
      check("PATCH status on " + t.name.slice(0, 20), r.status === 200);
    }
    const after = await (await call("GET", "/api/hackathons")).json();
    check("both took the new status",
      after.find((x) => x.id === a.id).status === "closed" &&
      after.find((x) => x.id === b.id).status === "closed");
  } else {
    check("need 2+ hackathons for the bulk test", false, list.length + " rows");
  }
}


console.log("\n=== 6. Settings merge instead of reset ===");
{
  // Seed every section with a distinctive value.
  await call("PUT", "/api/settings", {
    storage: { provider: "s3", s3_bucket: "my-bucket" },
    email: { inbox_address: "me@example.com", imap_user: "me" },
    notifications: { daily_digest: false, digest_time: "07:30" },
    profile: { citizenships: ["DE"], residencies: ["DE"], age: 31 },
  });

  const seeded = await (await call("GET", "/api/settings")).json();
  check("storage seeded", seeded.storage.provider === "s3", seeded.storage.provider);
  check("email seeded", seeded.email.inbox_address === "me@example.com",
        seeded.email.inbox_address);

  // Now change ONE storage field, the way the UI does.
  await call("PUT", "/api/settings", { storage: { provider: "azure" } });

  const after = await (await call("GET", "/api/settings")).json();
  check("the changed field took effect", after.storage.provider === "azure",
        after.storage.provider);
  check("a sibling key in the same section survived",
        after.storage.s3_bucket === "my-bucket", after.storage.s3_bucket);
  check("the email section survived", after.email.inbox_address === "me@example.com",
        after.email.inbox_address || "(empty)");
  check("the notifications section survived",
        after.notifications.digest_time === "07:30", after.notifications.digest_time);
  check("the profile section survived",
        Array.isArray(after.profile.citizenships) && after.profile.citizenships.includes("DE"),
        JSON.stringify(after.profile.citizenships));

  // And the same for a one-field profile edit.
  await call("PUT", "/api/settings", { profile: { age: 44 } });
  const after2 = await (await call("GET", "/api/settings")).json();
  check("the profile edit took effect", after2.profile.age === 44, String(after2.profile.age));
  check("the profile's other fields survived",
        Array.isArray(after2.profile.citizenships) && after2.profile.citizenships.includes("DE"),
        JSON.stringify(after2.profile.citizenships));
  check("storage still survived the profile edit",
        after2.storage.provider === "azure", after2.storage.provider);

  // The engine must see the merged profile, not a default.
  const eng = await (await call("GET", "/api/hackathons/profile")).json();
  check("the eligibility engine sees the merged profile",
        eng.age === 44 && eng.citizenships.includes("DE"),
        JSON.stringify(eng).slice(0, 80));
}

console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILED: " + f);
console.log("=".repeat(60));
process.exit(fail > 0 ? 1 : 0);
