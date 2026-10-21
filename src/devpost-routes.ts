/**
 * Devpost import routes.
 *
 * POST /api/devpost/import pulls the open hackathons straight from the
 * listing API into the competitions table. Idempotent: a second import
 * updates its own rows rather than duplicating them.
 */

import { Hono } from "hono";
import { ingestDevpost } from "./devpost.ts";

export function registerDevpostRoutes(app: Hono, sql: any): void {
  app.post("/api/devpost/import", async (c) => {
    // pages is optional in the body; 2 covers the whole open set at
    // 40/page, and anything larger is capped so nobody asks for 350.
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const requested = Number(body?.pages) || 2;
    const pages = Math.max(1, Math.min(requested, 8));

    const result = await ingestDevpost(sql, { pages });
    return c.json(result, result.endpoint_ok ? 200 : 502);
  });

  app.get("/api/devpost/import", (c) =>
    c.json({
      method: "POST",
      body: { pages: "optional, 1-8, default 2 (40 per page)" },
      note: "Pulls every open hackathon from Devpost's listing API into competitions.",
    })
  );
}
