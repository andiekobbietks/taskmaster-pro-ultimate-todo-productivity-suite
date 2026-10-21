/**
 * The Yahoo Mail API.
 *
 * Yahoo has no public API for mail, but the one its own webmail uses is
 * documented and works: apis.mail.yahoo.com/ws/v3. It returns the raw
 * source of a message, which is what src/mime.ts parses.
 *
 * To use it you register an application at developer.yahoo.com, ask for
 * the Mail / Read permission, and get a client id, a client secret and a
 * refresh token. The refresh token is the long-lived one; the access
 * token it buys is short and is renewed here, silently, on every call.
 *
 * This module makes plain HTTP calls, so it runs inside the Worker. No
 * browser is involved, which is what separates it from the capture.
 */

const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const API_BASE = "https://apis.mail.yahoo.com/ws/v3";

export interface YahooConfig {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  /** The mailbox to read. "/" is the root folder. */
  mailbox_id?: string;
}

export interface YahooMessage {
  id: string;
  subject?: string;
  from?: string;
  received_at?: string;
  unread?: boolean;
  flagged?: boolean;
  has_attachments?: boolean;
}

export interface YahooResult {
  ok: boolean;
  message: string;
  /** The number of messages found, when a listing worked */
  count?: number;
  /** The mailbox names, when a listing worked */
  mailboxes?: Array<{ id: string; name: string }>;
}

/**
 * Is the configuration complete enough to try?
 */
export function hasYahooConfig(config: any): boolean {
  const c = (config?.email || {}) as Partial<YahooConfig>;
  return Boolean(c.client_id && c.client_secret && c.refresh_token);
}

/**
 * Trade the refresh token for an access token.
 */
export async function getAccessToken(config: YahooConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.refresh_token,
    client_id: config.client_id,
    client_secret: config.client_secret,
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await resp.text();
  if (!resp.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = j.error_description || j.error || detail;
    } catch {
      // Keep the raw text.
    }
    throw new Error("Yahoo refused the refresh token: " + detail);
  }

  const json = JSON.parse(text);
  if (!json.access_token) {
    throw new Error("Yahoo returned no access token");
  }
  return json.access_token;
}

/**
 * A call to the mail API, with the bearer token attached.
 */
async function yahooFetch(path: string, token: string): Promise<any> {
  const resp = await fetch(API_BASE + path, {
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/json",
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.error?.description || JSON.stringify(j).slice(0, 200);
    } catch {
      // Keep the raw text.
    }
    throw new Error("Yahoo API " + resp.status + ": " + detail);
  }
  return JSON.parse(text);
}

/**
 * The mailboxes on the account.
 */
export async function listMailboxes(config: YahooConfig): Promise<YahooResult> {
  const token = await getAccessToken(config);
  const data = await yahooFetch("/mailboxes", token);
  const mailboxes = (data.mailboxes || []).map((m: any) => ({
    id: m.id,
    name: m.name || m.id,
  }));
  return {
    ok: true,
    message: mailboxes.length + " mailbox(es).",
    count: mailboxes.length,
    mailboxes,
  };
}

/**
 * The messages in a mailbox, newest first.
 */
export async function listMessages(
  config: YahooConfig,
  limit = 25
): Promise<YahooResult> {
  const token = await getAccessToken(config);
  const mailbox = encodeURIComponent(config.mailbox_id || "/");
  const fields = [
    "id", "subject", "from", "received_at", "unread", "flagged", "has_attachments",
  ].join(",");
  const data = await yahooFetch(
    "/mailboxes/@.id==" + mailbox + "/messages?fields=" + fields + "&limit=" + limit,
    token
  );

  const messages = (data.messages || []).map((m: any) => ({
    id: m.id,
    subject: m.subject || "",
    from: m.from?.name || m.from?.email || "",
    received_at: m.received_at || "",
    unread: Boolean(m.unread),
    flagged: Boolean(m.flagged),
    has_attachments: Boolean(m.has_attachments),
  }));

  return {
    ok: true,
    message: messages.length + " message(s).",
    count: messages.length,
    ...(data as any),
    messages,
  };
}

/**
 * The raw source of one message.
 */
export async function getRawMessage(
  config: YahooConfig,
  messageId: string
): Promise<string> {
  const token = await getAccessToken(config);
  const mailbox = encodeURIComponent(config.mailbox_id || "/");
  const id = encodeURIComponent(messageId);

  const resp = await fetch(
    API_BASE + "/mailboxes/@.id==" + mailbox + "/messages/@.id==" + id +
    "/content?rawPlaintext",
    { headers: { "Authorization": "Bearer " + token } }
  );
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error("Yahoo API " + resp.status + ": " + text.slice(0, 200));
  }
  return text;
}

/**
 * Check the configuration, without changing anything.
 */
export async function testYahooConnection(config: YahooConfig): Promise<YahooResult> {
  if (!config.client_id || !config.client_secret || !config.refresh_token) {
    return {
      ok: false,
      message: "The client id, the client secret and the refresh token are all needed.",
    };
  }
  try {
    return await listMailboxes(config);
  } catch (err: any) {
    return { ok: false, message: err?.message || String(err) };
  }
}
