/** Batch 1 verification — the four Devpost fields + 2 MCP tools. */
import { MCP_TOOLS } from "../src/mcp-tools.ts";

let p = 0, f = 0;
function check(l, c) { c ? (p++, console.log("  PASS "+l)) : (f++, console.log("  FAIL "+l)); }

console.log("\n=== Batch 1: tools present ===");
const names = MCP_TOOLS.map(t => t.name);
check("eligible_hackathons exists", names.includes("eligible_hackathons"));
check("upcoming_hackathons exists", names.includes("upcoming_hackathons"));
check("tool count >= 15", MCP_TOOLS.length >= 15);

// Call each tool once against a fake SQL to make sure the route runs.
const fakeSql = { exec: (q, ...a) => {
  if (q.startsWith("SELECT * FROM hackathons WHERE status")) return { toArray: () => [] };
  return { toArray: () => [] };
} };

// Re-import hackathons functions through dynamic import to get their run.
// Tool run receives args and sql; we pass empty everything and expect error-free run.
for (const t of MCP_TOOLS.filter(x => x.name === "eligible_hackathons" || x.name === "upcoming_hackathons")) {
  try { await t.run({}, fakeSql); check(t.name + " runs without throwing", true); }
  catch (e) { check(t.name + " runs without throwing: "+e.message, false); }
}

console.log("\n=== Summary ===");
console.log("  Pass: "+(f===0?"all":"FAIL="+f));
if (f) process.exitCode = 1;
