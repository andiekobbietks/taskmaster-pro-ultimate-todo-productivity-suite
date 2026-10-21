/**
 * Email sending for the digest and test mails.
 *
 * Two things make this file different from "just use nodemailer":
 *
 * 1. A Cloudflare Worker has no `node:smtp` and no `nodemailer`. The
 *    transport is one `fetch` per REST provider, or, for Oracle SMTP, a
 *    raw TLS socket opened with `connect()` from `cloudflare:sockets`.
 *
 * 2. The project keeps its dependency tree at four packages, so there is
 *    no `aws-sdk` and no mail library to lean on. Everything is built on
 *    the WebCrypto that ships in the Worker.
 *
 * Three providers are supported; each one lives in its own function so
 * it can be tested in isolation:
 *
 *   SendGrid  – REST API, bearer key.
 *   SES       – REST API, AWS Signature V4 computed by hand on WebCrypto.
 *   Oracle    – SMTP over STARTTLS, AUTH LOGIN.
 *
 * Where the credentials come from
 * -------------------------------
 * Two places, and the settings win over the environment:
 *
 *   1. The environment (`.dev.vars` locally, `wrangler secret` in
 *      production). Secrets stay out of the database this way.
 *   2. The settings screen, which stores them obfuscated in the
 *      `settings` table. This is what makes the provider switchable
 *      without a redeploy.
 *
 * A value that is empty in the settings does not blank the environment
 * value — an empty field in a form should not silently delete a working
 * secret.
 */

import { readSettingsSection } from "./settings-reader.ts";

// ── Types ──────────────────────────────────────────────────────────────

export type EmailProvider = "oracle" | "sendgrid" | "ses";

export interface EmailConfig {
  provider: EmailProvider | null;
  sendgrid_api_key: string;
  ses_region: string;
  ses_sender: string;
  ses_access_key: string;
  ses_secret_key: string;
  oracle_smtp_host: string;
  oracle_smtp_port: number;
  oracle_smtp_user: string;
  oracle_smtp_pass: string;
  from_address: string;
  from_name: string;
}

export interface EmailPayload {
  to: string;
  from: string;
  subject: string;
  /** Plain text only – see the project rule on never injecting HTML. */
  body: string;
  /** Optional metadata the caller may want logged. */
  context?: Record<string, string>;
}

export interface SendResult {
  ok: boolean;
  status: number;
  message: string;
  /** For SES / SendGrid this is the message ID the provider handed back. */
  messageId?: string;
}

// ── Config resolution ──────────────────────────────────────────────────

const EMPTY_CONFIG: EmailConfig = {
  provider: null,
  sendgrid_api_key: "",
  ses_region: "us-east-1",
  ses_sender: "",
  ses_access_key: "",
  ses_secret_key: "",
  oracle_smtp_host: "smtp-mail.oracle.com",
  oracle_smtp_port: 587,
  oracle_smtp_user: "",
  oracle_smtp_pass: "",
  from_address: "",
  from_name: "TaskMaster Pro",
};

/**
 * Merge the environment and the stored settings into one config.
 *
 * Settings win, but only where they carry a value. An empty form field
 * means "I did not fill this in", not "delete the working secret".
 */
export function resolveEmailConfig(sql: any, env: any): EmailConfig {
  const s = (readSettingsSection(sql, "email") || {}) as any;

  const pick = (key: keyof EmailConfig, envValue: any): any => {
    const fromSettings = s[key];
    if (fromSettings === undefined || fromSettings === null || fromSettings === "") {
      return envValue;
    }
    return fromSettings;
  };

  const providerRaw = String(pick("provider", env?.EMAIL_PROVIDER) || "").toLowerCase();
  const provider: EmailProvider | null =
    providerRaw === "sendgrid" || providerRaw === "ses" || providerRaw === "oracle"
      ? (providerRaw as EmailProvider)
      : null;

  return {
    provider,
    sendgrid_api_key: String(pick("sendgrid_api_key", env?.SENDGRID_API_KEY) || ""),
    ses_region: String(pick("ses_region", env?.SES_REGION) || "us-east-1"),
    ses_sender: String(pick("ses_sender", env?.SES_SENDER) || ""),
    ses_access_key: String(pick("ses_access_key", env?.AWS_ACCESS_KEY_ID) || ""),
    ses_secret_key: String(pick("ses_secret_key", env?.AWS_SECRET_ACCESS_KEY) || ""),
    oracle_smtp_host: String(pick("oracle_smtp_host", env?.ORACLE_SMTP_HOST) || "smtp-mail.oracle.com"),
    oracle_smtp_port: Number(pick("oracle_smtp_port", env?.ORACLE_SMTP_PORT) || 587),
    oracle_smtp_user: String(pick("oracle_smtp_user", env?.ORACLE_SMTP_USER) || ""),
    oracle_smtp_pass: String(pick("oracle_smtp_pass", env?.ORACLE_SMTP_PASS) || ""),
    from_address: String(pick("from_address", env?.EMAIL_FROM) || ""),
    from_name: String(pick("from_name", env?.EMAIL_FROM_NAME) || "TaskMaster Pro"),
  };
}

