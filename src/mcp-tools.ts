/*
 * The MCP tools, defined once.
 *
 * Two servers use them:
 *
 *   src/mcp.ts       the lean one, which ships. The protocol is implemented
 *                    by hand, so the bundle stays small.
 *   src/mcp-sdk.ts   the one built on the official SDK, for when the full
 *                    transport is wanted.
 *
 * The schemas are zod, because the SDK takes zod and zod can emit JSON
 * Schema too, so there is one definition rather than two that drift.
 */
import { z } from "zod";
import { readSettings } from "./settings.ts";
import { readProfile } from "./profile.ts";
import { evaluateEligibility, type EligibilityRules } from "./hackathons.ts";
import { fetchNewMail } from "./mail.ts";
import { buildRssFeed, readFeed } from "./feed.ts";
import { ingestDevpost } from "./devpost.ts";

export interface McpTool {
  name: string;
  description: string;
  /** The zod shape, for the SDK */
  shape: z.ZodRawShape;
  /** The same thing as JSON Schema, for the lean server */
  jsonSchema: Record<string, unknown>;
  run: (args: any, sql: any) => Promise<string>;
}

/**
 * Build a tool from a zod shape.
 */
function tool(
  name: string,
  description: string,
  shape: z.ZodRawShape,
  run: McpTool["run"]
): McpTool {
  return {
    name,
    description,
    shape,
    jsonSchema: z.toJSONSchema(z.object(shape), { io: "input" }) as any,
    run,
  };
}

function safeJson(value: any): any {
  try {
    return typeof value === "string" ? JSON.parse(value || "{}") : (value ?? {});
  } catch {
    return {};
  }
}

/**
 * Does a location string match what the reader asked for?
 *
 * Devpost writes locations free-hand: "Dublin, Ireland", "London, GB",
 * "Online". The reader asks for "Dublin", "GB" or "UK". Three rules
 * cover it:
 *
 *   1. The query appears in the location ("dublin" in "dublin, ireland").
 *   2. A two-letter query is matched as a whole word, not as a
 *      fragment — "gb" must not match "middgbrough".
 *   3. "UK" and "United Kingdom" both mean "GB".
 */
export function locationMatches(location: string, query: string): boolean {
  const loc = String(location || "").toLowerCase().trim();
  const q = String(query || "").toLowerCase().trim();
  if (!q) return true;
  if (!loc) return false;
  if (loc.includes(q)) return true;

  // Rule 3: the UK's spellings.
  const ukAliases = ["uk", "united kingdom", "great britain", "england", "scotland", "wales", "ni"];
  const qIsUk = ukAliases.includes(q);
  const locIsUk = ukAliases.some((a) => new RegExp("(^|[^a-z])" + a + "([^a-z]|$)").test(loc));
  if (qIsUk && (locIsUk || loc.includes("gb") || loc.includes("great britain"))) return true;
  if ((q === "gb" || q === "gb") && (locIsUk || loc.includes("gb"))) return true;

  // Rule 2: a two-letter code as a whole word.
  if (q.length === 2) {
    return new RegExp("(^|[^a-z])" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z]|$)").test(loc);
  }
  return false;
}

