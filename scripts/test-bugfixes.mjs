
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { SCHEMA } from "../src/schema.ts";
import { Hono } from "hono";
import { makeSql } from "./do-sql.mjs";
import { registerHackathonRoutes } from "../src/hackathons.ts";
import { registerInboxRoutes, insertInboxItem } from "../src/inbox.ts";
import { parseRawMail } from "../src/mime.ts";
import { registerAttachmentRoutes } from "../src/attachments.ts";
import { registerSettingsRoutes } from "../src/settings.ts";
import { registerCapacityRoutes } from "../src/capacity.ts";
import { registerArchiveRoutes } from "../src/archive.ts";
import { registerCaptureRoutes } from "../src/capture.ts";
import { registerMcpRoutes } from "../src/mcp-sdk.ts";
import { registerFeedRoutes } from "../src/feed-routes.ts";
import { registerDevpostRoutes } from "../src/devpost-routes.ts";
import { registerCalendarRoutes } from "../src/calendar-routes.ts";
import { registerPushRoutes } from "../src/push-routes.ts";
import { registerDigestRoutes } from "../src/digest-routes.ts";
import { buildRssFeed, parseFeed, findHackathonMentions } from "../src/feed.ts";
import { readWacz, findResponse, recordText } from "../src/wacz.ts";

const db = new DatabaseSync(":memory:");
for (const statement of SCHEMA) db.exec(statement);

const sql = makeSql(db);
const app = new Hono();
app.get("/health", (c) => c.json({ status: "ok", version: "1.2.0" }));
registerHackathonRoutes(app, sql);
registerInboxRoutes(app, sql);
registerAttachmentRoutes(app, sql);
registerSettingsRoutes(app, sql);
registerCapacityRoutes(app, sql);
registerArchiveRoutes(app, sql);
registerCaptureRoutes(app, sql);
registerMcpRoutes(app, sql);
registerFeedRoutes(app, sql);
registerDevpostRoutes(app, sql);
registerCalendarRoutes(app, sql);
registerPushRoutes(app, sql, undefined);
registerDigestRoutes(app, sql, undefined);

const call = (method, path, body, isForm, headers) => {
  const init = { method };
  if (isForm) init.body = body;
  else if (body instanceof Uint8Array) {
    // Raw bytes, for a file upload.
    init.body = body;
    init.headers = headers || {};
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
    // The MCP transport is spec-strict (2025-06-18): a POST without this
    // Accept header is answered HTTP 406. The lean server did not care.
    if (path.startsWith("/api/mcp")) {
      init.headers["Accept"] = "application/json, text/event-stream";
    }
  }
  return app.request(path, init);
};


/**
 * Build a WACZ in memory, so the tests do not need a file.
 */
function makeWacz(warcBytes) {
  // The zip is written by hand: a stored entry is enough, and it keeps the
  // test free of a dependency.
  const name = "archive/data.warc.gz";
  const data = gzipSync(Buffer.from(warcBytes));
  const crc = crc32(data);
  const nameBytes = Buffer.from(name, "utf8");

  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);          // stored
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  nameBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  // The local header is the first thing in the file, so its offset is zero.
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  // The central directory starts after the local header AND the file data.
  eocd.writeUInt32LE(local.length + data.length, 16);

  return new Uint8Array(Buffer.concat([local, data, central, eocd]));
}

/** The CRC-32 that a zip entry carries. */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

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


console.log("\n=== 10. The raw MIME parser, against a real message ===");
{
  // A real Devpost message, read through the Yahoo Mail API. It is
  // multipart/alternative, both parts quoted-printable, with a folded
  // header block and a Received chain.
  const raw = readFileSync(
    new URL("./fixtures/sample-raw-email.txt", import.meta.url), "utf8");

  const mail = parseRawMail(raw);
  check("the raw source parses", mail.ok === true, mail.error || "");

  check("the sender is the address, not the display name",
        mail.from === "support@devpost.com", mail.from);
  check("the display name is kept separately",
        mail.fromName === "Devpost", mail.fromName);
  check("the subject is the subject line",
        mail.subject === "Meet the Shipaton 2026 winners - RevenueCat Shipaton 2026",
        mail.subject);
  check("the recipient is read",
        mail.to === "andiekobbietks@outlook.com", mail.to);
  check("the date parses to a timestamp",
        mail.dateMs !== null && mail.dateMs > 0, String(mail.dateMs));
  check("the Message-Id is read",
        mail.messageId === "<20261021083212.563c9a8209281088@cio8.devpost.com>",
        mail.messageId);
  check("the Reply-To is read",
        /shipaton@revenuecat\.com/.test(mail.replyTo), mail.replyTo);

  // quoted-printable: the bytes and the soft breaks both have to be
  // handled, or the text comes out with =E2=86=92 in it.
  check("the text body is decoded",
        mail.textBody.includes("Hey Shippers!"), mail.textBody.slice(0, 60));
  check("the quoted-printable bytes are decoded",
        mail.textBody.includes("→"), "the arrow is missing");
  check("the quoted-printable bytes are decoded, part two",
        mail.textBody.includes("©"), "the copyright is missing");
  check("the soft line breaks are removed",
        !mail.textBody.includes("=\n") && !/=\s*$/.test(mail.textBody.split("\n")[0]),
        "a soft break survived");
  check("the words are not split by the soft breaks",
        mail.textBody.includes("last night at The Shippies"),
        "the sentence did not reassemble");
  check("the HTML part is decoded too",
        mail.htmlBody.includes("<!DOCTYPE html>"), mail.htmlBody.slice(0, 50));

  // The header block has a Received chain, so a header is a list.
  const received = mail.headers.filter((h) => h.name === "received");
  check("the repeated Received headers are all kept", received.length >= 3,
        received.length + " received headers");
  check("the header list is in order",
        mail.headers[0].name === "received", mail.headers[0].name);

  // The inbox takes the raw source directly.
  const r = await call("POST", "/api/inbox", { raw });
  const body = await r.json();
  check("the inbox accepts a raw source", r.status === 201 || r.status === 200,
        "HTTP " + r.status);
  check("the stored message has the sender",
        body.sender === "support@devpost.com", body.sender || "");
  check("the stored message has the subject",
        body.subject === "Meet the Shipaton 2026 winners - RevenueCat Shipaton 2026",
        body.subject || "");

  // The same message again must not be a second copy.
  const again = await call("POST", "/api/inbox", { raw });
  const againBody = await again.json();
  check("the same message is not stored twice",
        againBody.duplicate === true || again.status === 200,
        "HTTP " + again.status + " duplicate=" + againBody.duplicate);
  const inbox = await (await call("GET", "/api/inbox")).json();
  const copies = inbox.filter((e) => e.subject === mail.subject);
  check("the inbox holds one copy", copies.length === 1, copies.length + " copies");
}


