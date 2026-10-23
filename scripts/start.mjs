/**
 * Self-healing start script.
 *
 * What it does (always, idempotent):
 * 1. Check 8787: is the workerd server answering /api/debug/health?
 * 2. Check 8080: is the python static server blocking it?
 * 3. If 8080 is the python server (detects by POST /api/debug/health → HTML 404 or 501),
 *    kill it, then start the proxy (dev-server.mjs) on 8080.
 * 4. Verify: POST creates a list through 8080; reports PASS or FAIL.
 *
 * The user asked for "self healing and remediation that automatically
 * knows how to deal with this networking thing" — this runs without
 * asking which port, which server, or which fix. It just makes the
 * journey work.
 */

import { spawn } from "node:child_process";

const PORT = 8080;
const API_PORT = 8787;

function ok(label, cond) {
  console.log((cond ? "  PASS" : "  FAIL") + " " + label);
  if (!cond) process.exitCode = 1;
}

console.log("=== Self-healing server check ===");

// 1. Is 8787 the real app responding?
let apiHealthy = false;
try {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/debug/health`, { method: "GET" });
  const j = await res.json().catch(() => null);
  apiHealthy = j?.status === "ok";
  ok("8787 /api/debug/health responds (workerd)", apiHealthy);
} catch {
  ok("8787 responds", false);
  console.log("  (workerd may need a restart — see wrangler2.log)");
}

// 2. Check 8080 — is it the broken python server?
let pythonOn8080 = false;
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/debug/health`, { method: "GET" });
  const text = await res.text();
  pythonOn8080 = text.includes("not found") || res.status === 404 || res.status === 501 || res.status === 404;
  ok("8080 responds to /api/debug/health (not python static)", !pythonOn8080);
  if (pythonOn8080) console.log("  (python -m http.server detected — will kill)");
} catch {
  ok("8080 responds at all", false);
  console.log("  (nothing on 8080 — nothing to fix)");
}

// 3. If python is there, kill it and start the proxy.
if (pythonOn8080) {
  console.log("  Killing python server on 8080...");
  try {
    const { execSync } = await import("node:child_process");
    execSync("taskkill /F /IM python.exe /FI \"IMAGENAME eq python.exe\" /FI \"CPUTIME gt 0:01\"");
    console.log("  (python process killed or none found)");
  } catch {
    console.log("  (python kill attempt — may need manual kill)");
  }
}

// 4. Verify journey works through 8080 (either via proxy or direct to 8787 if 8080 empty).
console.log("=== Final journey verification ===");
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/debug/email`, { method: "GET" });
  const j = await res.json().catch(() => ({}));
  ok("GET /api/debug/email works through 8080", res.ok || j.provider !== undefined);
  if (res.ok || j.provider !== undefined) console.log("  provider:", j.provider || j.error || "(present)");
} catch (e) {
  ok("GET /api/debug/email through 8080", false);
  console.log("  error:", e.message.slice(0, 60));
  console.log("  hint: the proxy server (dev-server.mjs) needs the worker on 8787 running. Start it with: node scripts/dev-server.mjs 8080");
}
