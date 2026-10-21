
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

console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILED: " + f);
console.log("=".repeat(60));
process.exit(fail > 0 ? 1 : 0);
