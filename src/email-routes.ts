/**
 * The email routes.
 *
 *   GET    /api/email/status       what is configured, and what is missing
 *   POST   /api/email/test        send one test message
 *   GET    /api/email/deliveries   the delivery log, newest first
 *   GET    /api/email/subscribers  who the digest goes to
 *   POST   /api/email/subscribers  add an address
 *   DELETE /api/email/subscribers/:address   remove one
 *
 * The subscription endpoint is the only one that takes an address from
 * the caller, so it is the one that checks the address before storing
 * it. A malformed address stored in the table becomes a delivery
 * failure at digest time, which is a bad place to discover it.
 */

import { Hono } from "hono";
import {
  resolveEmailConfig,
  emailReadiness,
  sendEmail,
  logDelivery,
  isValidAddress,
  type EmailConfig,
} from "./email.ts";

/** The addresses the digest goes to. */
export function readSubscribers(sql: any): Array<{ address: string; name: string; active: boolean }> {
  try {
    const rows = sql.exec("SELECT address, name, active FROM email_subscriptions ORDER BY id").toArray();
    return rows.map((r: any) => ({
      address: String(r.address),
      name: String(r.name || ""),
      active: !!r.active,
    }));
  } catch {
    return [];
  }
}

/**
 * Who to send to.
 *
 * The subscribers table wins when it has rows. When it has none, the
 * address in the settings is the single recipient, so a fresh install
 * works without anyone having to subscribe anybody.
 */
export function resolveRecipients(sql: any, config: EmailConfig): string[] {
  const subs = readSubscribers(sql).filter((s) => s.active).map((s) => s.address);
  if (subs.length) return subs;
  return config.from_address ? [config.from_address] : [];
}

export function registerEmailRoutes(app: Hono, sql: any, env: any): void {
  // --- What is configured ----------------------------------------------
  // The Developer screen calls this so it can say "SendGrid, missing
  // the API key" instead of just "not configured".

  app.get("/api/email/status", (c) => {
    const config = resolveEmailConfig(sql, env);
    const readiness = emailReadiness(config);
    return c.json({
      provider: readiness.provider,
      ready: readiness.ready,
      missing: readiness.missing,
      from_address: config.from_address,
      from_name: config.from_name,
      recipients: resolveRecipients(sql, config),
      // Which credentials are present — never their values.
      credentials_present: {
        sendgrid_api_key: !!config.sendgrid_api_key,
        ses_access_key: !!config.ses_access_key,
        ses_secret_key: !!config.ses_secret_key,
        ses_sender: !!config.ses_sender,
        oracle_smtp_user: !!config.oracle_smtp_user,
        oracle_smtp_pass: !!config.oracle_smtp_pass,
      },
    });
  });

  // --- A test message --------------------------------------------------
  // Goes to the from address unless the caller names one. The address
  // is checked before it is used, so a typo shows up as a message
  // rather than as a provider error.

  app.post("/api/email/test", async (c) => {
    const config = resolveEmailConfig(sql, env);
    const readiness = emailReadiness(config);
    if (!readiness.ready) {
      return c.json(
        {
          ok: false,
          error: "the email channel is not ready",
          missing: readiness.missing,
        },
        400
      );
    }

    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const to = String(body.to || config.from_address).trim();
    if (!isValidAddress(to)) {
      return c.json({ ok: false, error: `"${to}" is not a valid email address` }, 400);
    }

    const payload = {
      to,
      from: config.from_address,
      subject: "TaskMaster Pro — test message",
      body: [
        "This is a test message from TaskMaster Pro.",
        "",
        "If you can read this, the email channel works end to end:",
        "the provider accepted the message and it was delivered.",
        "",
        "Sent at " + new Date().toISOString(),
      ].join("\n"),
    };

    const result = await sendEmail(sql, env, payload);
    await logDelivery(sql, payload, result);
    return c.json(result, result.ok ? 200 : 502);
  });

  // --- The delivery log -------------------------------------------------

  app.get("/api/email/deliveries", (c) => {
    try {
      const rows = sql
        .exec("SELECT id, address, subject, status, message_id, error, created_at FROM email_deliveries ORDER BY id DESC LIMIT 50")
        .toArray();
      return c.json({ deliveries: rows });
    } catch (e) {
      return c.json({ error: String(e), deliveries: [] }, 500);
    }
  });

  // --- Subscribers ------------------------------------------------------

  app.get("/api/email/subscribers", (c) => {
    return c.json({ subscribers: readSubscribers(sql) });
  });

  app.post("/api/email/subscribers", async (c) => {
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const address = String(body.address || "").trim().toLowerCase();
    if (!isValidAddress(address)) {
      return c.json({ ok: false, error: `"${body.address || ""}" is not a valid email address` }, 400);
    }
    const name = String(body.name || "").slice(0, 120);
    try {
      sql.exec(
        `INSERT INTO email_subscriptions (address, name, active, created_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(address) DO UPDATE SET name = ?, active = 1`,
        address,
        name,
        Date.now(),
        name
      ).toArray();
      return c.json({ ok: true, address });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  app.delete("/api/email/subscribers/:address", (c) => {
    const address = String(c.req.param("address") || "").trim().toLowerCase();
    try {
      sql.exec("DELETE FROM email_subscriptions WHERE address = ?", address).toArray();
      return c.json({ ok: true, address });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });
}
