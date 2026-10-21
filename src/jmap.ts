/**
 * JMAP email protocol support — RFC 8620/8621.
 *
 * JMAP (JSON Meta Application Protocol) is the modern open email standard
 * that replaces IMAP/SMTP. Used by the French government (La Suite numerique)
 * and Fastmail. It's JSON-based, stateless, and easier to parse than IMAP.
 *
 * Design notes:
 * - JMAP is an alternative to IMAP for email ingestion
 * - All requests are HTTP POST with JSON bodies
 * - No persistent connections needed
 * - Attachments are referenced by blobId, not inline
 * - Built-in search and threading
 */

export interface JMAPConfig {
  server_url: string;
  username: string;
  password: string;  // or API token
  account_id?: string;
}

export interface JMAPEmail {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  textBody: string;
  htmlBody: string;
  attachments: Array<{
    blobId: string;
    name: string;
    type: string;
    size: number;
  }>;
}

// JMAP session discovery
/**
 * Discover the JMAP session endpoint for a given server URL.
 *
 * JMAP (RFC 8620) requires servers to expose a session resource at
 * `/.well-known/jmap`. This function fetches that resource to obtain
 * the API endpoint URL, account IDs, and download URLs.
 *
 * @param serverUrl - The base URL of the JMAP server
 * @returns The JMAP session object
 * @throws {Error} If session discovery fails
 */
export async function discoverJMAPSession(serverUrl: string): Promise<any> {
  const resp = await fetch(`${serverUrl}/.well-known/jmap`);
  if (!resp.ok) throw new Error(`JMAP session discovery failed: ${resp.status}`);
  return await resp.json();
}

// JMAP API call
/**
 * Make a JMAP API call with one or more method calls.
 *
 * JMAP uses a batched request model — multiple method calls can be
 * sent in a single HTTP POST. Method calls can reference results from
 * previous calls using result references (e.g., `#ids`).
 *
 * @param serverUrl - The base URL of the JMAP server
 * @param accountId - The JMAP account ID
 * @param methodCalls - Array of [methodName, arguments, callId] tuples
 * @param authToken - Bearer token for authentication
 * @returns The JMAP response with methodResponses
 */
export async function jmapCall(serverUrl: string, accountId: string, methodCalls: any[], authToken: string): Promise<any> {
  const resp = await fetch(`${serverUrl}/jmap/api/`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls,
    }),
  });
  if (!resp.ok) throw new Error(`JMAP call failed: ${resp.status}`);
  return await resp.json();
}

// Search for hackathon-related emails via JMAP
/**
 * Search for hackathon-related emails via JMAP.
 *
 * Uses JMAP's Email/query method with text filtering to find emails
 * mentioning hackathon, competition, challenge, or deadline. Returns
 * structured email objects with from, subject, body, and attachments.
 *
 * @param config - JMAP server configuration (URL, credentials, account ID)
 * @returns Array of parsed hackathon emails
 */
export async function searchHackathonEmails(config: JMAPConfig): Promise<JMAPEmail[]> {
  const session = await discoverJMAPSession(config.server_url);
  const accountId = config.account_id || session.primaryAccounts?.["urn:ietf:params:jmap:mail"];

  const results = await jmapCall(config.server_url, accountId, [
    ["Email/query", {
      filter: {
        text: "hackathon OR competition OR challenge OR deadline",
      },
      sort: [{ property: "receivedAt", isAscending: false }],
      limit: 50,
    }, "0"],
    ["Email/get", {
      "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
      properties: ["from", "subject", "receivedAt", "textBody", "htmlBody", "attachments"],
    }, "1"],
  ], config.password);

  return mapJMAPEmails(results);
}

/**
 * Pull every message received after a timestamp.
 *
 * Unlike searchHackathonEmails this does not filter by text: ingestion
 * wants everything, and the inbox decides what is interesting by matching
 * the content against the competitions being tracked.
 *
 * @param config - JMAP server configuration (URL, credentials, account ID)
 * @param sinceIso - ISO timestamp to fetch after, or null for the newest page
 * @param limit - How many messages to fetch at most
 */
export async function fetchEmailsSince(
  config: JMAPConfig,
  sinceIso: string | null,
  limit = 50
): Promise<JMAPEmail[]> {
  const session = await discoverJMAPSession(config.server_url);
  const accountId = config.account_id || session.primaryAccounts?.["urn:ietf:params:jmap:mail"];

  const filter: Record<string, unknown> = {};
  if (sinceIso) filter.after = sinceIso;

  const results = await jmapCall(config.server_url, accountId, [
    ["Email/query", {
      filter,
      sort: [{ property: "receivedAt", isAscending: false }],
      limit,
    }, "0"],
    ["Email/get", {
      "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
      properties: ["from", "subject", "receivedAt", "textBody", "htmlBody", "attachments"],
    }, "1"],
  ], config.password);

  return mapJMAPEmails(results);
}

/**
 * Turn a JMAP Email/get response into plain objects.
 */
function mapJMAPEmails(results: any): JMAPEmail[] {
  const emails = results?.methodResponses?.[1]?.[1]?.list || [];
  return emails.map((e: any) => ({
    id: e.id,
    from: e.from?.[0]?.email || "",
    subject: e.subject || "",
    receivedAt: e.receivedAt || "",
    textBody: e.textBody?.[0]?.value || "",
    htmlBody: e.htmlBody?.[0]?.value || "",
    attachments: e.attachments || [],
  }));
}

// Get email body content via JMAP
export async function getEmailBody(config: JMAPConfig, emailId: string): Promise<string> {
  const session = await discoverJMAPSession(config.server_url);
  const accountId = config.account_id || session.primaryAccounts?.["urn:ietf:params:jmap:mail"];

  const results = await jmapCall(config.server_url, accountId, [
    ["Email/get", {
      ids: [emailId],
      properties: ["textBody", "htmlBody"],
    }, "0"],
  ], config.password);

  const email = results.methodResponses?.[0]?.[1]?.list?.[0];
  return email?.textBody?.[0]?.value || email?.htmlBody?.[0]?.value || "";
}

// Download attachment via JMAP
export async function downloadAttachment(config: JMAPConfig, blobId: string): Promise<ArrayBuffer> {
  const session = await discoverJMAPSession(config.server_url);
  const downloadUrl = session.downloadUrl?.replace("{blobId}", blobId).replace("{name}", "attachment");
  if (!downloadUrl) throw new Error("No download URL in JMAP session");

  const resp = await fetch(downloadUrl, {
    headers: { "Authorization": `Bearer ${config.password}` },
  });
  if (!resp.ok) throw new Error(`JMAP download failed: ${resp.status}`);
  return await resp.arrayBuffer();
}
