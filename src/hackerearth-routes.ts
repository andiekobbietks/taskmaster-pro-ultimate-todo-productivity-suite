/**
 * HackerEarth import routes.
 *
 * HackerEarth does not expose a public, keyless hackathon feed, so the
 * importer returns endpoint_ok:false with a clear problem instead of
 * pretending to work.
 */

import { Hono } from "hono";
import { ingestHackerEarth } from "./hackerearth.ts";

export function registerHackerEarthRoutes(app: Hono, sql: any): void {
  app.post("/api/hackerearth/import", async (c) => {
    const result = await ingestHackerEarth(sql);
    // 501 distinguishes "the app is fine, the upstream feed is not usable"
    // from a 502 gateway failure.
    return c.json(result, result.endpoint_ok ? 200 : 501);
  });

  app.get("/api/hackerearth/import", (c) =>
    c.json({
      method: "POST",
      source: "https://www.hackerearth.com/challenges/hackathon",
      note:
        "HackerEarth has no known keyless JSON feed. This endpoint documents " +
        "the failure rather than scraping an unstable RSC payload.",
    })
  );
}
