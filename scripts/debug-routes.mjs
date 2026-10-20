import { Hono } from "hono";
import { registerHackathonRoutes } from "../src/hackathons.ts";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE hackathons (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT DEFAULT 'manual', url TEXT DEFAULT '',
    description TEXT DEFAULT '', prize TEXT DEFAULT '', start_date TEXT DEFAULT NULL,
    end_date TEXT DEFAULT NULL, registration_deadline TEXT DEFAULT NULL,
    submission_deadline TEXT DEFAULT NULL, eligibility_json TEXT DEFAULT '{}',
    status TEXT DEFAULT 'open', notes TEXT DEFAULT '', created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);
  CREATE TABLE hackathon_profile (id TEXT PRIMARY KEY, profile_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
`);

const sql = {
  exec(text, ...params) {
    const stmt = db.prepare(text);
    if (params.length > 0) stmt.run(...params);
    return { toArray: () => stmt.all(), one: () => stmt.get() };
  },
};

const app = new Hono();
registerHackathonRoutes(app, sql);

// Ask Hono what routes it actually has
const routes = app.routes.map((r) => `${r.method} ${r.path}`);
console.log("=== registered routes ===");
for (const r of routes) console.log("  " + r);

console.log();
console.log("=== live calls ===");
for (const [method, path, body] of [
  ["GET", "/api/hackathons", null],
  ["POST", "/api/hackathons", { name: "Test Hack", platform: "devpost" }],
  ["GET", "/api/hackathons/eligibility", null],
  ["GET", "/api/hackathons/xyz", null],
]) {
  const init = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const r = await app.request(path, init);
  const text = await r.text();
  console.log("  %s %-32s -> %d  %s", method, path, r.status, text.slice(0, 70));
}