console.log("\n=== 11. Reading a WACZ capture ===");
{
  const bytes = new Uint8Array(readFileSync(
    new URL("./fixtures/sample-capture.wacz", import.meta.url)));

  const archive = await readWacz(bytes);
  check("the zip is read", archive.records.length > 0 || archive.pages.length > 0);
  check("the page list is read", archive.pages.length === 1,
        archive.pages.length + " pages");
  check("the page URL is read",
        archive.pages[0].url === "https://devpost.com/hackathons/amazon-hackathon",
        archive.pages[0].url);
  check("the datapackage is read",
        archive.datapackage && archive.datapackage.profile === "wacz",
        archive.datapackage ? archive.datapackage.profile : "missing");

  check("the WARC records are parsed", archive.records.length === 1,
        archive.records.length + " records");
  const record = archive.records[0];
  check("the record is a response", record.type === "response", record.type);
  check("the record's URL is read",
        record.url === "https://devpost.com/hackathons/amazon-hackathon", record.url);
  check("the HTTP status is read", record.status === 200, String(record.status));
  check("the body is read", recordText(record).includes("Amazon Developer Hackathon"));

  // The lookup has to survive a URL that differs in the query string.
  const found = findResponse(archive.records,
    "https://devpost.com/hackathons/amazon-hackathon?utm=1");
  check("the response is found despite a different query", found !== null);

  // And the route has to accept the file.
  const r = await call("POST", "/api/archive/wacz", bytes, false,
    { "x-target-url": "https://devpost.com/hackathons/amazon-hackathon" });
  check("the route accepts a raw WACZ", r.status === 200, "HTTP " + r.status);
  const body = await r.json();
  check("the route reports the source", body.source === "wacz", body.source);
  check("the route counts the pages", body.pages_captured === 1,
        String(body.pages_captured));
  check("the route extracts the deadline",
        /November 18, 2026/.test(JSON.stringify(body.extracted || {})),
        JSON.stringify(body.extracted || {}).slice(0, 120));
  check("the route extracts the prize",
        /\$138,000/.test(JSON.stringify(body.extracted || {})),
        JSON.stringify(body.extracted || {}).slice(0, 120));
  check("the route returns the raw HTML for the compiler",
        typeof body.html === "string" && body.html.includes("<!doctype html>"),
        String(body.html).slice(0, 50));

  // Something that is not a zip has to be refused, not crash.
  const notAZip = await call("POST", "/api/archive/wacz",
    new Uint8Array([1, 2, 3, 4, 5]), false, {});
  check("a file that is not a zip is refused", notAZip.status === 400,
        "HTTP " + notAZip.status);
}


