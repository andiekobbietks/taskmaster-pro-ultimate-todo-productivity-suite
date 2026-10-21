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

export interface MailFetchResult {
  ok: boolean;
  fetched: number;
  messages: JMAPEmail[];
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

  const serverUrl = (email.jmap_server_url || "").trim();
  if (!serverUrl) {
    return {
      ok: false, fetched: 0, messages: [],
      message: "No mail server is configured. Add a JMAP server in Settings, " +
               "or forward mail to POST /api/inbox.",
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
    message: messages.length === 0
      ? "Nothing new."
      : `Fetched ${messages.length} message(s).`,
  };
}
