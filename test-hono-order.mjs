// Minimal Hono reproduction: does a param route before a static route shadow it?
import { Hono } from "hono";

const a = new Hono();
a.get("/api/hackathons", (c) => c.json({ ok: "list" }));
a.get("/api/hackathons/:id", (c) => c.json({ ok: "one" }));
a.post("/api/hackathons", (c) => c.json({ ok: "create" }));

console.log("=== param route registered BEFORE static POST ===");
console.log("GET  /api/hackathons      ->", (await a.request("/api/hackathons")).status);
console.log("POST /api/hackathons      ->", (await a.request("/api/hackathons", { method: "POST" })).status);

const b = new Hono();
b.get("/api/hackathons", (c) => c.json({ ok: "list" }));
b.get("/api/hackathons/eligibility", (c) => c.json({ ok: "elig" }));
b.get("/api/hackathons/profile", (c) => c.json({ ok: "profile" }));
b.put("/api/hackathons/profile", (c) => c.json({ ok: "putprofile" }));
b.post("/api/hackathons", (c) => c.json({ ok: "create" }));
b.get("/api/hackathons/:id", (c) => c.json({ ok: "one" }));
b.patch("/api/hackathons/:id", (c) => c.json({ ok: "patch" }));
b.delete("/api/hackathons/:id", (c) => c.json({ ok: "delete" }));

console.log();
console.log("=== static routes registered BEFORE param route ===");
console.log("GET  /api/hackathons      ->", (await b.request("/api/hackathons")).status);
console.log("GET  /api/hackathons/elig ->", (await b.request("/api/hackathons/eligibility")).status);
console.log("GET  /api/hackathons/prof ->", (await b.request("/api/hackathons/profile")).status);
console.log("PUT  /api/hackathons/prof ->", (await b.request("/api/hackathons/profile", { method: "PUT" })).status);
console.log("POST /api/hackathons      ->", (await b.request("/api/hackathons", { method: "POST" })).status);
console.log("GET  /api/hackathons/xyz  ->", (await b.request("/api/hackathons/xyz")).status);
console.log("PATCH /api/hackathons/xyz ->", (await b.request("/api/hackathons/xyz", { method: "PATCH" })).status);