console.log("\n=== 12. The capture manifest and the jobs ===");
{
  // The manifest is settable through the settings API, and read back.
  await call("PUT", "/api/settings", {
    capture: {
      sources: [
        { url: "https://devpost.com/hackathons/alpha", name: "Alpha", enabled: true },
        { url: "https://devpost.com/hackathons/beta", name: "Beta", enabled: false },
      ],
      batch_size: 5,
      keep_archive: true,
      output_dir: "captures",
    },
  });

  const manifest = await (await call("GET", "/api/capture/manifest")).json();
  check("the manifest holds the sources", manifest.sources.length === 2,
        manifest.sources.length + " sources");
  check("the manifest keeps the names",
        manifest.sources[0].name === "Alpha", manifest.sources[0].name);
  check("the manifest keeps the batch size", manifest.batch_size === 5,
        String(manifest.batch_size));

  // Queueing the manifest skips the disabled sources.
  const queued = await (await call("POST", "/api/capture/jobs", { all: true })).json();
  check("queueing the manifest creates a job", queued.queued === 1,
        String(queued.queued));
  check("the disabled source was skipped",
        queued.created[0].source_url.includes("alpha"),
        queued.created[0].source_url);

  const queue = await (await call("GET", "/api/capture/queue")).json();
  check("the queue holds the job", queue.length === 1, queue.length + " jobs");
  check("the queue carries the output directory",
        queue[0].output_dir === "captures", queue[0].output_dir);

  // The same page is not queued twice.
  const again = await (await call("POST", "/api/capture/jobs", { all: true })).json();
  check("the same page is not queued twice",
        again.created[0].already === true, JSON.stringify(again.created[0]));

  // The runner reports back.
  const jobId = queue[0].id;
  const result = await (await call("POST", "/api/capture/jobs/" + jobId + "/result", {
    status: "done", wacz_size: 1234, extracted: { deadline: "November 18, 2026" },
  })).json();
  check("the result is accepted", result.ok === true, JSON.stringify(result));

  const job = await (await call("GET", "/api/capture/jobs/" + jobId)).json();
  check("the job is done", job.status === "done", job.status);
  check("the job kept the size", job.wacz_size === 1234, String(job.wacz_size));
  check("the job kept what was extracted",
        job.extracted && job.extracted.deadline === "November 18, 2026",
        JSON.stringify(job.extracted));

  // A job that does not exist.
  const missing = await call("GET", "/api/capture/jobs/nope");
  check("an unknown job is a 404", missing.status === 404, "HTTP " + missing.status);
}

console.log("\n=== 13. The Yahoo application ===");
{
  // With nothing set up, the test says what is missing rather than failing.
  await call("PUT", "/api/settings", {
    email: { yahoo_client_id: "", yahoo_client_secret: "", yahoo_refresh_token: "" },
  });
  const r = await call("POST", "/api/settings/test-yahoo");
  check("testing with no credentials is refused, not a crash",
        r.status === 400, "HTTP " + r.status);
  const body = await r.json();
  check("the refusal says what is needed",
        /client id/i.test(body.message || ""), (body.message || "").slice(0, 70));

  // With nonsense credentials, the failure is reported, not swallowed.
  await call("PUT", "/api/settings", {
    email: {
      yahoo_client_id: "not-a-real-client-id",
      yahoo_client_secret: "not-a-real-secret",
      yahoo_refresh_token: "not-a-real-token",
    },
  });
  const bad = await call("POST", "/api/settings/test-yahoo");
  check("bad credentials are reported", bad.status === 400, "HTTP " + bad.status);
  const badBody = await bad.json();
  check("the failure names the cause",
        Boolean(badBody.message), (badBody.message || "").slice(0, 80));

  // The settings hold the values, and the secret ones are not handed back
  // in the clear.
  const settings = await (await call("GET", "/api/settings")).json();
  check("the client id is kept", settings.email.yahoo_client_id === "not-a-real-client-id",
        settings.email.yahoo_client_id);
  check("the client secret is not handed back in the clear",
        settings.email.yahoo_client_secret !== "not-a-real-secret",
        "the secret came back in the clear");
  check("the refresh token is not handed back in the clear",
        settings.email.yahoo_refresh_token !== "not-a-real-token",
        "the token came back in the clear");
}


console.log("\n=== 14. The archive extraction on real page shapes ===");
{
  // A page that publishes JSON-LD, which is the common case.
  const withLd = `<!doctype html><html><head>
<script type="application/ld+json">
{"@type":"Event","name":"Amazon Developer Hackathon",
 "startDate":"2026-10-01","endDate":"2026-11-18",
 "description":"Open to all developers."}
</script></head><body><h1>Amazon Developer Hackathon</h1></body></html>`;

  // A page that only says it in prose.
  const prose = `<html><body>
  <p>Submissions close November 18, 2026 at 11:59pm.</p>
  <p>There is $138,000 in prizes.</p>
  <p>Open to all developers, anywhere.</p>
  <p>Submission format: a GitHub repository and a video demo.</p>
  </body></html>`;

  // A page whose JavaScript mentions the word "rules". It must not end up
  // as an eligibility rule.
  const noisy = `<html><head>
  <script>var Rules = {length: 2}; function deleteRule(x){ Rules.length ? x.deleteRule(x) : 0 }</script>
  <style>.rules { color: red }</style>
  </head><body><p>Nothing here.</p></body></html>`;

  const ld = await call("POST", "/api/archive/wacz", { raw: null });
  void ld;

  // The extraction is exercised through the route, with a WACZ built from
  // each page.
  const build = async (html) => {
    const http = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" + html;
    const head = "WARC/1.0\r\nWARC-Type: response\r\nWARC-Date: 2026-10-21T08:32:12Z\r\n" +
      "WARC-Record-ID: <urn:uuid:1>\r\nWARC-Target-URI: https://example.com/x\r\n" +
      "Content-Type: application/http; msgtype=response\r\n" +
      "Content-Length: " + http.length + "\r\n\r\n";
    const warc = head + http + "\r\n\r\n";
    const zip = await makeWacz(warc);
    const r = await call("POST", "/api/archive/wacz", zip, false, {
      "x-target-url": "https://example.com/x",
    });
    return r;
  };

  const a = await build(withLd);
  const aBody = await a.json();
  check("the JSON-LD name is read", aBody.extracted?.name === "Amazon Developer Hackathon",
        aBody.extracted?.name || "(none)");
  check("the JSON-LD end date is the deadline",
        aBody.extracted?.deadline === "2026-11-18", aBody.extracted?.deadline || "(none)");
  check("the JSON-LD start date is read",
        aBody.extracted?.start_date === "2026-10-01", aBody.extracted?.start_date || "(none)");

  const b = await build(prose);
  const bBody = await b.json();
  check("a deadline in prose is read",
        /November 18, 2026/.test(bBody.extracted?.deadline || ""),
        bBody.extracted?.deadline || "(none)");
  check("a prize in prose is read",
        bBody.extracted?.prize === "$138,000", bBody.extracted?.prize || "(none)");
  check("an eligibility line is read",
        /all developers/i.test(bBody.extracted?.eligibility || ""),
        (bBody.extracted?.eligibility || "").slice(0, 60));
  check("the submission format is read",
        /GitHub/i.test(bBody.extracted?.submission_format || ""),
        (bBody.extracted?.submission_format || "").slice(0, 60));

  const c = await build(noisy);
  const cBody = await c.json();
  check("a rule is not read out of the JavaScript",
        !/deleteRule|Rules\.length/.test(cBody.extracted?.eligibility || ""),
        (cBody.extracted?.eligibility || "(nothing)").slice(0, 70));
}


