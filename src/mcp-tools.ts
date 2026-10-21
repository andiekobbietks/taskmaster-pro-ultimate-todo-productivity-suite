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
        "devpost.com/feed.rss - returns the homepage as HTML",
        "pipes.yahoo.com - does not resolve; Yahoo Pipes is gone",
        "query.yahooapis.com - does not resolve; YQL is gone",
      ],
    }, null, 2)
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