export const MCP_TOOLS: McpTool[] = [
  tool(
    "list_competitions",
    "List the competitions being tracked, with their prize, deadline, eligibility " +
      "verdict and status.",
    {
      status: z.string().optional().describe("Filter by status, e.g. open"),
      limit: z.number().optional().describe("How many to return. Default 50."),
    },
    async (args, sql) => {
      const limit = Math.min(Number(args.limit) || 50, 200);
      const status = args.status ? String(args.status) : null;
      const rows = status
        ? sql.exec("SELECT * FROM hackathons WHERE status = ? ORDER BY created_at DESC LIMIT ?", status, limit).toArray()
        : sql.exec("SELECT * FROM hackathons ORDER BY created_at DESC LIMIT ?", limit).toArray();

      const profile = readProfile(sql);
      const competitions = rows.map((r: any) => {
        const rules = safeJson(r.eligibility_json) as EligibilityRules;
        const verdict = evaluateEligibility(rules || ({} as any), profile);
        return {
          id: r.id,
          name: r.name,
          platform: r.platform,
          prize: r.prize,
          deadline: r.submission_deadline || r.end_date,
          status: r.status,
          url: r.url,
          eligible: verdict.eligible,
          qualification_path: verdict.qualification_path,
          reasons: verdict.reasons,
        };
      });
      return JSON.stringify({ count: competitions.length, competitions }, null, 2);
    }
  ),

  tool(
    "get_competition",
    "One competition, with its full detail and its eligibility verdict.",
    { id: z.string().describe("The competition id") },
    async (args, sql) => {
      const rows = sql.exec("SELECT * FROM hackathons WHERE id = ?", String(args.id)).toArray();
      if (rows.length === 0) return JSON.stringify({ error: "No such competition" });
      const r = rows[0];
      const profile = readProfile(sql);
      const verdict = evaluateEligibility(
        (safeJson(r.eligibility_json) || {}) as EligibilityRules, profile);
      return JSON.stringify({
        ...r,
        eligibility: safeJson(r.eligibility_json),
        eligible: verdict.eligible,
        qualification_path: verdict.qualification_path,
        reasons: verdict.reasons,
      }, null, 2);
    }
  ),

  tool(
    "list_inbox",
    "The most recent messages, with the competition each was linked to.",
    {
      limit: z.number().optional().describe("How many to return. Default 20."),
      unread_only: z.boolean().optional().describe("Only the unread ones."),
    },
    async (args, sql) => {
      const limit = Math.min(Number(args.limit) || 20, 100);
      const rows = args.unread_only
        ? sql.exec("SELECT id, sender, subject, received_at, read, processed, ticket_id, platform FROM inbox WHERE read = 0 ORDER BY received_at DESC LIMIT ?", limit).toArray()
        : sql.exec("SELECT id, sender, subject, received_at, read, processed, ticket_id, platform FROM inbox ORDER BY received_at DESC LIMIT ?", limit).toArray();
      return JSON.stringify({ count: rows.length, messages: rows }, null, 2);
    }
  ),

  tool(
    "search_inbox",
    "Search the inbox for a word in the subject, the sender or the body.",
    {
      query: z.string().describe("What to look for"),
      limit: z.number().optional().describe("How many to return. Default 25."),
    },
    async (args, sql) => {
      const q = "%" + String(args.query) + "%";
      const limit = Math.min(Number(args.limit) || 25, 100);
      const rows = sql.exec(
        "SELECT id, sender, subject, received_at, ticket_id FROM inbox " +
        "WHERE subject LIKE ? OR sender LIKE ? OR body_preview LIKE ? " +
        "ORDER BY received_at DESC LIMIT ?", q, q, q, limit).toArray();
      return JSON.stringify({ query: args.query, count: rows.length, messages: rows }, null, 2);
    }
  ),

  tool(
    "capture_manifest",
    "The pages in the capture manifest - the list the capture runs through.",
    {},
    async (_args, sql) => {
      const capture = readSettings(sql).capture || {};
      return JSON.stringify({
        sources: capture.sources || [],
        batch_size: capture.batch_size ?? 10,
        output_dir: capture.output_dir || "captures",
      }, null, 2);
    }
  ),

  tool(
    "add_to_manifest",
    "Add a page to the capture manifest, so it gets captured with everything " +
      "else. The capture is a WACZ archive: the traffic that made the page, " +
      "not a picture of it.",
    {
      url: z.string().describe("The page to capture"),
      name: z.string().optional().describe("A name for it"),
    },
    async (args, sql) => {
      const settings = readSettings(sql);
      const capture = settings.capture || { sources: [] };
      const sources = [...(capture.sources || [])];
      const url = String(args.url);
      const entry = { url, name: args.name ? String(args.name) : url, enabled: true, follow: 0 };
      const at = sources.findIndex((s: any) => s.url === url);
      if (at >= 0) sources[at] = entry;
      else sources.push(entry);
      await saveCapture(sql, { ...capture, sources });
      return JSON.stringify({ ok: true, sources: sources.length, added: url }, null, 2);
    }
  ),

  tool(
    "capture_all",
    "Queue every page in the manifest for capture. A capture needs a browser, " +
      "so the runner has to be running to pick the queue up; the app records " +
      "the job either way.",
    {},
    async (_args, sql) => {
      const settings = readSettings(sql);
      const manifest = (settings.capture?.sources || []).filter((s: any) => s.enabled !== false && s.url);
      if (manifest.length === 0) {
        return JSON.stringify({ ok: false, message: "The manifest is empty." });
      }
      const batch = settings.capture?.batch_size ?? 10;
      const created: any[] = [];
      for (const source of manifest.slice(0, batch)) {
        const existing = sql.exec(
          "SELECT id FROM capture_jobs WHERE source_url = ? AND status IN ('queued','running')",
          source.url).toArray();
        if (existing.length > 0) {
          created.push({ id: existing[0].id, source_url: source.url, already: true });
          continue;
        }
        const id = "cap-" + Date.now().toString(36) + "-" +
          Math.random().toString(36).slice(2, 8);
        const ts = Date.now();
        sql.exec(
          "INSERT INTO capture_jobs (id, source_url, name, status, created_at, updated_at) " +
          "VALUES (?, ?, ?, 'queued', ?, ?)",
          id, source.url, source.name || source.url, ts, ts).toArray();
        created.push({ id, source_url: source.url });
      }
      return JSON.stringify({
        ok: true, queued: created.length, jobs: created,
        note: "The runner picks these up and posts the archives back.",
      }, null, 2);
    }
  ),

  tool(
    "capture_status",
    "The captures the app is tracking, with what each one found.",
    {},
    async (_args, sql) => {
      const rows = sql.exec("SELECT * FROM capture_jobs ORDER BY created_at DESC LIMIT 50").toArray();
      return JSON.stringify({
        count: rows.length,
        jobs: rows.map((r: any) => ({
          id: r.id, source_url: r.source_url, name: r.name, status: r.status,
          wacz_size: r.wacz_size, extracted: safeJson(r.extracted_json), error: r.error,
        })),
      }, null, 2);
    }
  ),

  tool(
    "fetch_mail",
    "Pull new mail now, over the Yahoo Mail API or JMAP, whichever is " +
      "configured. Returns how many messages arrived and how many were new.",
    {},
    async (_args, sql) => {
      const result = await fetchNewMail(sql);
      return JSON.stringify(result, null, 2);
    }
  ),

  tool(
    "feed_competitions",
    "The competitions being tracked, as an RSS 2.0 document. This is the " +
      "app's own feed: anything can subscribe to it.",
    {},
    async (_args, sql) => {
      const rows = sql.exec(
        "SELECT * FROM hackathons WHERE status = 'open' ORDER BY created_at DESC LIMIT 100"
      ).toArray();
      const profile = readProfile(sql);
      const items = rows.map((r: any) => {
        const verdict = evaluateEligibility(
          (safeJson(r.eligibility_json) || {}) as EligibilityRules, profile);
        const deadline = r.submission_deadline || r.end_date;
        return {
          title: r.name,
          link: r.url || "",
          description: [
            r.platform,
            deadline ? "closes " + deadline : "",
            r.prize ? "prize " + r.prize : "",
            verdict.eligible ? verdict.qualification_path
              : "not eligible: " + verdict.reasons.join("; "),
          ].filter(Boolean).join(" · "),
          pubDate: new Date(Number(r.created_at) || Date.now()).toUTCString(),
          guid: r.id,
        };
      });
      return buildRssFeed(
        "TaskMaster Pro — competitions being tracked",
        "The hackathons and competitions tracked in this TaskMaster Pro instance.",
        "", items);
    }
  ),

  tool(
    "read_feed",
    "Read an RSS or Atom feed and pull the items that mention a hackathon. " +
      "There is no feed that lists hackathons, but the regional tech-news " +
      "feeds mention them.",
    {
      url: z.string().describe("The feed to read"),
      keywords: z.array(z.string()).optional()
        .describe("Words that mark an item as being about a hackathon"),
    },
    async (args) => {
      const url = String(args.url || "");
      if (!/^https?:\/\//i.test(url)) {
        return JSON.stringify({ ok: false, message: "The feed url must be http or https" });
      }
      return JSON.stringify(await readFeed(url, args.keywords), null, 2);
    }
  ),

  tool(
    "known_feeds",
    "The feeds that are known to work for finding hackathons, by region, and " +
      "the ones that are dead.",
    {},
    async () => JSON.stringify({
      feeds: [
        { url: "https://techcabal.com/feed/", region: "Africa" },
        { url: "https://www.gadget.co.za/feed/", region: "South Africa" },
        { url: "https://analyticsindiamag.com/feed", region: "India" },
        { url: "https://yourstory.com/feed", region: "India" },
        { url: "https://ec.europa.eu/commission/presscorner/api/rss?language=en", region: "EU" },
        { url: "https://hnrss.org/frontpage", region: "Global" },
      ],
      dead: [
        "devpost.com/feed.rss - returns the homepage as HTML (but see " +
          "import_devpost: their SPA's JSON API is open)",
        "pipes.yahoo.com - does not resolve; Yahoo Pipes is gone",
        "query.yahooapis.com - does not resolve; YQL is gone",
      ],
    }, null, 2)
  ),

  tool(
    "import_devpost",
    "Pull every open hackathon straight from Devpost's listing API into " +
      "the competitions table. Devpost has no feed and no documented API, " +
      "but the JSON their own page calls answers to anyone. Idempotent: " +
      "re-importing updates rows instead of duplicating them.",
    {
      pages: z.number().optional()
        .describe("How many pages to pull. 40 per page; default 2 covers all open."),
    },
    async (args, sql) => {
      const requested = Number(args?.pages) || 2;
      const pages = Math.max(1, Math.min(requested, 8));
      const result = await ingestDevpost(sql, { pages });
      return JSON.stringify(result, null, 2);
    }
  ),

  tool(
    "eligible_hackathons",
    "The open competitions the user's profile makes them eligible for, with " +
      "prize, deadline, qualification path and reasons.",
    {
      limit: z.number().optional().describe("How many. Default 20."),
      featured_only: z.boolean().optional().describe("Only featured events."),
    },
    async (args, sql) => {
      const profile = readProfile(sql);
      const limit = Math.min(Number(args.limit) || 20, 200);
      const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open'").toArray();
      const eligible = [];
      for (const r of rows) {
        if (args.featured_only && !r.featured) continue;
        const rules = safeJson(r.eligibility_json) as EligibilityRules;
        const v = evaluateEligibility(rules || ({} as any), profile);
        if (!v.eligible) continue;
        eligible.push({
          id: r.id, name: r.name, prize: r.prize,
          deadline: r.submission_deadline || r.end_date,
          eligible: true,
          qualification_path: v.qualification_path,
          reasons: v.reasons,
          displayed_location: r.displayed_location || "",
          prizes_counts: r.prizes_counts || "",
          featured: !!r.featured,
        });
      }
      return JSON.stringify({ count: eligible.length, competitions: eligible.slice(0, limit) }, null, 2);
    }
  ),

  tool(
    "high_prize_hackathons",
    "Open competitions with a prize at or above a threshold, sorted by prize value. " +
      "Requires Batch 1's prizes_counts field.",
    {
      min_prize: z.string().optional().describe("Minimum prize value, e.g. 5000 or $5,000"),
      featured_only: z.boolean().optional(),
      limit: z.number().optional(),
    },
    async (args, sql) => {
      const profile = readProfile(sql);
      const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open'").toArray();
      const results = [];
      for (const r of rows) {
        if (args.featured_only && !r.featured) continue;
        const rules = safeJson(r.eligibility_json) || {};
        const eligible = evaluateEligibility(rules, profile);
        if (!eligible.eligible) continue;
        const prizeCount = (String(r.prizes_counts || r.prize || "").match(/[\d,]+/g) || [""])[0].replace(/,/g, "");
        const value = Number(prizeCount) || 0;
        if (args.min_prize) {
          const minStr = String(args.min_prize).replace(/[$,\s]/g, "");
          const minVal = Number(minStr) || 0;
          if (value < minVal) continue;
        }
        results.push({
          id: r.id, name: r.name, prize: r.prize,
          prizes_counts: r.prizes_counts || "", prize_value: value,
          deadline: r.submission_deadline || r.end_date,
          featured: !!r.featured,
          eligible: true,
        });
      }
      return JSON.stringify({ count: results.length, competitions: results.slice(0, Math.min(Number(args.limit) || 20, 100)) }, null, 2);
    }
  ),

  tool(
    "competitions_near_me",
    "Open competitions whose displayed_location matches a region or query, " +
      "eligible for the user's profile.",
    {
      location: z.string().optional().describe("Location filter, e.g. Dublin or GB"),
      featured_only: z.boolean().optional(),
      limit: z.number().optional(),
    },
    async (args, sql) => {
      const profile = readProfile(sql);
      const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open'").toArray();
      const results = [];
      const q = String(args.location || "").trim();
      for (const r of rows) {
        if (args.featured_only && !r.featured) continue;
        const rules = safeJson(r.eligibility_json) || {};
        const eligible = evaluateEligibility(rules, profile);
        if (!eligible.eligible) continue;
        const loc = String(r.displayed_location || "").toLowerCase();
        if (q && !locationMatches(loc, q)) continue;
        results.push({
          id: r.id, name: r.name, prize: r.prize,
          displayed_location: r.displayed_location || "",
          deadline: r.submission_deadline || r.end_date,
          eligible: true,
          qualification_path: eligible.qualification_path,
        });
      }
      return JSON.stringify({ count: results.length, competitions: results.slice(0, Math.min(Number(args.limit) || 20, 100)) }, null, 2);
    }
  ),

  tool(
    "closing_soon",
    "Open competitions closing within a number of days, ordered by closest deadline. " +
      "Requires Batch 1's time_left_to_submission.",
    {
      days: z.number().optional().describe("Within how many days. Default 14."),
      featured_only: z.boolean().optional(),
      limit: z.number().optional(),
    },
    async (args, sql) => {
      const profile = readProfile(sql);
      const days = Math.min(Number(args.days) || 14, 90);
      const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open'").toArray();
      const results = [];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + days);
      for (const r of rows) {
        if (args.featured_only && !r.featured) continue;
        const rules = safeJson(r.eligibility_json) || {};
        const eligible = evaluateEligibility(rules, profile);
        if (!eligible.eligible) continue;
        const dlStr = r.submission_deadline || r.end_date;
        if (!dlStr) continue;
        const dl = new Date(dlStr);
        if (dl > cutoff) continue;
        results.push({
          id: r.id, name: r.name, prize: r.prize,
          deadline: String(dlStr).slice(0, 10),
          time_left_to_submission: r.time_left_to_submission ?? null,
          featured: !!r.featured,
          eligible: true,
        });
      }
      results.sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
      return JSON.stringify({ count: results.length, competitions: results.slice(0, Math.min(Number(args.limit) || 20, 100)) }, null, 2);
    }
  ),

  tool(
    "upcoming_hackathons",
    "The open competitions closing soon, ordered by deadline, with prize, " +
      "location, featured flag and time left.",
    {
      days: z.number().optional().describe("Within how many days. Default 14."),
      featured_only: z.boolean().optional().describe("Only featured events."),
    },
    async (args, sql) => {
      const profile = readProfile(sql);
      const days = Math.min(Number(args.days) || 14, 90);
      const cutoff = Date.now() + days * 86400000;
      const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open'").toArray();
      const upcoming = [];
      for (const r of rows) {
        const dl = r.submission_deadline || r.end_date || r.start_date;
        if (!dl) continue;
        const ts = new Date(String(dl)).getTime();
        if (ts > cutoff) continue;
        if (args.featured_only && !r.featured) continue;
        upcoming.push({
          id: r.id, name: r.name, prize: r.prize,
          deadline: String(dl).slice(0, 10),
          displayed_location: r.displayed_location || "",
          prizes_counts: r.prizes_counts || "",
          featured: !!r.featured,
          time_left_to_submission: r.time_left_to_submission ?? null,
        });
      }
      upcoming.sort((a, b) => (new Date(a.deadline).getTime() - new Date(b.deadline).getTime()));
      return JSON.stringify({ count: upcoming.length, competitions: upcoming }, null, 2);
    }
  ),

  tool(
    "get_settings",
    "The settings, with the sensitive values masked. The profile is the one " +
      "the eligibility engine reads.",
    {},
    async (_args, sql) => {
      const settings = readSettings(sql);
      for (const section of Object.values(settings)) {
        if (section && typeof section === "object" && !Array.isArray(section)) {
          for (const [key, value] of Object.entries(section as any)) {
            if (typeof value === "string" && /password|secret|token|key/i.test(key) && value) {
              (section as any)[key] = "********";
            }
          }
        }
      }
      return JSON.stringify(settings, null, 2);
    }
  ),
];

/**
 * Write the capture section back, the same way the settings route does.
 */
export async function saveCapture(sql: any, capture: any): Promise<void> {
  const settings = readSettings(sql);
  const merged = { ...settings, capture };
  const rows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
  const current = rows.length > 0 ? safeJson(rows[0].value) : {};
  current["capture"] = merged.capture;
  const ts = Date.now();
  sql.exec(
    "INSERT INTO settings (key, value, updated_at) VALUES ('main', ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?",
    JSON.stringify(current), ts, JSON.stringify(current), ts).toArray();
}