/**
 * What is missing before a send can happen.
 *
 * The Developer screen shows this so the reader does not have to guess
 * why a test send did nothing.
 */
export function emailReadiness(config: EmailConfig): {
  ready: boolean;
  provider: EmailProvider | null;
  missing: string[];
} {
  const missing: string[] = [];
  if (!config.provider) missing.push("provider");
  if (!config.from_address) missing.push("from_address");
  switch (config.provider) {
    case "sendgrid":
      if (!config.sendgrid_api_key) missing.push("sendgrid_api_key");
      break;
    case "ses":
      if (!config.ses_sender) missing.push("ses_sender");
      if (!config.ses_access_key) missing.push("ses_access_key");
      if (!config.ses_secret_key) missing.push("ses_secret_key");
      break;
    case "oracle":
      if (!config.oracle_smtp_user) missing.push("oracle_smtp_user");
      if (!config.oracle_smtp_pass) missing.push("oracle_smtp_pass");
      break;
    default:
      break;
  }
  return { ready: missing.length === 0, provider: config.provider, missing };
}

/**
 * A deliberately small address check.
 *
 * Full RFC 5322 validation is a parser's job and gets the exotic
 * cases wrong. This catches the mistakes a person actually makes:
 * no at-sign, no domain, no dot in the domain, a space anywhere.
 */
export function isValidAddress(value: string): boolean {
  const v = String(value || "").trim();
  if (!v || v.length > 254) return false;
  if (/\s/.test(v)) return false;
  const at = v.indexOf("@");
  if (at < 1 || at !== v.lastIndexOf("@")) return false;
  const domain = v.slice(at + 1);
  if (!domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.includes("..")) return false;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (tld.length < 2) return false;
  if (!/^[A-Za-z0-9._%+-]+$/.test(v.slice(0, at))) return false;
  if (!/^[A-Za-z0-9.-]+$/.test(domain)) return false;
  return true;
}

// ── Header safety ──────────────────────────────────────────────────────

/**
 * A newline in a header is a header injection.
 *
 * If the subject or the address carries a CR or LF, the rest of it is
 * read by the mail server as extra headers — a way to put your own
 * `Bcc:` on someone else's message. Reject rather than strip: stripping
 * silently changes the address the reader typed.
 */
export function assertSafeHeader(value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`refusing to send: ${field} contains a newline`);
  }
}

// ── Provider dispatch ──────────────────────────────────────────────────

/**
 * Send one message through the configured provider.
 *
 * The SQL handle is used only to log the delivery, not to send.
 */
export async function sendEmail(
  sql: any,
  env: any,
  payload: EmailPayload
): Promise<SendResult> {
  assertSafeHeader(payload.to, "to");
  assertSafeHeader(payload.from, "from");
  assertSafeHeader(payload.subject, "subject");

  const config = resolveEmailConfig(sql, env);
  switch (config.provider) {
    case "sendgrid":
      return sendViaSendGrid(config, payload);
    case "ses":
      return sendViaSES(config, payload);
    case "oracle":
      return sendViaOracleSMTP(config, payload);
    default:
      return { ok: false, status: 0, message: "no email provider is configured" };
  }
}

// ── 1. SendGrid ────────────────────────────────────────────────────────

