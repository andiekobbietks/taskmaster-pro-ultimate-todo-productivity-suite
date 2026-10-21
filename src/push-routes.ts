/**
 * The push routes.
 *
 *   GET  /api/push/key            the public VAPID key (public by design)
 *   POST /api/push/subscribe      store a browser subscription
 *   POST /api/push/unsubscribe    forget one
 *   GET  /api/push/status         how many subscriptions there are
 *   POST /api/push/test           send a test push to all of them
 *
 * The subscription endpoint is a long, secret URL: anyone holding it can
 * wake the device. It is never returned by any route.
 */

import { Hono } from "hono";
import { sendPush } from "./push.ts";

export interface PushKeys {
  publicKey: string;
  privateKey: JsonWebKey;
  subject: string;
}

/** The VAPID keys, from the environment. */
export function readPushKeys(env: any): PushKeys | null {
  const publicKey = env?.VAPID_PUBLIC_KEY;
  const privateKeyRaw = env?.VAPID_PRIVATE_KEY;
  const subject = env?.VAPID_SUBJECT || "mailto:admin@taskmaster.local";
  if (!publicKey || !privateKeyRaw) return null;
  try {
    const privateKey =
      typeof privateKeyRaw === "string" ? JSON.parse(privateKeyRaw) : privateKeyRaw;
    return { publicKey, privateKey, subject };
  } catch {
    return null;
  }
}

export function registerPushRoutes(app: Hono, sql: any, env: any): void {
  // --- The public key -------------------------------------------------
  // The browser needs this to subscribe. It is public: the private key
  // is what signs, and that never leaves the Worker.
  app.get("/api/push/key", (c) => {
    const keys = readPushKeys(env);
    if (!keys) {
      return c.json(
        {
          error: "no_push_keys",
          message:
            "No VAPID keys are set. Run node scripts/make-vapid-keys.mjs, or " +
            "put VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in the " +
            "environment.",
        },
        503
      );
    }
    return c.json({ publicKey: keys.publicKey, subject: keys.subject });
  });

  // --- Subscribe ------------------------------------------------------
  app.post("/api/push/subscribe", async (c) => {
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const endpoint = String(body?.endpoint || "");
    const p256dh = String(body?.keys?.p256dh || "");
    const auth = String(body?.keys?.auth || "");

    if (!endpoint || !p256dh || !auth) {
      return c.json(
        { error: "A subscription needs an endpoint and both keys." },
        400
      );
    }
    if (!/^https:\/\//i.test(endpoint)) {
      return c.json({ error: "The endpoint must be https." }, 400);
    }

    const ts = Date.now();
    const ua = c.req.header("user-agent") || "";
    const existing = sql
      .exec("SELECT endpoint FROM push_subscriptions WHERE endpoint = ?", endpoint)
      .toArray();
    if (existing.length > 0) {
      sql.exec(
        "UPDATE push_subscriptions SET p256dh = ?, auth = ?, user_agent = ?, " +
          "failures = 0, last_error = '' WHERE endpoint = ?",
        p256dh, auth, ua, endpoint
      ).toArray();
    } else {
      sql.exec(
        "INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at, failures) " +
          "VALUES (?, ?, ?, ?, ?, 0)",
        endpoint, p256dh, auth, ua, ts
      ).toArray();
    }
    return c.json({ ok: true, subscriptions: countSubscriptions(sql) });
  });

  // --- Unsubscribe ----------------------------------------------------
  app.post("/api/push/unsubscribe", async (c) => {
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const endpoint = String(body?.endpoint || "");
    if (!endpoint) return c.json({ error: "An endpoint is required." }, 400);
    sql.exec("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint).toArray();
    return c.json({ ok: true, subscriptions: countSubscriptions(sql) });
  });

  // --- How many are there ---------------------------------------------
  // The endpoints themselves are secrets, so only the count comes back.
  app.get("/api/push/status", (c) => {
    const rows = sql
      .exec(
        "SELECT endpoint, created_at, last_ok, last_error, failures FROM push_subscriptions"
      )
      .toArray();
    return c.json({
      count: rows.length,
      keys_configured: !!readPushKeys(env),
      last_ok: rows.map((r: any) => r.last_ok).filter(Boolean).sort().pop() || null,
      failures: rows.reduce((n: number, r: any) => n + (r.failures || 0), 0),
    });
  });

  // --- A test push ----------------------------------------------------
  // Sends one notification to every subscription and reports what each
  // push service said. This is the honest end-to-end check: a 201 means
  // the encryption and the signature were both accepted.
  app.post("/api/push/test", async (c) => {
    const keys = readPushKeys(env);
    if (!keys) {
      return c.json(
        { error: "no_push_keys", message: "No VAPID keys are set." },
        503
      );
    }
    const rows = sql.exec("SELECT * FROM push_subscriptions").toArray();
    if (rows.length === 0) {
      return c.json({ error: "no_subscriptions", sent: 0 }, 400);
    }

    const results: any[] = [];
    for (const row of rows) {
      const res = await sendPush({
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        subject: keys.subject,
        payload: {
          title: "TaskMaster Pro",
          body: "Push notifications are wired up. This is what a deadline will look like.",
          tag: "taskmaster-test",
          data: { url: "/" },
        },
      });
      if (res.gone) {
        sql.exec("DELETE FROM push_subscriptions WHERE endpoint = ?", row.endpoint).toArray();
      } else {
        sql.exec(
          "UPDATE push_subscriptions SET last_ok = ?, last_error = ?, failures = ? WHERE endpoint = ?",
          res.ok ? Date.now() : null,
          res.ok ? "" : res.body || ("HTTP " + res.status),
          res.ok ? 0 : (row.failures || 0) + 1,
          row.endpoint
        ).toArray();
      }
      results.push({ status: res.status, ok: res.ok, body: res.body, gone: res.gone });
    }
    return c.json({ sent: results.length, results });
  });
}

function countSubscriptions(sql: any): number {
  const row = sql
    .exec("SELECT count(*) AS c FROM push_subscriptions")
    .toArray()[0];
  return Number(row?.c || 0);
}
