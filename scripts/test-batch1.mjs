/** Batch 1 + Batch 2 verification — 4 Devpost fields, 5 MCP tools, filters. */
import { MCP_TOOLS, locationMatches } from "../src/mcp-tools.ts";

let p = 0, f = 0;
function check(l, c) { c ? (p++, console.log("  PASS "+l)) : (f++, console.log("  FAIL "+l)); }

console.log("\n=== Tools present ===");
const names = MCP_TOOLS.map(t => t.name);
for (const n of ["eligible_hackathons", "upcoming_hackathons",
                 "high_prize_hackathons", "competitions_near_me", "closing_soon"]) {
  check(n + " exists", names.includes(n));
}
check("tool count >= 18", MCP_TOOLS.length >= 18);

console.log("\n=== Location matching ===");
check("exact city match", locationMatches("Dublin, Ireland", "Dublin"));
check("country code whole word", locationMatches("London, GB", "GB"));
check("gb does not match mid-word", !locationMatches("Middgbrough, UK", "gb"));
check("uk alias matches uk location", locationMatches("London, UK", "UK"));
check("uk alias matches gb location", locationMatches("London, GB", "UK"));
check("united kingdom matches gb", locationMatches("London, GB", "United Kingdom"));
check("no match returns false", !locationMatches("Berlin, Germany", "Dublin"));
check("empty location does not match", !locationMatches("", "Dublin"));
check("empty query matches all", locationMatches("Berlin, Germany", ""));

console.log("\n=== Each new tool runs ===");
const fakeSql = { exec: () => ({ toArray: () => [] }) };
const newTools = ["eligible_hackathons", "upcoming_hackathons", "high_prize_hackathons",
                  "competitions_near_me", "closing_soon"];
for (const t of MCP_TOOLS.filter(x => newTools.includes(x.name))) {
  try { await t.run({}, fakeSql); check(t.name + " runs", true); }
  catch (e) { check(t.name + " runs: " + e.message, false); }
}

console.log("\n=== Parameters are dynamic ===");
for (const t of MCP_TOOLS.filter(x => newTools.includes(x.name))) {
  const props = Object.keys(t.jsonSchema?.properties || {});
  check(t.name + " exposes params: " + props.join(", "), props.length > 0);
}
const hi = MCP_TOOLS.find(x => x.name === "high_prize_hackathons");
check("high_prize_hackathons has min_prize", "min_prize" in (hi.jsonSchema?.properties || {}));
const cs = MCP_TOOLS.find(x => x.name === "closing_soon");
check("closing_soon has days", "days" in (cs.jsonSchema?.properties || {}));
const nm = MCP_TOOLS.find(x => x.name === "competitions_near_me");
check("competitions_near_me has location", "location" in (nm.jsonSchema?.properties || {}));

console.log("\n=== Summary ===");
console.log("  Pass: "+(f===0?"all":"FAIL="+f));
if (f) process.exitCode = 1;
