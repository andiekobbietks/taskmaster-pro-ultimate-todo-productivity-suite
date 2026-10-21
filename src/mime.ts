/**
 * Raw MIME parsing.
 *
 * Mail arrives in two shapes. JMAP hands over structured fields. IMAP and
 * the Yahoo Mail API both hand over the raw source: the header block and
 * the body, exactly as it was sent.
 *
 * This module turns the raw source into the same fields, so the inbox
 * does not care which transport delivered the message.
 *
 * What the raw source actually looks like, from a real Devpost message
 * read through the Yahoo Mail API:
 *
 *   - the header block is folded: a header continues on the next line
 *     with a leading space or tab
 *   - several headers repeat (Received appears four times), so a header
 *     is a list, not a single value
 *   - the body is multipart/alternative, with a text/plain part and a
 *     text/html part
 *   - both parts are quoted-printable, which means "=E2=86=92" is a byte
 *     and a trailing "=" is a soft line break that has to be removed
 *   - the charset is utf-8, but it is declared, so it should be read
 *
 * The fixture in scripts/fixtures/sample-raw-email.txt is that message.
 */

export interface ParsedMail {
  /** The sender's address, e.g. support@devpost.com */
  from: string;
  /** The sender's display name, e.g. Devpost */
  fromName: string;
  /** Every recipient, verbatim */
  to: string;
  subject: string;
  /** The Date header, as sent */
  date: string;
  /** The Date header, as milliseconds since the epoch, or null */
  dateMs: number | null;
  /** The Message-Id, with the angle brackets */
  messageId: string;
  replyTo: string;
  returnPath: string;
  /** The text/plain part, decoded */
  textBody: string;
  /** The text/html part, decoded */
  htmlBody: string;
  /** Every header, in order, with the repeats kept */
  headers: Array<{ name: string; value: string }>;
  /** The attachment names found in the message */
  attachmentNames: string[];
  /** True when the source parsed as a message at all */
  ok: boolean;
  /** Why it did not parse, when ok is false */
  error?: string;
}

const EMPTY: ParsedMail = {
  from: "", fromName: "", to: "", subject: "", date: "", dateMs: null,
  messageId: "", replyTo: "", returnPath: "", textBody: "", htmlBody: "",
  headers: [], attachmentNames: [], ok: false, error: "empty source",
};

/**
 * Parse a raw MIME source into fields.
 */
export function parseRawMail(source: string): ParsedMail {
  if (!source || !source.trim()) return { ...EMPTY };

  const split = splitHeadersAndBody(source);
  if (!split) {
    return { ...EMPTY, error: "no header block found" };
  }

  const headers = parseHeaderBlock(split.headers);
  const contentType = getHeader(headers, "content-type") || "text/plain";

  let textBody = "";
  let htmlBody = "";
  const attachmentNames: string[] = [];

  const parts = collectParts(split.body, contentType, headers);
  for (const part of parts) {
    const disposition = (part.headers["content-disposition"]?.[0] || "").toLowerCase();
    const type = (part.headers["content-type"]?.[0] || "").toLowerCase();

    if (type.startsWith("text/plain") && !disposition.includes("attachment")) {
      if (!textBody) textBody = part.text;
    } else if (type.startsWith("text/html") && !disposition.includes("attachment")) {
      if (!htmlBody) htmlBody = part.text;
    } else {
      const name = filenameFrom(part.headers);
      if (name) attachmentNames.push(name);
    }
  }

  // A message with no text/plain part still has readable text in its HTML.
  if (!textBody && htmlBody) {
    textBody = htmlToText(htmlBody);
  }

  const fromRaw = getHeader(headers, "from") || "";
  const addr = parseAddress(fromRaw);
  const dateRaw = decodeHeaderValue(getHeader(headers, "date") || "");

  return {
    from: addr.address,
    fromName: addr.name,
    to: decodeHeaderValue(getHeader(headers, "to") || ""),
    subject: decodeHeaderValue(getHeader(headers, "subject") || ""),
    date: dateRaw,
    dateMs: parseDate(dateRaw),
    messageId: (getHeader(headers, "message-id") || "").trim(),
    replyTo: decodeHeaderValue(getHeader(headers, "reply-to") || ""),
    returnPath: (getHeader(headers, "return-path") || "").trim(),
    textBody,
    htmlBody,
    headers: headers.flat,
    attachmentNames,
    ok: true,
  };
}

