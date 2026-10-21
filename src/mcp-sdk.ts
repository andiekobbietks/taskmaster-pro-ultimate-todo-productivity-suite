/**
 * The app, as an MCP server — on the official SDK.
 *
 * This is the same endpoint as src/mcp.ts, the lean hand-rolled one, but
 * the transport is the SDK's WebStandardStreamableHTTPServerTransport:
 * full Streamable HTTP, sessions, SSE streaming, the parts the hand-rolled
 * server deliberately does not do.
 *
 * It exports registerMcpRoutes with the same signature.
 * Switching is a one-line import change in src/index.ts:
 *
 *   import { registerMcpRoutes } from "./mcp";       // lean (default)
 *   import { registerMcpRoutes } from "./mcp-sdk";   // the official SDK
 *
 * The SDK's full transport pulls express, hono/node-server, jose and ajv
 * behind it and bundles to 385 KB — that is the price of the full spec.
 *
 * The tool definitions live in mcp-tools.ts, shared with mcp.ts, so the
 * two variants cannot drift: same tools, same descriptions, same runners.
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { MCP_TOOLS } from "./mcp-tools.ts";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "taskmaster-pro", version: "1.3.1" };

/**
 * Build one MCP server with every tool registered.
 */
function buildServer(sql: any): McpServer {
  const server = new McpServer(SERVER_INFO as never, {
    protocolVersion: PROTOCOL_VERSION,
    instructions:
      "The TaskMaster Pro hackathon tracker. list_competitions and list_inbox read " +
      "the data. capture_all queues the pages in the manifest; the capture itself " +
      "needs the browser runner, which posts the archives back.",
  });

  for (const t of MCP_TOOLS) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.shape,
      },
      async (args: any) => {
        try {
          const text = await t.run(args || {}, sql);
          return { content: [{ type: "text", text }] };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: "The tool failed: " + (err?.message || String(err)) }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

/**
 * Register the MCP endpoint, on the official SDK's transport.
 */
export function registerMcpRoutes(app: Hono, sql: any): void {
  app.post("/api/mcp", async (c) => {
    // Stateless mode: one fresh server and transport per request. The
    // transport sees the raw Request, so JSON-RPC 2.0 (single message
    // and batch) is its problem, not ours.
    const server = buildServer(sql);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // Stateless: there is no session to stream.
  app.get("/api/mcp", (c) =>
    c.text("This MCP server is stateless. POST a JSON-RPC message to this URL.", 405)
  );

  app.delete("/api/mcp", (c) => new Response(null, { status: 204 }));
}
