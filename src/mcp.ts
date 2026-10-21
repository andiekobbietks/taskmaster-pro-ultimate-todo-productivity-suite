/**
 * The app, as an MCP server.
 *
 * MCP is a protocol, not a tool. The point of speaking it here is that the
 * app becomes the server: anything that speaks MCP — Claude Desktop,
 * Cursor, VS Code, an agent, a script — can connect to the deployed app
 * and work with the competitions, the inbox and the capture queue, with
 * no sidecar and nothing to install.
 *
 * The protocol is implemented here rather than pulled in, because the
 * official SDK drags express, hono/node-server, jose and ajv behind it
 * and bundles to 385 KB. A stateless JSON-RPC server over one HTTP POST
 * is a few hundred lines, and the app's dependency tree stays at three
 * packages.
 *
 * The transport is Streamable HTTP, stateless: a POST carries one
 * JSON-RPC message, and the reply is the JSON-RPC response.
 */

import { Hono } from "hono";
import { readSettings } from "./settings.ts";
import { readProfile } from "./profile.ts";
import { evaluateEligibility, type EligibilityRules } from "./hackathons.ts";
import { fetchNewMail } from "./mail.ts";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "taskmaster-pro", version: "1.3.1" };

// ── Tools ─────────────────────────────────────────────────────────────

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: any, sql: any) => Promise<string>;
}

const TOOLS: Tool[] = [
  {
    name: "list_competitions",
    description:
      "List the competitions being tracked, with their prize, deadline, eligibility " +
      "verdict and status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status, e.g. open" },
        limit: { type: "number", description: "How many to return. Default 50." },
      },
    },
    run: async (args, sql) => {
      const limit = Math.min(Number(args.limit) || 50, 200);
      const status = args.status ? String(args.status) : null;
      const rows = status
        ? sql.exec("SELECT * FROM hackathons WHERE status = ? ORDER BY created_at DESC LIMIT ?", status, limit).toArray()
        : sql.exec("SELECT * FROM hackathons ORDER BY created_at DESC LIMIT ?", limit).toArray();

      const profile = readProfile(sql);
      const out = rows.map((r: any) => {
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
      return JSON.stringify({ count: out.length, competitions: out }, null, 2);
    },
  },
  {
    name: "get_competition",
    description: "One competition, with its full detail and its eligibility verdict.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The competition id" } },
      required: ["id"],
    },
    run: async (args, sql) => {
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
    },
  },
  {
    name: "list_inbox",
    description: "The most recent messages, with the competition each was linked to.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many to return. Default 20." },
        unread_only: { type: "boolean" },
      },
    },
    run: async (args, sql) => {
      const limit = Math.min(Number(args.limit) || 20, 100);
      const rows = args.unread_only
        ? sql.exec("SELECT id, sender, subject, received_at, read, processed, ticket_id, platform FROM inbox WHERE read = 0 ORDER BY received_at DESC LIMIT ?", limit).toArray()
        : sql.exec("SELECT id, sender, subject, received_at, read, processed, ticket_id, platform FROM inbox ORDER BY received_at DESC LIMIT ?", limit).toArray();
      return JSON.stringify({ count: rows.length, messages: rows }, null, 2);
    },
  },
  {
    name: "search_inbox",
    description: "Search the inbox for a word in the subject, the sender or the body.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    run: async (args, sql) => {
      const q = "%" + String(args.query) + "%";
      const limit = Math.min(Number(args.limit) || 25, 100);
      const rows = sql.exec(
        "SELECT id, sender, subject, received_at, ticket_id FROM inbox " +
        "WHERE subject LIKE ? OR sender LIKE ? OR body_preview LIKE ? " +
        "ORDER BY received_at DESC LIMIT ?", q, q, q, limit).toArray();
      return JSON.stringify({ query: args.query, count: rows.length, messages: rows }, null, 2);
    },
  },
  {
    name: "capture_manifest",
    description:
      "The pages in the capture manifest - the list the capture runs through.",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, sql) => {
      const capture = readSettings(sql).capture || {};
      return JSON.stringify({
        sources: capture.sources || [],
        batch_size: capture.batch_size ?? 10,
        output_dir: capture.output_dir || "captures",
      }, null, 2);
    },
  },
  {
    name: "add_to_manifest",
    description:
      "Add a page to the capture manifest, so it gets captured with everything " +
      "else. The capture is a WACZ archive: the traffic that made the page, " +
      "not a picture of it.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The page to capture" },
        name: { type: "string", description: "A name for it" },
      },
      required: ["url"],
    },
    run: async (args, sql) => {
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
    },
  },
  {
    name: "capture_all",
    description:
      "Queue every page in the manifest for capture. A capture needs a browser, " +
      "so the runner has to be running to pick the queue up; the app records " +
      "the job either way.",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, sql) => {
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
    },
  },
  {
    name: "capture_status",
    description: "The captures the app is tracking, with what each one found.",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, sql) => {
      const rows = sql.exec("SELECT * FROM capture_jobs ORDER BY created_at DESC LIMIT 50").toArray();
      return JSON.stringify({
        count: rows.length,
        jobs: rows.map((r: any) => ({
          id: r.id, source_url: r.source_url, name: r.name, status: r.status,
          wacz_size: r.wacz_size, extracted: safeJson(r.extracted_json), error: r.error,
        })),
      }, null, 2);
    },
  },
  {
    name: "fetch_mail",
    description:
      "Pull new mail now, over the Yahoo Mail API or JMAP, whichever is " +
      "configured. Returns how many messages arrived and how many were new.",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, sql) => {
      const result = await fetchNewMail(sql);
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: "get_settings",
    description:
      "The settings, with the sensitive values masked. The profile is the one " +
      "the eligibility engine reads.",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, sql) => {
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
    },
  },
];