console.log("\n=== 15. The app as an MCP server ===");
{
  // The protocol is JSON-RPC 2.0 over one HTTP POST.
  const rpc = async (method, params, id) => {
    const body = { jsonrpc: "2.0", method };
    if (params !== undefined) body.params = params;
    if (id !== undefined) body.id = id;
    const r = await call("POST", "/api/mcp", body);
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };

  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "test", version: "1" },
  }, 1);
  check("initialize answers", init.status === 200, "HTTP " + init.status);
  check("it names the protocol version",
        init.body?.result?.protocolVersion === "2025-06-18",
        init.body?.result?.protocolVersion || "(none)");
  check("it names the server",
        init.body?.result?.serverInfo?.name === "taskmaster-pro",
        JSON.stringify(init.body?.result?.serverInfo || {}));
  check("it advertises the tools capability",
        !!init.body?.result?.capabilities?.tools);

  const list = await rpc("tools/list", {}, 2);
  const tools = list.body?.result?.tools || [];
  check("the tool list is served", tools.length >= 8, tools.length + " tools");
  const names = tools.map((t) => t.name);
  for (const expected of ["list_competitions", "list_inbox", "search_inbox",
                           "capture_manifest", "add_to_manifest", "capture_all",
                           "capture_status", "fetch_mail", "get_settings"]) {
    check("there is a " + expected + " tool", names.includes(expected));
  }
  check("every tool has a schema",
        tools.every((t) => t.inputSchema && t.inputSchema.type === "object"));

  // Calling a tool.
  await call("POST", "/api/hackathons", {
    name: "MCP Test Competition", platform: "devpost", prize: "$1,000",
    eligibility: { eligibility_type: "unrestricted", regions: ["Global"], age_min: 13 },
  });

  const call1 = await rpc("tools/call",
    { name: "list_competitions", arguments: { limit: 5 } }, 3);
  const text = call1.body?.result?.content?.[0]?.text || "";
  check("list_competitions answers", call1.status === 200, "HTTP " + call1.status);
  check("it finds the competition", text.includes("MCP Test Competition"),
        text.slice(0, 80));
  check("it carries the eligibility verdict", text.includes("eligible"),
        text.slice(0, 120));

  // The manifest, and adding to it.
  const before = await rpc("tools/call", { name: "capture_manifest", arguments: {} }, 4);
  const beforeText = before.body?.result?.content?.[0]?.text || "";
  const beforeCount = JSON.parse(beforeText).sources.length;

  const added = await rpc("tools/call", {
    name: "add_to_manifest",
    arguments: { url: "https://devpost.com/hackathons/mcp-test" },
  }, 5);
  check("add_to_manifest answers", added.status === 200, "HTTP " + added.status);

  const after = await rpc("tools/call", { name: "capture_manifest", arguments: {} }, 6);
  const afterText = after.body?.result?.content?.[0]?.text || "";
  const afterSources = JSON.parse(afterText).sources;
  check("the manifest grew", afterSources.length === beforeCount + 1,
        beforeCount + " -> " + afterSources.length);
  check("the page is in it",
        afterSources.some((s) => s.url === "https://devpost.com/hackathons/mcp-test"));

  // Queueing the manifest.
  const queued = await rpc("tools/call", { name: "capture_all", arguments: {} }, 7);
  const queuedText = queued.body?.result?.content?.[0]?.text || "";
  const queuedJson = JSON.parse(queuedText);
  check("capture_all queues the manifest", queuedJson.queued >= 1,
        String(queuedJson.queued));

  const status = await rpc("tools/call", { name: "capture_status", arguments: {} }, 8);
  const statusText = status.body?.result?.content?.[0]?.text || "";
  check("capture_status reports the job",
        statusText.includes("mcp-test"), statusText.slice(0, 100));

  // A notification gets no reply.
  const note = await call("POST", "/api/mcp", {
    jsonrpc: "2.0", method: "notifications/initialized",
  });
  check("a notification gets no body", note.status === 202, "HTTP " + note.status);

  // An unknown tool is an error, not a crash.
  const unknown = await rpc("tools/call", { name: "no_such_tool", arguments: {} }, 9);
  check("an unknown tool is an error",
        unknown.body?.result?.isError === true, JSON.stringify(unknown.body).slice(0, 80));

  // A batch.
  const batchBody = [
    { jsonrpc: "2.0", id: 20, method: "ping" },
    { jsonrpc: "2.0", id: 21, method: "tools/list" },
  ];
  const batch = await call("POST", "/api/mcp", batchBody);
  const replies = JSON.parse(await batch.text());
  check("a batch gets one reply per message", replies.length === 2, replies.length + " replies");

  // Clean up.
  const hs = await (await call("GET", "/api/hackathons")).json();
  for (const h of hs) {
    if (h.name === "MCP Test Competition") await call("DELETE", "/api/hackathons/" + h.id);
  }
}


