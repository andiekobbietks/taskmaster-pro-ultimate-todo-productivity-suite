#!/usr/bin/env node
/**
 * dossier-fixture-json.mjs — generate a realistic dossier-data payload
 * without needing a running wrangler dev server.
 *
 * Runs the same Hono routes against an in-memory SQLite database so the
 * resulting JSON is identical to what the Worker would serve. Writes the
 * payload to dossier-input.json for scripts/build-dossier.py.
 */
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { makeSql } from "./do-sql.mjs";
import { SCHEMA } from "../src/schema.ts";
import { registerHackathonRoutes } from "../src/hackathons.ts";
import { registerInboxRoutes } from "../src/inbox.ts";
import { registerAttachmentRoutes } from "../src/attachments.ts";
import { registerDossierRoutes } from "../src/dossier-routes.ts";

const OUT = process.argv[2] || "dossier-input.json";

const db = new DatabaseSync(":memory:");
for (const statement of SCHEMA) db.exec(statement);
const sql = makeSql(db);

const app = new Hono();
app.get("/health", (c) => c.json({ status: "ok" }));
registerHackathonRoutes(app, sql);
registerInboxRoutes(app, sql);
registerAttachmentRoutes(app, sql);
registerDossierRoutes(app, sql);

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

async function assertOk(name, r) {
  if (r.status < 200 || r.status >= 300) {
    const text = await r.text();
    throw new Error(`${name} failed: HTTP ${r.status} ${text}`);
  }
  return r.json();
}

// 1. Profile
await assertOk(
  "PUT /api/hackathons/profile",
  await call("PUT", "/api/hackathons/profile", {
    citizenships: ["IT"],
    residencies: ["GB"],
    residency_status: "settled",
    age: 25,
    is_student: false,
    team_size: 1,
    employed_by_sponsor: false,
  }),
);

// 2. Hackathon
const hackathon = await assertOk(
  "POST /api/hackathons",
  await call("POST", "/api/hackathons", {
    name: "Build, Ship, Shape: Amazon Developer Hackathon",
    platform: "devpost",
    url: "https://amazon-hackathon.devpost.com/",
    prize: "$138,000",
    start_date: "2026-10-01",
    end_date: "2026-10-23",
    submission_deadline: "2026-10-23",
    status: "open",
    notes: "51k teams; unrestricted global eligibility; AWS credits included.",
    eligibility: { eligibility_type: "unrestricted", age_min: 18, regions: ["Global"] },
  }),
);

// 3. Linked emails
const emails = [
  {
    sender: "no-reply@devpost.com",
    subject: "Build, Ship, Shape: Amazon Developer Hackathon — registration confirmed",
    body_text:
      "Thanks for registering for the Amazon Developer Hackathon. Your team dashboard is ready.",
    body_html: "<p>Thanks for registering for the Amazon Developer Hackathon.</p>",
    has_attachments: false,
    attachment_names: [],
  },
  {
    sender: "updates@devpost.com",
    subject: "Amazon Developer Hackathon — deadline extended to 23 Oct",
    body_text:
      "The submission deadline has been extended. Make sure your project meets the AWS requirement.",
    body_html: "<p>Deadline extended.</p>",
    has_attachments: false,
    attachment_names: [],
  },
  {
    sender: "no-reply@devpost.com",
    subject: "Amazon Developer Hackathon — submission received",
    body_text:
      "We have received your project submission for the Build, Ship, Shape: Amazon Developer Hackathon.",
    body_html: "<p>Submission received.</p>",
    has_attachments: true,
    attachment_names: ["demo.mp4"],
  },
];

for (const email of emails) {
  await assertOk("POST /api/inbox", await call("POST", "/api/inbox", email));
}

// 4. Attachment deliverable
const form = new FormData();
form.append(
  "file",
  new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])], { type: "image/png" }),
  "submission-screenshot.png",
);
await assertOk(
  "POST /api/tickets/:id/attachments",
  await call("POST", `/api/tickets/${hackathon.id}/attachments`, form, true),
);

// 5. Dossier payload
const payload = await assertOk(
  "GET /api/hackathons/:id/dossier-data",
  await call("GET", `/api/hackathons/${hackathon.id}/dossier-data`),
);

writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`Wrote dossier payload to ${OUT}`);
console.log(`  hackathon: ${payload.title}`);
console.log(`  emails:    ${payload.emails.length}`);
console.log(`  artifacts: ${payload.artifacts.length}`);
console.log(`  master_sha256: ${payload.master_sha256}`);
