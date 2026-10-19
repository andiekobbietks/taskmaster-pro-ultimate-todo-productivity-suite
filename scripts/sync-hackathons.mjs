/**
 * sync-hackathons.mjs — pull live hackathon data into taskmaster-pro.
 *
 * Usage:
 *   node scripts/sync-hackathons.mjs --api http://localhost:8787
 *
 * Sources:
 *   - Devpost (scraped from hackathons page — no public API)
 *   - MLH events page
 *   - lablab.ai
 *
 * The script is idempotent: it upserts by (platform, external_id) so
 * re-running it updates deadlines and prizes without duplicating rows.
 */

const SOURCES = [
  {
    name: "devpost",
    url: "https://devpost.com/hackathons?open=true",
    // Devpost has no public API; this is a placeholder for a scraper.
    // For now, seed manually via the API or use the seed file.
    enabled: false,
  },
  {
    name: "mlh",
    url: "https://mlh.io/events",
    enabled: false,
  },
  {
    name: "lablab",
    url: "https://lablab.ai/ai-hackathons",
    enabled: false,
  },
];

async function sync(apiBase) {
  let created = 0;
  let updated = 0;

  for (const source of SOURCES) {
    if (!source.enabled) continue;
    console.log(`Syncing ${source.name}...`);
    // TODO: implement actual scraping per source
    // For now, this is a scaffold — the seed file provides initial data.
  }

  return { created, updated };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const apiIdx = args.indexOf("--api");
  const apiBase = apiIdx >= 0 ? args[apiIdx + 1] : "http://localhost:8787";

  sync(apiBase)
    .then((r) => {
      console.log(`Sync complete: ${r.created} created, ${r.updated} updated`);
    })
    .catch((err) => {
      console.error("Sync failed:", err);
      process.exit(1);
    });
}