console.log("\n=== 16. Feeds, in both directions ===");
{
  // --- Writing ---------------------------------------------------------
  await call("POST", "/api/hackathons", {
    name: "Feed Test Competition", platform: "devpost", prize: "$25,000",
    url: "https://devpost.com/hackathons/feed-test",
    submission_deadline: "2026-12-01",
    eligibility: { eligibility_type: "unrestricted", regions: ["Global"], age_min: 13 },
  });

  const feedResp = await call("GET", "/api/feed.xml");
  const xml = await feedResp.text();
  check("the feed is served", feedResp.status === 200, "HTTP " + feedResp.status);
  check("it is XML", xml.includes("<rss version=\"2.0\">"), xml.slice(0, 40));
  check("it has the competition", xml.includes("Feed Test Competition"));
  check("it carries the deadline", xml.includes("2026-12-01"));
  check("it carries the prize", xml.includes("$25,000"));
  check("it carries the verdict", xml.includes("eligible"));
  check("it has a guid", /<guid[^>]*>hack-/.test(xml));

  // The XML has to be well formed, or a reader will reject it.
  let wellFormed = true;
  try {
    // A rough check: every opened tag is closed.
    const opened = (xml.match(/<item>/g) || []).length;
    const closed = (xml.match(/<\/item>/g) || []).length;
    wellFormed = opened === closed && opened > 0;
  } catch {
    wellFormed = false;
  }
  check("the items balance", wellFormed);

  // --- Reading ---------------------------------------------------------
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Regional Tech</title>
    <link>https://example.com</link>
    <item><title>Amazon Developer Hackathon is open</title>
      <link>https://example.com/amazon</link>
      <description>Registration closes soon, prize money to be won.</description>
      <pubDate>Wed, 21 Oct 2026 08:32:12 GMT</pubDate></item>
    <item><title>Some other news</title><link>https://example.com/other</link>
      <description>Unrelated, about a shopping sale.</description></item>
  </channel></rss>`;

  const parsed = parseFeed(rss);
  check("the RSS title is read", parsed.title === "Regional Tech", parsed.title);
  check("the RSS has two items", parsed.items.length === 2, parsed.items.length + " items");
  check("the item title is read",
        parsed.items[0].title === "Amazon Developer Hackathon is open",
        parsed.items[0].title);
  check("the item link is read",
        parsed.items[0].link === "https://example.com/amazon", parsed.items[0].link);
  check("the description is stripped of tags",
        !parsed.items[0].description.includes("<"), parsed.items[0].description.slice(0, 40));

  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <title>Atom Feed</title>
    <entry><title>An entry about a hackathon</title>
      <link href="https://example.com/atom-entry"/>
      <summary>Something for a hackathon</summary>
      <updated>2026-10-21T08:32:12Z</updated></entry>
  </feed>`;
  const parsedAtom = parseFeed(atom);
  check("the Atom format is detected", parsedAtom.format === "atom", parsedAtom.format);
  check("the Atom entry is read", parsedAtom.items.length === 1, parsedAtom.items.length + "");
  check("the Atom link is read",
        parsedAtom.items[0].link === "https://example.com/atom-entry",
        parsedAtom.items[0].link);

  const mentions = findHackathonMentions(parsed);
  check("the hackathon item is found", mentions.length === 1, mentions.length + " matches");
  check("the other item is not",
        !mentions.some((m) => m.title === "Some other news"));
  check("an unrelated word does not match",
        findHackathonMentions(parseFeed(rss.replace(/hackathon/gi, "shopping")))
          .length === 0);

  // The route needs a url, and it has to be http.
  const noUrl = await call("POST", "/api/feed/fetch", {});
  check("a missing url is refused", noUrl.status === 400, "HTTP " + noUrl.status);
  const badScheme = await call("POST", "/api/feed/fetch", { url: "file:///etc/passwd" });
  check("a non-http url is refused", badScheme.status === 400, "HTTP " + badScheme.status);

  // Clean up.
  const hs = await (await call("GET", "/api/hackathons")).json();
  for (const h of hs) {
    if (h.name === "Feed Test Competition") await call("DELETE", "/api/hackathons/" + h.id);
  }
}