// ── Headers ───────────────────────────────────────────────────────────

interface HeaderList {
  order: string[];
  map: Record<string, string[]>;
  /** Every header, in the order they appeared, with the repeats kept */
  flat: Array<{ name: string; value: string }>;
}

function splitHeadersAndBody(source: string): { headers: string; body: string } | null {
  // The header block ends at the first blank line. A message with no body
  // is all headers.
  const m = /\r?\n\r?\n/.exec(source);
  if (!m) {
    // No blank line: either headers only, or a bare body. If the first line
    // looks like a header, treat the whole thing as headers.
    if (/^[A-Za-z][A-Za-z0-9-]*:/.test(source)) {
      return { headers: source, body: "" };
    }
    return null;
  }
  return { headers: source.slice(0, m.index), body: source.slice(m.index + m[0].length) };
}

function parseHeaderBlock(block: string): HeaderList {
  const order: string[] = [];
  const map: Record<string, string[]> = {};
  const flat: Array<{ name: string; value: string }> = [];

  // Unfold first: a header continues on the next line when that line
  // starts with a space or a tab.
  const unfolded: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += " " + line.trim();
    } else if (line.trim() !== "") {
      unfolded.push(line);
    }
  }

  for (const line of unfolded) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (!map[name]) {
      map[name] = [];
      order.push(name);
    }
    map[name].push(value);
    flat.push({ name, value });
  }
  return { order, map, flat };
}

function getHeader(headers: HeaderList, name: string): string {
  const list = headers.map[name.toLowerCase()];
  return list && list.length > 0 ? list[0] : "";
}

// ── Bodies ────────────────────────────────────────────────────────────

interface Part {
  headers: Record<string, string>;
  text: string;
}

/**
 * Walk a body and return the leaf parts.
 *
 * A part is multipart if its content type says so and carries a boundary.
 * The boundary is quoted in the header, so it is unquoted first.
 */
function collectParts(body: string, contentType: string, headers: HeaderList): Part[] {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const boundary = param(contentType, "boundary");

  if (type.startsWith("multipart/") && boundary) {
    const chunks = splitOnBoundary(body, boundary);
    const out: Part[] = [];
    for (const chunk of chunks) {
      const sub = splitHeadersAndBody(chunk);
      if (!sub) continue;
      const subHeaders = parseHeaderBlock(sub.headers);
      const subType = getHeader(subHeaders, "content-type") || "text/plain";
      if (subType.split(";")[0].trim().toLowerCase().startsWith("multipart/")) {
        out.push(...collectParts(sub.body, subType, subHeaders));
      } else {
        out.push({
          headers: subHeaders.map,
          text: decodePart(sub.body, subHeaders.map),
        });
      }
    }
    return out;
  }

  // A single-part body.
  const encoding = (getHeader(headers, "content-transfer-encoding") || "").toLowerCase();
  const charset = param(contentType, "charset") || "utf-8";
  return [{
    headers: headers.map,
    text: decodeText(body, encoding, charset),
  }];
}

function splitOnBoundary(body: string, boundary: string): string[] {
  const marker = "--" + boundary;
  const chunks: string[] = [];
  let current: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === marker) {
      if (current !== null) chunks.push(current);
      current = "";
      continue;
    }
    if (line.trim() === marker + "--") {
      if (current !== null) chunks.push(current);
      current = null;
      break;
    }
    if (current !== null) current += line + "\n";
  }
  if (current !== null) chunks.push(current);
  return chunks;
}

function decodePart(body: string, headers: Record<string, string[]>): string {
  const encoding = (headers["content-transfer-encoding"]?.[0] || "").toLowerCase().trim();
  const charset = param(headers["content-type"]?.[0] || "", "charset") || "utf-8";
  return decodeText(body, encoding, charset);
}

