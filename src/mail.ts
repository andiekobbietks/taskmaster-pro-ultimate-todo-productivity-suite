/**
 * Mail ingestion.
 *
 * Reads the mail server configured in Settings, pulls anything new, and
 * hands it back for the inbox to store.
 *
 * This module deliberately does not write to the database. The inbox owns
 * the insert, the platform detection and the matching to a competition, so
 * there is one place where a message becomes an inbox row.
 */
import { readSettings } from "./settings.ts";
import { fetchEmailsSince, type JMAPConfig, type JMAPEmail } from "./jmap.ts";
import { hasYahooConfig, listMessages, getRawMessage, type YahooConfig } from "./yahoo.ts";

export interface MailFetchResult {
  ok: boolean;
  fetched: number;
  /** Messages from JMAP, which arrive with their fields already parsed */
  messages: JMAPEmail[];
  /** Raw sources from the Yahoo Mail API, which arrive as MIME */
  raws: Array<{ id: string; raw: string }>;
  /** Which transport was used */
  source: "yahoo" | "jmap" | "none";
  message: string;
}

/**
 * The prefix on inbox ids for mail that arrived over JMAP.
 *
 * It does double duty. It marks which rows came from the mail server, so
 * the fetch watermark can be taken from those rows alone, and it makes the
 * id stable, so fetching the same message twice is a no-op rather than a
 * duplicate.
 */
export const JMAP_ID_PREFIX = "inbox-jmap-";

/**
 * Pull anything new from the configured mail server.
 *
 * The watermark is the newest message already stored from this server. The
 * query asks for a minute earlier than that, so a message that arrives in
 * the same minute as one already stored is not missed; the stable id then
 * catches the overlap.
 */
export async function fetchNewMail(sql: any): Promise<MailFetchResult> {
  const settings = readSettings(sql);
  const email = settings.email || {};

  // The Yahoo Mail API comes first when it is set up. It is a plain HTTP
  // API, so the Worker can call it itself, and it hands back the raw
  // source of each message.
  if (hasYahooConfig(email)) {
    return fetchFromYahoo(email);
  }

  const serverUrl = (email.jmap_server_url || "").trim();
  if (!serverUrl) {
    return {
      ok: false, fetched: 0, messages: [], raws: [], source: "none",
      message: "No mail server is configured. Add a Yahoo application in " +
               "Settings, or forward mail to POST /api/inbox.",
    };
  }
  if (!email.jmap_username || !email.jmap_password) {
    return {
      ok: false, fetched: 0, messages: [],
      message: "The mail server is set, but the username or the password is missing.",
    };
  }

  const rows = sql
    .exec(
      "SELECT MAX(received_at) AS newest FROM inbox WHERE id LIKE ?",
      JMAP_ID_PREFIX + "%"
    )
    .toArray();
  const newest = rows.length > 0 ? rows[0].newest : null;
  const since = newest ? new Date(Number(newest) - 60_000).toISOString() : null;

  const config: JMAPConfig = {
    server_url: serverUrl,
    username: email.jmap_username,
    password: email.jmap_password,
  };

  const messages = await fetchEmailsSince(config, since, 50);
  return {
    ok: true,
    fetched: messages.length,
    messages,
    raws: [],
    source: "jmap",
    message: messages.length === 0
      ? "Nothing new."
      : `Fetched ${messages.length} message(s).`,
  };
}

/**
 * Fetch over the Yahoo Mail API.
 *
 * The messages come back as raw MIME, so the inbox parses them the same
 * way it parses a message posted from outside.
 */
async function fetchFromYahoo(email: any): Promise<MailFetchResult> {
  const config: YahooConfig = {
    client_id: email.yahoo_client_id,
    client_secret: email.yahoo_client_secret,
    refresh_token: email.yahoo_refresh_token,
    mailbox_id: email.yahoo_mailbox_id || "/",
  };

  const listing = await listMessages(config, 25);
  const raws: Array<{ id: string; raw: string }> = [];

  for (const message of (listing as any).messages || []) {
    try {
      const raw = await getRawMessage(config, message.id);
      raws.push({ id: message.id, raw });
    } catch {
      // One message that will not come down is not a reason to stop.
    }
  }

  return {
    ok: true,
    fetched: raws.length,
    messages: [],
    raws,
    source: "yahoo",
    message: raws.length === 0
      ? "Nothing new."
      : `Fetched ${raws.length} message(s) from Yahoo.`,
  };
}