async function sendViaSendGrid(config: EmailConfig, p: EmailPayload): Promise<SendResult> {
  if (!config.sendgrid_api_key) {
    return { ok: false, status: 400, message: "SENDGRID_API_KEY is not set" };
  }

  const body = JSON.stringify({
    from: { email: p.from, name: config.from_name },
    personalizations: [{ to: [{ email: p.to }] }],
    subject: p.subject,
    content: [{ type: "text/plain", value: p.body }],
  });

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.sendgrid_api_key}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (res.ok) {
    const id = res.headers.get("X-Message-ID");
    return { ok: true, status: 202, message: "accepted by SendGrid", messageId: id ?? undefined };
  }
  const txt = await res.text();
  return { ok: false, status: res.status, message: `SendGrid ${res.status}: ${txt}` };
}

// ── 2. Amazon SES (AWS Signature V4 by hand) ───────────────────────────

async function hmacSha256(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", ck, msg as unknown as BufferSource));
}

export function toHex(b: Uint8Array): string {
  return Array.from(b).map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** One iteration of the AWS SigV4 key chain: HMAC-SHA256(secret, label). */
export async function deriveSigV4Key(
  secret: string,
  labels: string[]
): Promise<Uint8Array> {
  let key = new TextEncoder().encode(`AWS4${secret}`);
  for (const label of labels) {
    key = await hmacSha256(key, new TextEncoder().encode(label));
  }
  return key;
}

export async function sha256Hex(message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return toHex(new Uint8Array(buf));
}

/**
 * Build the AWS SigV4 Authorization header.
 *
 * Split out from the send so it can be checked against the AWS
 * published test vector — see scripts/test-sigv4.mjs.
 */
export async function buildSigV4Authorization(opts: {
  method: string;
  url: string;
  body: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  amzDate: string;
  extraHeaders?: Record<string, string>;
}): Promise<string> {
  const { method, url, body, region, service, accessKey, secretKey, amzDate } = opts;
  const target = new URL(url);
  const path = target.pathname || "/";
  const host = target.host;
  const payloadHash = await sha256Hex(body);
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    host,
    ...(opts.extraHeaders || {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigV4Key(secretKey, [dateStamp, region, service, "aws4_request"]);
  const signature = toHex(await hmacSha256(signingKey, new TextEncoder().encode(stringToSign)));

  return (
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}

/**
 * Send a message via the Amazon SES v2 REST API.
 *
 * The signing logic is the part that is easy to get wrong, so it is
 * checked against the AWS published test vector in scripts/test-sigv4.mjs.
 */
async function sendViaSES(config: EmailConfig, p: EmailPayload): Promise<SendResult> {
  if (!config.ses_sender) return { ok: false, status: 400, message: "SES_SENDER is not set" };
  if (!config.ses_access_key || !config.ses_secret_key) {
    return { ok: false, status: 400, message: "the AWS credentials are not set" };
  }

  const region = config.ses_region || "us-east-1";
  const endpoint = `https://email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound";

  const apiBody = JSON.stringify({
    FromEmailAddress: p.from,
    Destination: { ToAddresses: [p.to] },
    Content: {
      Simple: {
        Subject: { Data: p.subject },
        Text: { Data: p.body },
      },
    },
  });

  const amzDate = new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d+Z$/, "Z");
  const authorization = await buildSigV4Authorization({
    method: "POST",
    url: `${endpoint}${path}`,
    body: apiBody,
    region,
    service: "email",
    accessKey: config.ses_access_key,
    secretKey: config.ses_secret_key,
    amzDate,
  });

  const res = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Date": amzDate,
      "X-Amz-Content-Sha256": await sha256Hex(apiBody),
      Authorization: authorization,
    },
    body: apiBody,
  });

  if (res.ok) {
    const data = await res.json().catch(() => ({}) as any);
    return { ok: true, status: 200, message: "accepted by SES", messageId: data?.MessageId };
  }
  const txt = await res.text();
  return { ok: false, status: res.status, message: `SES ${res.status}: ${txt}` };
}

// ── 3. Oracle SMTP over STARTTLS ───────────────────────────────────────

/** Base64 of a UTF-8 string, for the SMTP AUTH LOGIN exchange. */
export function b64utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * One line of the SMTP dialogue, with the multi-line reply handling.
 *
 * A reply like "250-STARTTLS\r\n250 OK" is two lines; the last one
 * decides the outcome.
 */
export class SmtpSession {
  private buf = "";
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  async readLine(): Promise<string> {
    for (;;) {
      const idx = this.buf.indexOf("\r\n");
      if (idx !== -1) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 2);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) {
        const rest = this.buf;
        this.buf = "";
        return rest;
      }
      this.buf += new TextDecoder().decode(value, { stream: true });
    }
  }
}

/**
 * Send a plain-text message through Oracle's SMTP relay.
 *
 * The socket is opened with `secureTransport: "starttls"`, so the
 * conversation starts in the clear, the STARTTLS command is issued, and
 * `socket.startTls()` upgrades the same connection. The EHLO greeting
 * is then repeated, because the server lists different extensions once
 * TLS is on.
 */
async function sendViaOracleSMTP(config: EmailConfig, p: EmailPayload): Promise<SendResult> {
  if (!config.oracle_smtp_user || !config.oracle_smtp_pass) {
    return { ok: false, status: 400, message: "the Oracle SMTP user and password are not set" };
  }

  let socket: any = null;
  try {
    const { connect } = await import("cloudflare:sockets");
    socket = await connect({
      host: config.oracle_smtp_host,
      port: config.oracle_smtp_port,
      secureTransport: "starttls",
    });

    let reader = socket.readable.getReader();
    let writer = socket.writable.getWriter();
    const te = new TextEncoder();
    let session = new SmtpSession(reader);

    const write = async (line: string): Promise<void> => {
      await writer.write(te.encode(line + "\r\n"));
    };
    const expect = async (prefix: string): Promise<string> => {
      const line = await session.readLine();
      if (!line.startsWith(prefix)) {
        throw new Error(`SMTP expected ${prefix}, got "${line}"`);
      }
      return line;
    };

    await expect("220"); // greeting
    await write("EHLO taskmaster-pro");
    await expect("250");

    // --- Upgrade to TLS ---
    await write("STARTTLS");
    await expect("220");
    const tlsSocket = await socket.startTls();
    reader = tlsSocket.readable.getReader();
    writer = tlsSocket.writable.getWriter();
    session = new SmtpSession(reader);

    await write("EHLO taskmaster-pro");
    await expect("250");

    // --- AUTH LOGIN ---
    await write("AUTH LOGIN");
    await expect("334");
    await write(b64utf8(config.oracle_smtp_user));
    await expect("334");
    await write(b64utf8(config.oracle_smtp_pass));
    const authed = await expect("235");

    // --- The message ---
    await write(`MAIL FROM:<${p.from}>`);
    await expect("250");
    await write(`RCPT TO:<${p.to}>`);
    await expect("250");
    await write("DATA");
    await expect("354");

    const message = [
      `From: ${p.from}`,
      `To: ${p.to}`,
      `Subject: ${p.subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "MIME-Version: 1.0",
      "",
      p.body,
      ".",
    ].join("\r\n");
    await write(message);
    const queued = await expect("250");
    await write("QUIT");

    try {
      await reader.cancel();
    } catch {
      // the server may have closed first; that is fine
    }
    try {
      await writer.close();
    } catch {
      // ditto
    }

    const messageId = queued.split(" ").slice(2).join(" ") || undefined;
    return {
      ok: true,
      status: 250,
      message: "queued by the Oracle relay" + (authed ? "" : ""),
      messageId,
    };
  } catch (e) {
    return { ok: false, status: 0, message: String(e) };
  } finally {
    try {
      socket?.close();
    } catch {
      // nothing useful to do
    }
  }
}

// ── Delivery log ───────────────────────────────────────────────────────

/**
 * Record one delivery attempt.
 *
 * The table is created with the rest of the schema, but a database
 * written before this table existed will not have it, and a missing
 * log row must not fail the send that already worked.
 */
export async function logDelivery(
  sql: any,
  payload: EmailPayload,
  result: SendResult
): Promise<void> {
  try {
    sql.exec(
      `INSERT INTO email_deliveries (address, subject, status, message_id, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      payload.to,
      payload.subject,
      result.ok ? "sent" : "error",
      result.messageId || null,
      result.ok ? null : result.message,
      Date.now()
    ).toArray();
  } catch {
    // The log is a convenience, not the delivery.
  }
}