/**
 * Decode a part's bytes into text.
 *
 * quoted-printable is the awkward one. "=E2=86=92" is three bytes, and
 * a "=" at the end of a line is a soft break that has to be removed
 * before the bytes are read. The bytes are assembled first and decoded
 * afterwards, so a multi-byte character survives.
 */
export function decodeText(body: string, encoding: string, charset: string): string {
  const enc = (encoding || "").toLowerCase().trim();

  if (enc === "base64") {
    return bytesToText(base64ToBytes(body), charset);
  }

  if (enc === "quoted-printable") {
    return bytesToText(quotedPrintableToBytes(body), charset);
  }

  // 7bit, 8bit, binary and anything unknown: the bytes are as they are.
  return bytesToText(textToBytes(body), charset);
}

function quotedPrintableToBytes(input: string): number[] {
  const bytes: number[] = [];
  const s = input;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=") {
      // A soft break: "=" followed by the end of a line.
      if (s[i + 1] === "\n") { i += 1; continue; }
      if (s[i + 1] === "\r" && s[i + 2] === "\n") { i += 2; continue; }
      const hex = s.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
      // Not a valid escape. Keep the "=" as a literal.
      bytes.push(61);
      continue;
    }
    const code = s.charCodeAt(i);
    if (code < 256) bytes.push(code);
    else bytes.push(code & 0xff);
  }
  return bytes;
}

function base64ToBytes(input: string): number[] {
  const clean = input.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes: number[] = [];
  for (let i = 0; i < binary.length; i++) bytes.push(binary.charCodeAt(i) & 0xff);
  return bytes;
}

function textToBytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 256) bytes.push(code);
    else {
      // Beyond Latin-1. Encode as UTF-8.
      const buf = new TextEncoder().encode(input[i]);
      for (const b of buf) bytes.push(b);
    }
  }
  return bytes;
}

function bytesToText(bytes: number[], charset: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
}

// ── Values ────────────────────────────────────────────────────────────

/**
 * Read a parameter out of a header value, e.g. the boundary.
 */
export function param(value: string, name: string): string {
  const lower = value.toLowerCase();
  const at = lower.indexOf(name.toLowerCase() + "=");
  if (at < 0) return "";
  let rest = value.slice(at + name.length + 1);
  rest = rest.trim();
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    return end > 0 ? rest.slice(1, end) : rest.slice(1);
  }
  const stop = rest.search(/[;\s]/);
  return stop > 0 ? rest.slice(0, stop) : rest;
}

/**
 * Split "Name <address>" into its two parts.
 */
export function parseAddress(value: string): { name: string; address: string } {
  const raw = (value || "").trim();
  const angled = /^(.*?)<([^>]*)>\s*$/.exec(raw);
  if (angled) {
    return {
      name: decodeHeaderValue(angled[1].trim().replace(/^"|"$/g, "")),
      address: angled[2].trim(),
    };
  }
  return { name: "", address: raw };
}

/**
 * Decode RFC 2047 encoded words, so a subject like
 * "=?utf-8?B?...?=" comes out readable.
 */
export function decodeHeaderValue(value: string): string {
  if (!value || value.indexOf("=?") < 0) return value || "";

  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_match, charset: string, enc: string, payload: string) => {
      try {
        if (enc.toUpperCase() === "B") {
          return bytesToText(base64ToBytes(payload), charset);
        }
        // Q encoding: underscores are spaces, "=XX" is a byte.
        const q = payload.replace(/_/g, " ");
        return bytesToText(quotedPrintableToBytes(q), charset);
      } catch {
        return _match;
      }
    }
  );
}

/**
 * Read an RFC 5322 date.
 */
export function parseDate(value: string): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Get the filename out of a part's headers.
 */
export function filenameFrom(headers: Record<string, string[]>): string {
  const disposition = headers["content-disposition"]?.[0] || "";
  if (disposition) {
    const name = param(disposition, "filename");
    if (name) return decodeHeaderValue(name);
  }
  const type = headers["content-type"]?.[0] || "";
  return param(type, "name");
}

/**
 * A rough text version of an HTML part.
 *
 * Enough to match a competition name against, and to show in the inbox
 * preview. Not a renderer, and it does not try to be.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