console.log("\n=== 17. Devpost, as a data source ===");
{
  // Canned payload shaped like the real endpoint's answer, so the suite
  // never touches the internet.
  const canned = {
    hackathons: [
      { id: 30992, title: "Build, Ship, Shape: Amazon Developer Hackathon",
        url: "https://amazonappdev2026.devpost.com/", open_state: "open",
        prize_amount: "$<span data-currency-value>138,000</span>",
        themes: [{ name: "Machine Learning/AI" }, { name: "Productivity" }],
        registrations_count: 60896, invite_only: false, winners_announced: false,
        organization_name: "Amazon", submission_period_dates: "Aug 31 - Oct 23, 2026" },
      { id: 31302, title: "PayPal AI Hackathon",
        url: "https://paypalaihackathon.devpost.com/", open_state: "open",
        prize_amount: "$<span data-currency-value>50,000</span>",
        themes: [{ name: "Machine Learning/AI" }],
        registrations_count: 18004, invite_only: false, winners_announced: false,
        organization_name: "PayPal", submission_period_dates: "Oct 01 - Nov 12, 2026" },
    ],
  };
  // parseSubmissionPeriod, on its own: the honest parser.
  const { parseSubmissionPeriod } = await import("../src/devpost.ts");
  check("period 'Aug 31 - Oct 23, 2026' parses",
        JSON.stringify(parseSubmissionPeriod("Aug 31 - Oct 23, 2026"))
        === '{"start":"2026-08-31","end":"2026-10-23"}',
        JSON.stringify(parseSubmissionPeriod("Aug 31 - Oct 23, 2026")));
  check("a yearless first date borrows the year",
        JSON.stringify(parseSubmissionPeriod("Oct 01 - Nov 12, 2026"))
        === '{"start":"2026-10-01","end":"2026-11-12"}',
        JSON.stringify(parseSubmissionPeriod("Oct 01 - Nov 12, 2026")));
  check("dateless text parses to nulls, never a wrong date",
        JSON.stringify(parseSubmissionPeriod("sometime soon"))
        === '{"start":null,"end":null}',
        JSON.stringify(parseSubmissionPeriod("sometime soon")));
  check("a same-month range 'Oct 05 - 27, 2026' borrows the month",
        JSON.stringify(parseSubmissionPeriod("Oct 05 - 27, 2026"))
        === '{"start":"2026-10-05","end":"2026-10-27"}',
        JSON.stringify(parseSubmissionPeriod("Oct 05 - 27, 2026")));
  check("a range that spans two years parses both sides",
        JSON.stringify(parseSubmissionPeriod("Jul 16, 2026 - Jan 15, 2027"))
        === '{"start":"2026-07-16","end":"2027-01-15"}',
        JSON.stringify(parseSubmissionPeriod("Jul 16, 2026 - Jan 15, 2027")));

  const realFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async (url) => {
    asked++;
    return { ok: true, json: async () => canned };
  };
  let r;
  try {
    r = await call("POST", "/api/devpost/import", { pages: 1 });
  } finally {
    globalThis.fetch = realFetch;
  }

  const body = await r.json();
  check("the import route answers 200", r.status === 200, "HTTP " + r.status);
  check("it imported two competitions", body.imported === 2, JSON.stringify(body));
  check("the endpoint was actually called", asked >= 1, asked + " calls");

  const hs = (await (await call("GET", "/api/hackathons")).json())
    .filter((h) => h.platform === "devpost");
  const amazon = hs.find((h) => h.url === "https://amazonappdev2026.devpost.com/");
  check("the Amazon competition exists", !!amazon, JSON.stringify(hs.map(h => h.url)));
  check("the prize is plain text, no span markup",
        amazon?.prize === "$138,000", amazon?.prize || "(none)");
  check("the submission period parsed into dates",
        amazon?.start_date === "2026-08-31" && amazon?.end_date === "2026-10-23",
        (amazon?.start_date || "?") + " .. " + (amazon?.end_date || "?"));
  check("the id is stable, from the platform id",
        amazon?.id === "hack-devpost-30992", amazon?.id || "(none)");

  // A second import must update, not duplicate.
  let r2;
  const realFetch2 = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => canned });
    r2 = await call("POST", "/api/devpost/import", { pages: 1 });
  } finally {
    globalThis.fetch = realFetch2;
  }
  const body2 = await r2.json();
  const count = (await (await call("GET", "/api/hackathons")).json())
    .filter((h) => String(h.id).startsWith("hack-devpost-")).length;
  check("a re-import updates its own rows",
        body2.updated === 2 && body2.imported === 0, JSON.stringify(body2));
  check("no duplicates were created", count === 2, count + " devpost rows");
  check("import_devpost is advertised as a tool",
        (await rpcListToolNames()).includes("import_devpost"));
}

// The MCP tools/list helper, for the check above.
async function rpcListToolNames() {
  const r = await call("POST", "/api/mcp", { jsonrpc: "2.0", id: 99, method: "tools/list" });
  return (await r.json()).result.tools.map((t) => t.name);
}

