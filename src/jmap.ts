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
export async function discoverJMAPSession(serverUrl: string): Promise<any> {
  const resp = await fetch(`${serverUrl}/.well-known/jmap`);
  if (!resp.ok) throw new Error(`JMAP session discovery failed: ${resp.status}`);
  return await resp.json();
}

// JMAP API call
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

  const emails = results.methodResponses?.[1]?.[1]?.list || [];
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
