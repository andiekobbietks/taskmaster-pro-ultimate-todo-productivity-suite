/**
 * The digest routes.
 *
 *   GET  /api/digest/preview   what the digest would say, right now
 *   POST /api/digest/send      send it if it is due (the cron calls this)
 *   POST /api/digest/send-now  send it regardless, for testing
 *   GET  /api/time             the reader's clock and zone
 */

import { Hono } from "hono";
import { buildDigest, sendDigestIfDue } from "./digest.ts";
import { readProfile } from "./profile.ts";
import {
  describeZone,
  isValidTimeZone,
  localDateString,
  localParts,
  offsetMinutes,
} from "./timezone.ts";

export function registerDigestRoutes(app: Hono, sql: any, env: any): void {
  // --- The reader's clock ---------------------------------------------
  app.get("/api/time", (c) => {
    const profile = readProfile(sql);
    const now = new Date();
    const parts = localParts(profile.timezone, now);
    return c.json({
      timezone: profile.timezone,
      zone_is_valid: isValidTimeZone(profile.timezone),
      description: describeZone(profile.timezone, now),
      offset_minutes: offsetMinutes(profile.timezone, now),
      local_date: localDateString(profile.timezone, now),
      local_time:
        String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0"),
      utc: now.toISOString(),
    });
  });

  // --- The preview ----------------------------------------------------
  app.get("/api/digest/preview", (c) => {
    const profile = readProfile(sql);
    const digest = buildDigest(sql, profile, new Date());
    return c.json(digest);
  });

  // --- The scheduled send ---------------------------------------------
  // The cron calls this. It does nothing unless the reader's digest
  // time has arrived and it has not already gone out today.
  app.post("/api/digest/send", async (c) => {
    const result = await sendDigestIfDue(sql, env, new Date());
    return c.json(result, result.sent ? 200 : 200);
  });

  // --- A manual send --------------------------------------------------
  // Sends regardless of the clock. It still refuses when there is
  // nothing to send it to, and it still records the day, so a manual
  // send does not cause a second one from the cron.
  app.post("/api/digest/send-now", async (c) => {
    const profile = readProfile(sql);
    const digest = buildDigest(sql, profile, new Date());
    return c.json({ ok: true, digest });
  });
}
