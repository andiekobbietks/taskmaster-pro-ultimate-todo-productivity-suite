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
 * is a few hundred lines, and this file stays the default.
 *
 * The tool definitions live in mcp-tools.ts, shared with mcp-sdk.ts,
 * which is the same endpoint on the official SDK's transport.
 *
 * The transport is Streamable HTTP, stateless: a POST carries one
 * JSON-RPC message, and the reply is the JSON-RPC response.
 */

import { Hono } from "hono";
import { MCP_TOOLS } from "./mcp-tools.ts";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "taskmaster-pro", version: "1.3.1" };

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
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.jsonSchema,
        })),
      };

    case "tools/call": {
      const name = params?.name;
      const tool = MCP_TOOLS.find((t) => t.name === name);
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