console.log("\n=== 18. The calendar ===");
{
  // A competition to put on a calendar.
  await call("POST", "/api/hackathons", {
    name: "Calendar Test Hackathon",
    platform: "devpost",
    prize: "$2,500",
    url: "https://example.com/calendar-test",
    start_date: "2026-09-01",
    end_date: "2026-10-15",
    eligibility: { eligibility_type: "unrestricted", regions: ["Global"], age_min: 13 },
  });

  // --- The simple JSON list -----------------------------------------
  const simple = await (await call("GET", "/api/hackathons/simple")).json();
  const one = simple.find((h) => h.title === "Calendar Test Hackathon");
  check("the simple list is served", Array.isArray(simple), simple.length + " rows");
  check("the competition is in the simple list", !!one, JSON.stringify(simple.map(h => h.title)));
  check("the simple list has exactly the promised fields",
        one && Object.keys(one).sort().join(",") === "eligibility,end,id,prize,start,title,url",
        one ? Object.keys(one).sort().join(",") : "(none)");
  check("the title is the name", one?.title === "Calendar Test Hackathon", one?.title || "(none)");
  check("the start date is carried", one?.start === "2026-09-01", one?.start || "(none)");
  check("the end date is carried", one?.end === "2026-10-15", one?.end || "(none)");
  check("the prize is carried", one?.prize === "$2,500", one?.prize || "(none)");
  check("the eligibility is carried", one?.eligibility === "unrestricted", one?.eligibility || "(none)");

  // --- The iCal feed -------------------------------------------------
  const ics = await call("GET", "/api/calendar.ics");
  const body = await ics.text();
  check("the calendar feed answers 200", ics.status === 200, "HTTP " + ics.status);
  check("it is served as a calendar",
        (ics.headers.get("content-type") || "").includes("text/calendar"),
        ics.headers.get("content-type") || "(none)");
  check("it opens as a VCALENDAR", body.startsWith("BEGIN:VCALENDAR"), body.slice(0, 40));
  check("it closes as a VCALENDAR", body.trim().endsWith("END:VCALENDAR"), body.slice(-40));
  check("it has a version", body.includes("VERSION:2.0"));
  check("it has a product id", body.includes("PRODID:"));
  check("the lines are CRLF, as the format requires", body.includes("\r\n"));
  check("it carries the competition", body.includes("Calendar Test Hackathon"));
  check("it carries the start date", body.includes("DTSTART:20260901"), "DTSTART missing");
  check("it carries the end date", body.includes("DTEND:20261015"), "DTEND missing");
  check("it carries the url", body.includes("URL:https://example.com/calendar-test"));
  check("every event is closed", (body.match(/BEGIN:VEVENT/g) || []).length ===
        (body.match(/END:VEVENT/g) || []).length, "unbalanced events");
  check("the timestamp is a proper UTC stamp",
        /DTSTAMP:\d{8}T\d{6}Z/.test(body),
        (body.match(/DTSTAMP:[^\r\n]*/) || ["(none)"])[0]);
  check("the uid is not doubled",
        !body.includes("UID:hack-hack-"),
        (body.match(/UID:[^\r\n]*/) || ["(none)"])[0]);
  check("every uid is unique",
        (() => {
          const uids = body.match(/UID:[^\r\n]*/g) || [];
          return new Set(uids).size === uids.length;
        })(),
        "duplicate uids");

  // --- The download --------------------------------------------------
  const dl = await call("GET", "/api/calendar/export.ics");
  check("the download answers 200", dl.status === 200, "HTTP " + dl.status);
  check("it is a download",
        (dl.headers.get("content-disposition") || "").includes("attachment"),
        dl.headers.get("content-disposition") || "(none)");

  // --- The methods the wizard reads ----------------------------------
  const methods = await (await call("GET", "/api/calendar/methods")).json();
  const ids = (methods.methods || []).map((m) => m.id);
  check("the wizard is told the four methods",
        ["subscribe", "download", "graph", "caldav"].every((i) => ids.includes(i)),
        ids.join(","));
  const experimental = (methods.methods || []).filter((m) => m.stable === false);
  check("the push methods are marked experimental", experimental.length === 2,
        experimental.map((m) => m.id).join(","));
  check("the subscribe method is stable",
        (methods.methods || []).find((m) => m.id === "subscribe")?.stable === true);

  // --- The push, which is not finished --------------------------------
  const noPush = await call("POST", "/api/calendar/push", { method: "subscribe" });
  check("subscribe is refused as a push method", noPush.status === 400, "HTTP " + noPush.status);

  const graph = await call("POST", "/api/calendar/push", { method: "graph" });
  const graphBody = await graph.json();
  check("the graph push says it is not wired up", graph.status === 501, "HTTP " + graph.status);
  check("it says so honestly", graphBody.experimental === true, JSON.stringify(graphBody).slice(0, 80));
  check("it still shows what would be pushed", graphBody.would_push >= 1, graphBody.would_push);
  check("it names what is missing", typeof graphBody.missing === "string" && graphBody.missing.length > 20);

  // Clean up.
  const hs = await (await call("GET", "/api/hackathons")).json();
  for (const h of hs) {
    if (h.name === "Calendar Test Hackathon") await call("DELETE", "/api/hackathons/" + h.id);
  }
}

