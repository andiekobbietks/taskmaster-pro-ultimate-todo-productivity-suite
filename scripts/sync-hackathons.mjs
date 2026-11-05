/**
 * sync-hackathons.mjs — pull live hackathon data into taskmaster-pro.
 *
 * Usage:
 *   node scripts/sync-hackathons.mjs --api http://localhost:8787
 *
 * Sources:
 *   - Devpost  -> POST /api/devpost/import
 *   - MLH      -> POST /api/mlh/import
 *   - HackerEarth -> deliberately skipped (no keyless feed; endpoint returns 501)
 *
 * The script is idempotent: the server-side importers upsert by platform id,
 * so re-running it updates deadlines and prizes without duplicating rows.
 */

const SOURCES = [
  {
    name: "devpost",
    method: "POST",
    path: "/api/devpost/import",
    body: { pages: 2 },
    enabled: true,
  },
  {
    name: "mlh",
    method: "POST",
    path: "/api/mlh/import",
    body: { season: "2026" },
    enabled: true,
  },
  {
    name: "hackerearth",
    method: "POST",
    path: "/api/hackerearth/import",
    body: {},
    enabled: false,
    reason: "no known keyless JSON feed (server returns 501)",
  },
];

async function request(apiBase, path, token, body) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(apiBase.replace(/\/$/, "") + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, body: json };
}

async function sync(apiBase, token) {
  const results = [];

  for (const source of SOURCES) {
    if (!source.enabled) {
      console.log(`Skipping ${source.name}${source.reason ? " (" + source.reason + ")" : ""}`);
      continue;
    }
    console.log(`Syncing ${source.name}...`);
    const result = await request(apiBase, source.path, token, source.body);
    results.push({ name: source.name, ...result });
    if (!result.ok) {
      console.error(`  ${source.name} failed: HTTP ${result.status}`, result.body);
    } else {
      console.log(`  ${source.name} ok:`, result.body);
    }
  }

  return results;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const apiIdx = args.indexOf("--api");
  const apiBase = apiIdx >= 0 ? args[apiIdx + 1] : "http://localhost:8787";
  const tokenIdx = args.indexOf("--token");
  const token = tokenIdx >= 0 ? args[tokenIdx + 1] : process.env.API_TOKEN || "";

  sync(apiBase, token)
    .then((results) => {
      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      console.log(`\nSync complete: ${okCount} ok, ${failCount} failed`);
      if (failCount > 0) process.exit(1);
    })
    .catch((err) => {
      console.error("Sync failed:", err);
      process.exit(1);
    });
}