// ── The helpers the tools need ────────────────────────────────────────

function safeJson(value: any): any {
  try {
    return typeof value === "string" ? JSON.parse(value || "{}") : (value ?? {});
  } catch {
    return {};
  }
}

/**
 * Write the capture section back, the same way the settings route does.
 */
async function saveCapture(sql: any, capture: any): Promise<void> {
  const settings = readSettings(sql);
  const merged = { ...settings, capture };
  const key = "capture";
  const rows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
  const current = rows.length > 0 ? safeJson(rows[0].value) : {};
  current[key] = merged.capture;
  const ts = Date.now();
  sql.exec(
    "INSERT INTO settings (key, value, updated_at) VALUES ('main', ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?",
    JSON.stringify(current), ts, JSON.stringify(current), ts).toArray();
}

// ── The route ─────────────────────────────────────────────────────────

/**
 * Handle one MCP message.
 *
 * The protocol is JSON-RPC 2.0. A notification gets no reply. A request
 * gets a result or an error.
 */
async function handleMcpMessage(message: any, sql: any): Promise<any | null> {
  const { method, id, params } = message || {};

  // A notification has no id, and gets no reply.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "The TaskMaster Pro hackathon tracker. list_competitions and list_inbox read " +
          "the data. capture_all queues the pages in the manifest; the capture itself " +
          "needs the browser runner, which posts the archives back.",
      };

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return {};

    case "tools/list":
      return {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };

    case "tools/call": {
      const name = params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        return {
          content: [{ type: "text", text: "There is no tool called " + name }],
          isError: true,
        };
      }
      try {
        const text = await tool.run(params?.arguments || {}, sql);
        return { content: [{ type: "text", text }] };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: "The tool failed: " + (err?.message || String(err)) }],
          isError: true,
        };
      }
    }

    default:
      if (isNotification) return null;
      return null;
  }
}

/**
 * Register the MCP endpoint.
 *
 * The Durable Object's Hono app sees the full path, so the route is
 * /api/mcp like every other route the app serves.
 */
export function registerMcpRoutes(app: Hono, sql: any): void {
  app.post("/api/mcp", async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        jsonrpc: "2.0", id: null,
        error: { code: -32700, message: "Parse error" },
      }, 400);
    }

    // A batch is an array of messages.
    const messages = Array.isArray(body) ? body : [body];
    const replies: any[] = [];

    for (const message of messages) {
      let result: any = null;
      try {
        result = await handleMcpMessage(message, sql);
      } catch (err: any) {
        if (message?.id === undefined || message?.id === null) continue;
        result = null;
        replies.push({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: "Internal error: " + (err?.message || String(err)) },
        });
        continue;
      }

      // A notification gets no reply.
      if (message?.id === undefined || message?.id === null) continue;
      if (result === null) {
        replies.push({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found: " + message.method },
        });
      } else {
        replies.push({ jsonrpc: "2.0", id: message.id, result });
      }
    }

    if (replies.length === 0) {
      // Everything was a notification.
      return new Response(null, { status: 202 });
    }
    return c.json(replies.length === 1 ? replies[0] : replies);
  });

  // The client may open a stream. This server is stateless, so there is
  // nothing to stream, and saying so is the honest answer.
  app.get("/api/mcp", (c) =>
    c.json({
      error: "This MCP server is stateless. POST a JSON-RPC message to this URL.",
    }, 405)
  );

  app.delete("/api/mcp", (c) => new Response(null, { status: 204 }));
}
