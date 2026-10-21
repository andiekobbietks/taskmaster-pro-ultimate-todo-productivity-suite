
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { makeSql } from "./do-sql.mjs";
import { registerHackathonRoutes } from "../src/hackathons.ts";
import { registerInboxRoutes, insertInboxItem } from "../src/inbox.ts";
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


console.log("\n=== 7. Reset clears the canonical profile too ===");
{
  // Put a distinctive profile in place.
  await call("PUT", "/api/settings", {
    profile: { citizenships: ["FR"], residencies: ["FR"], age: 61 },
  });
  const seeded = await (await call("GET", "/api/hackathons/profile")).json();
  check("the profile was written", seeded.age === 61, String(seeded.age));

  // Reset.
  const r = await call("POST", "/api/settings/reset");
  check("reset returns 200", r.status === 200, "HTTP " + r.status);

  const after = await (await call("GET", "/api/hackathons/profile")).json();
  check("the engine sees the default profile, not the old one",
    after.age !== 61 && !(after.citizenships || []).includes("FR"),
    JSON.stringify(after).slice(0, 80));

  const settings = await (await call("GET", "/api/settings")).json();
  check("the settings screen shows the same default profile",
    settings.profile.age === after.age,
    settings.profile.age + " vs " + after.age);
}


console.log("\n=== 8. The digest uses the real eligibility engine ===");
{
  // Profile: Italian citizen, living in the UK, 25.
  await call("PUT", "/api/settings/profile", {
    citizenships: ["IT"], residencies: ["GB"], residency_status: "settled",
    age: 25, is_student: false, team_size: 1, employed_by_sponsor: false,
  });

  // Two competitions with the same deadline and the same prize. One is open
  // to everyone; one needs a German passport.
  // A deadline five days out, so both competitions reach the week view.
  const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const mk = async (name, eligibility) => {
    const r = await call("POST", "/api/hackathons", {
      name, platform: "devpost", prize: "$10,000",
      start_date: soon, end_date: soon,
      submission_deadline: soon,
      eligibility,
    });
    return (await r.json()).id;
  };

  const openId = await mk("Open To Everyone", {
    eligibility_type: "unrestricted", regions: ["Global"], age_min: 13,
  });
  // REGIONS has no "DE" key, so this rule matches neither citizenship nor
  // region for an Italian citizen living in the UK.
  const germanId = await mk("German Passport Only", {
    eligibility_type: "citizenship", citizenships: ["DE"], regions: ["DE"], age_min: 13,
  });

  const priority = await (await call("GET", "/api/digest/priority")).json();
  const open = priority.find((p) => p.id === openId);
  const german = priority.find((p) => p.id === germanId);

  check("the digest lists both competitions", !!open && !!german);
  check("the open one is eligible", open && open.eligible === true,
        open ? open.qualification_path : "missing");
  check("the German-only one is not eligible", german && german.eligible === false,
        german ? JSON.stringify(german.reasons) : "missing");
  check("the ineligible one says why",
        german && Array.isArray(german.reasons) && german.reasons.length > 0,
        german ? String(german.reasons && german.reasons[0]).slice(0, 60) : "missing");
  check("the ineligible one scores lower",
        german && open && german.priority_score < open.priority_score,
        german && open ? german.priority_score + " vs " + open.priority_score : "missing");
  check("the path is not the hardcoded string",
        german && german.qualification_path !== "eligible (no restrictions)",
        german ? german.qualification_path : "missing");

  // The digest's own endpoint must agree with the priority endpoint.
  const digest = await (await call("GET", "/api/digest")).json();
  const digestUpcoming = (digest.upcoming_this_week || []).find((u) => u.hackathon_id === germanId);
  check("the digest agrees the German-only one is not eligible",
        digestUpcoming && digestUpcoming.eligible === false,
        digestUpcoming ? String(digestUpcoming.eligible) : "not in the week");

  // And the eligibility route must agree with both.
  const elig = await (await call("GET", "/api/hackathons/eligibility")).json();
  const eligGerman = elig.find((e) => e.hackathon && e.hackathon.id === germanId);
  check("the eligibility route agrees too",
        eligGerman && eligGerman.eligible === false,
        eligGerman ? String(eligGerman.eligible) : "missing");
}


console.log("\n=== 9. Mail ingestion ===");
{
  // 9a. With no server configured the route must say so, not crash.
  await call("PUT", "/api/settings", {
    email: { jmap_server_url: "", jmap_username: "", jmap_password: "" },
  });
  const noServer = await call("POST", "/api/inbox/fetch");
  check("fetching with no server configured is refused, not a crash",
        noServer.status === 400, "HTTP " + noServer.status);
  const noServerBody = await noServer.json();
  check("the refusal explains what to do",
        /configured/i.test(noServerBody.message || ""),
        (noServerBody.message || "").slice(0, 70));

  // 9b. With a server configured but unreachable, the error is reported.
  await call("PUT", "/api/settings", {
    email: {
      jmap_server_url: "http://127.0.0.1:1",
      jmap_username: "someone@example.com",
      jmap_password: "not-a-real-password",
    },
  });
  const unreachable = await call("POST", "/api/inbox/fetch");
  check("an unreachable server is reported, not swallowed",
        unreachable.status === 502, "HTTP " + unreachable.status);
  const unreachableBody = await unreachable.json();
  check("the failure names the cause",
        !!unreachableBody.error, (unreachableBody.error || "").slice(0, 60));

  // 9c. The insert deduplicates on a stable id.
  const message = {
    sender: "notifications@devpost.com",
    subject: "Deduplication check",
    body_text: "The same message, twice.",
  };
  const first = insertInboxItem(sql, message, "inbox-jmap-stable-test-1");
  check("the first insert is stored", first.inserted === true);
  const second = insertInboxItem(sql, message, "inbox-jmap-stable-test-1");
  check("the same stable id is not stored twice", second.inserted === false);

  const listed = await (await call("GET", "/api/inbox")).json();
  const copies = listed.filter((e) => e.subject === "Deduplication check");
  check("the inbox holds exactly one copy", copies.length === 1,
        copies.length + " copies");

  // 9d. Without a stable id each insert is its own row.
  const a = insertInboxItem(sql, message);
  const b = insertInboxItem(sql, message);
  check("without a stable id two inserts make two rows",
        a.inserted && b.inserted && a.id !== b.id, a.id + " / " + b.id);

  // 9e. The stored message is matched against the competitions.
  await call("POST", "/api/hackathons", {
    name: "Deduplication Check Competition",
    platform: "devpost",
    eligibility: { eligibility_type: "unrestricted", regions: ["Global"], age_min: 13 },
  });
  const matched = insertInboxItem(sql, {
    sender: "notifications@devpost.com",
    subject: "Deduplication Check Competition is open",
    body_text: "Deduplication Check Competition",
  });
  check("a message matching a competition name is linked to it",
        matched.inserted === true);
  const after = await (await call("GET", "/api/inbox")).json();
  const linked = after.find((e) => e.subject === "Deduplication Check Competition is open");
  check("the link points at the competition",
        linked && !!linked.ticket_id, linked ? String(linked.ticket_id) : "missing");

  // Clean up the rows this test created.
  for (const e of after) {
    if (e.subject && e.subject.startsWith("Deduplication Check")) {
      await call("DELETE", "/api/inbox/" + e.id);
    }
  }
}

console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILED: " + f);
console.log("=".repeat(60));
process.exit(fail > 0 ? 1 : 0);
