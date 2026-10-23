/**
 * MLH import routes.
 *
 * POST /api/mlh/import pulls MLH season events from the embedded JSON in
 * mlh.io/seasons/2026/events into the competitions table. Idempotent: a
 * second import updates its own rows rather than duplicating them.
 */

import { Hono } from "hono";
import { ingestMlh } from "./mlh.ts";

export function registerMlhRoutes(app: Hono, sql: any): void {
  app.post("/api/mlh/import", async (c) => {
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const season = String(body?.season || "2026").replace(/[^0-9]/g, "");
    const result = await ingestMlh(sql, { season });
    return c.json(result, result.endpoint_ok ? 200 : 502);
  });

  app.get("/api/mlh/import", (c) =>
    c.json({
      method: "POST",
      body: { season: "optional, e.g. 2026" },
      source: "https://mlh.io/seasons/2026/events",
      note:
        "Parses the inline JSON blob embedded in the MLH season page. " +
        "No API key is required, but the page shape can change.",
    })
  );
}