console.log("\n=== 19. Web push ===");
{
  // The harness app has no VAPID keys, so the routes have to say so
  // rather than pretend.
  const key = await call("GET", "/api/push/key");
  const keyBody = await key.json();
  check("the key route answers when there are no keys", key.status === 503, "HTTP " + key.status);
  check("it says what is missing",
        typeof keyBody.message === "string" && keyBody.message.includes("VAPID"),
        JSON.stringify(keyBody).slice(0, 80));

  const status = await call("GET", "/api/push/status");
  const statusBody = await status.json();
  check("the status route answers", status.status === 200, "HTTP " + status.status);
  check("it reports that no keys are set", statusBody.keys_configured === false, JSON.stringify(statusBody));
  check("it counts the subscriptions", typeof statusBody.count === "number", statusBody.count);

  // A subscription needs an endpoint and both keys.
  const noKeys = await call("POST", "/api/push/subscribe", { endpoint: "https://example.com/push" });
  check("a subscription without keys is refused", noKeys.status === 400, "HTTP " + noKeys.status);

  const notHttps = await call("POST", "/api/push/subscribe", {
    endpoint: "http://example.com/push",
    keys: { p256dh: "abc", auth: "def" },
  });
  check("a subscription that is not https is refused", notHttps.status === 400, "HTTP " + notHttps.status);

  // A real-looking one is stored.
  const endpoint = "https://updates.push.services.mozilla.com/wpush/v2/" + "a".repeat(40);
  const sub = await call("POST", "/api/push/subscribe", {
    endpoint,
    keys: { p256dh: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
  });
  check("a subscription is accepted", sub.status === 200, "HTTP " + sub.status);
  const afterSub = await (await call("GET", "/api/push/status")).json();
  check("the subscription is counted", afterSub.count === 1, JSON.stringify(afterSub));

  // The same one again does not double up.
  await call("POST", "/api/push/subscribe", {
    endpoint,
    keys: { p256dh: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
  });
  const afterAgain = await (await call("GET", "/api/push/status")).json();
  check("the same subscription is not counted twice", afterAgain.count === 1, JSON.stringify(afterAgain));

  // The endpoint is a secret: it must not come back out.
  check("the endpoint is never returned",
        !JSON.stringify(afterAgain).includes(endpoint), "the endpoint leaked");

  // With no keys set, a test push cannot be sent, and it says so.
  const noPush = await call("POST", "/api/push/test");
  check("a test push without keys is refused", noPush.status === 503, "HTTP " + noPush.status);

  // Unsubscribing removes it.
  const unsub = await call("POST", "/api/push/unsubscribe", { endpoint });
  check("a subscription can be removed", unsub.status === 200, "HTTP " + unsub.status);
  const afterUnsub = await (await call("GET", "/api/push/status")).json();
  check("it is gone", afterUnsub.count === 0, JSON.stringify(afterUnsub));
}

console.log("\n=== 20. The reader's time zone ===");
{
  // The profile carries the zone, so the digest and the "today" filter
  // know where the reader is.
  const saved = await call("PUT", "/api/hackathons/profile", {
    citizenships: ["IT"], residencies: ["GB"], residency_status: "settled",
    age: 25, is_student: false, team_size: 1, employed_by_sponsor: false,
    timezone: "Asia/Kolkata",
  });
  const savedBody = await saved.json();
  check("a profile with a time zone is accepted", saved.status === 200, "HTTP " + saved.status);
  check("the zone is kept", savedBody.timezone === "Asia/Kolkata", savedBody.timezone);

  const read = await (await call("GET", "/api/hackathons/profile")).json();
  check("the zone survives a round trip", read.timezone === "Asia/Kolkata", read.timezone);

  // A zone the runtime does not know is refused, not stored.
  const bad = await call("PUT", "/api/hackathons/profile", {
    citizenships: ["IT"], residencies: ["GB"], residency_status: "settled",
    age: 25, is_student: false, team_size: 1, employed_by_sponsor: false,
    timezone: "Mars/Olympus_Mons",
  });
  const badBody = await bad.json();
  check("an unknown zone is refused", badBody.timezone !== "Mars/Olympus_Mons", badBody.timezone);
  check("and the stored one is kept", badBody.timezone === "Asia/Kolkata", badBody.timezone);

  // The reader's clock, in their own zone.
  const time = await (await call("GET", "/api/time")).json();
  check("the time route answers", typeof time.local_time === "string", JSON.stringify(time));
  check("it names the zone", time.timezone === "Asia/Kolkata", time.timezone);
  check("it says the zone is valid", time.zone_is_valid === true, JSON.stringify(time));
  check("it gives the offset in minutes", time.offset_minutes === 330, time.offset_minutes);
  check("it gives the local date", /^\d{4}-\d{2}-\d{2}$/.test(time.local_date), time.local_date);
  check("it gives the local time", /^\d{2}:\d{2}$/.test(time.local_time), time.local_time);

  // The digest preview, in the reader's zone.
  const preview = await (await call("GET", "/api/digest/preview")).json();
  check("the digest preview answers", typeof preview.title === "string", JSON.stringify(preview).slice(0, 90));
  check("it names the reader's date", preview.date === time.local_date, preview.date + " vs " + time.local_date);
  check("it has a body", typeof preview.body === "string" && preview.body.length > 0, preview.body);
  check("it lists what is closing", Array.isArray(preview.closing), JSON.stringify(preview.closing).slice(0, 60));

  // The send is honest when there is nothing to send it to.
  const send = await call("POST", "/api/digest/send");
  const sendBody = await send.json();
  check("the send route answers", send.status === 200, "HTTP " + send.status);
  check("it did not pretend to send", sendBody.sent === false, JSON.stringify(sendBody).slice(0, 90));
  check("it says why", typeof sendBody.why === "string" && sendBody.why.length > 0, sendBody.why);

  // Put the profile back the way it was.
  await call("PUT", "/api/hackathons/profile", {
    citizenships: ["IT"], residencies: ["GB"], residency_status: "settled",
    age: 25, is_student: false, team_size: 1, employed_by_sponsor: false,
    timezone: "Europe/Dublin",
  });
}

console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILED: " + f);
console.log("=".repeat(60));
process.exit(fail > 0 ? 1 : 0);
