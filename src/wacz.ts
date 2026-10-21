/**
 * Reading a WACZ file.
 *
 * A WACZ is a zip archive (Webrecorder specification 1.1.1) holding:
 *
 *   archive/data.warc.gz   every raw HTTP transaction, gzipped
 *   pages/pages.jsonl      one JSON line per captured page
 *   indexes/index.cdx.gz   a CDX index, for random access
 *   datapackage.json       the collection description
 *
 * The zip is read here by hand, because a Worker has no zip reader in the
 * runtime. The central directory is walked, and each entry is inflated
 * with DecompressionStream. The WARC inside is gunzipped the same way.
 *
 * The point of the format is that it holds the network traffic, not just
 * the rendered page. A snapshot of the DOM loses the API calls that
 * produced it, and with them the state machine.
 */

// ── Zip ───────────────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  // The EOCD is at the end, after a possible comment. Scan backwards.
  const dv = view(data);
  const start = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= start; i--) {
    if (dv.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * Read the central directory of a zip archive.
 */
export function readZipDirectory(data: Uint8Array): ZipEntry[] {
  const dv = view(data);
  const eocd = findEndOfCentralDirectory(data);
  if (eocd < 0) throw new Error("not a zip archive: no end-of-central-directory record");

  const count = dv.getUint16(eocd + 10, true);
  let offset = dv.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;
    const method = dv.getUint16(offset + 10, true);
    const compressedSize = dv.getUint32(offset + 20, true);
    const uncompressedSize = dv.getUint32(offset + 24, true);
    const nameLen = dv.getUint16(offset + 28, true);
    const extraLen = dv.getUint16(offset + 30, true);
    const commentLen = dv.getUint16(offset + 32, true);
    const localHeaderOffset = dv.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLen));
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read one entry out of a zip archive.
 */
export async function readZipEntry(data: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const dv = view(data);
  const base = entry.localHeaderOffset;
  if (dv.getUint32(base, true) !== LOCAL_SIGNATURE) {
    throw new Error("corrupt zip: bad local header for " + entry.name);
  }
  const nameLen = dv.getUint16(base + 26, true);
  const extraLen = dv.getUint16(base + 28, true);
  const start = base + 30 + nameLen + extraLen;
  const raw = data.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return raw;                       // stored
  if (entry.method === 8) return await inflateRaw(raw);     // deflate
  throw new Error("unsupported zip compression method " + entry.method);
}

/**
 * The most a single entry may inflate to.
 *
 * A zip bomb is small on the wire and enormous once inflated. The Durable
 * Object is single-threaded, so a runaway inflation stalls every request
 * the app serves. 64 MB is far more than any real capture needs.
 */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/**
 * The most one WARC record's body may be.
 */
export const MAX_RECORD_BYTES = 16 * 1024 * 1024;

/**
 * Read a stream, stopping at the limit.
 *
 * DecompressionStream has no ceiling of its own, so the bytes are read in
 * chunks and the reader is cancelled as soon as the limit is passed.
 */
async function readCapped(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("the archive expands past " + limit + " bytes");
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as BlobPart]).stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return readCapped(stream, MAX_INFLATED_BYTES);
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as BlobPart]).stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return readCapped(stream, MAX_INFLATED_BYTES);
}

// ── WACZ ──────────────────────────────────────────────────────────────

export interface WaczPage {
  url: string;
  title?: string;
  timestamp?: string;
  mimeType?: string;
  status?: string;
  pageId?: string;
}

export interface WaczArchive {
  /** The captured pages, in order */
  pages: WaczPage[];
  /** The WARC records, parsed */
  records: WarcRecord[];
  /** The collection description, if it is there */
  datapackage?: any;
}

export interface WarcRecord {
  /** The WARC record type, e.g. response */
  type: string;
  /** The URL, from the WARC-Type or the HTTP request line */
  url: string;
  /** The HTTP status code */
  status?: number;
  /** The response headers */
  headers: Record<string, string>;
  /** The response body, as bytes */
  body: Uint8Array;
  /** The content type, if it is there */
  contentType?: string;
}

/**
 * Read a WACZ archive.
 */
export async function readWacz(data: Uint8Array): Promise<WaczArchive> {
  const directory = readZipDirectory(data);
  const byName = new Map(directory.map((e) => [e.name, e]));

  // pages/pages.jsonl
  const pages: WaczPage[] = [];
  const pagesEntry = byName.get("pages/pages.jsonl");
  if (pagesEntry) {
    const text = new TextDecoder().decode(await readZipEntry(data, pagesEntry));
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        pages.push(JSON.parse(line));
      } catch {
        // A malformed line is skipped rather than failing the whole file.
      }
    }
  }

  // archive/data.warc.gz, or data.warc.gz
  let records: WarcRecord[] = [];
  const warcEntry = byName.get("archive/data.warc.gz") || byName.get("data.warc.gz");
  if (warcEntry) {
    const gz = await readZipEntry(data, warcEntry);
    const warcBytes = gz[0] === 0x1f && gz[1] === 0x8b ? await gunzip(gz) : gz;
    records = parseWarc(warcBytes);
  }

  // datapackage.json
  let datapackage: any;
  const dpEntry = byName.get("datapackage.json");
  if (dpEntry) {
    try {
      datapackage = JSON.parse(
        new TextDecoder().decode(await readZipEntry(data, dpEntry)));
    } catch {
      // Not fatal.
    }
  }

  return { pages, records, datapackage };
}

/**
 * Parse a WARC file into records.
 *
 * A WARC is a sequence of records, each one a set of "Name: value" header
 * lines, a blank line, then the payload, then two CRLFs.
 */
export function parseWarc(data: Uint8Array): WarcRecord[] {
  const records: WarcRecord[] = [];
  const text = new TextDecoder("utf-8", { fatal: false });

  // The byte offsets matter, because the payload can be binary. Work on
  // the bytes and decode the headers only.
  let pos = 0;
  while (pos < data.length) {
    // Skip the CRLFs between records.
    while (pos < data.length && (data[pos] === 0x0d || data[pos] === 0x0a)) pos++;
    if (pos >= data.length) break;

    const headerEnd = findBlankLine(data, pos);
    if (headerEnd < 0) break;
    const headerText = text.decode(data.subarray(pos, headerEnd.pos));
    const headers: Record<string, string> = {};
    let type = "";
    for (const line of headerText.split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i <= 0) continue;
      const name = line.slice(0, i).trim().toLowerCase();
      const value = line.slice(i + 1).trim();
      headers[name] = value;
      if (name === "warc-type") type = value;
    }

    const bodyStart = headerEnd.after;
    // The record declares its own length. A record that declares a huge
    // one is capped, and the cap is the length that is read.
    const declared = parseInt(headers["content-length"] || "0", 10);
    const length = Math.min(
      Number.isNaN(declared) ? 0 : declared,
      MAX_RECORD_BYTES
    );
    const body = data.subarray(bodyStart, bodyStart + length);

    // The request line gives the URL and the method.
    const requestLine = headers["warc-target-uri"] || "";
    let httpStatus = parseInt(headers["http-status"] || headers["warc-status-code"] || "", 10);
    let contentType = headers["content-type"];
    let payload = body;

    // A response record carries the whole HTTP exchange in its payload:
    // a status line, the headers, then the body. Split them, so the body
    // is the HTML and the status is a number.
    if (type === "response") {
      const http = splitHttpResponse(body);
      if (http) {
        httpStatus = http.status;
        contentType = http.contentType || contentType;
        payload = http.body;
      }
    }

    records.push({
      type,
      url: requestLine,
      status: Number.isNaN(httpStatus) ? undefined : httpStatus,
      headers,
      body: payload,
      contentType,
    });

    pos = bodyStart + length;
  }
  return records;
}

/**
 * Split an embedded HTTP response into its status, headers and body.
 */
function splitHttpResponse(
  payload: Uint8Array
): { status: number; headers: Record<string, string>; contentType?: string; body: Uint8Array } | null {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(
    payload.subarray(0, Math.min(payload.length, 8192)));
  const lines = text.split(/\r?\n/);
  if (!lines.length || !/^HTTP\/1\.[01] /.test(lines[0])) return null;

  const status = parseInt(lines[0].split(" ")[1] || "", 10);
  const headers: Record<string, string> = {};
  let bodyStart = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") { bodyStart = i + 1; break; }
    const c = line.indexOf(":");
    if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
  }

  // The byte offset of the body has to be found in the bytes, not in the
  // decoded text, because the body can be binary.
  const headerBytes = findBlankLine(payload, 0);
  let body = payload;
  if (headerBytes) {
    body = payload.subarray(headerBytes.after);
  } else {
    body = new Uint8Array(0);
  }

  return { status, headers, contentType: headers["content-type"], body };
}

function findBlankLine(data: Uint8Array, from: number): { pos: number; after: number } | null {
  for (let i = from; i < data.length - 1; i++) {
    if (data[i] === 0x0d && data[i + 1] === 0x0a &&
        data[i + 2] === 0x0d && data[i + 3] === 0x0a) {
      return { pos: i, after: i + 4 };
    }
    if (data[i] === 0x0a && data[i + 1] === 0x0a) {
      return { pos: i, after: i + 2 };
    }
  }
  return null;
}

/**
 * Find the response record for a URL.
 *
 * The page may have been captured under a slightly different URL, so the
 * comparison is on the host and the path, ignoring the query.
 */
export function findResponse(records: WarcRecord[], url: string): WarcRecord | null {
  const wanted = normaliseUrl(url);
  const byExact = records.find(
    (r) => r.type === "response" && normaliseUrl(r.url) === wanted);
  if (byExact) return byExact;

  const byHost = records.find(
    (r) => r.type === "response" && hostOf(r.url) === hostOf(wanted));
  return byHost || null;
}

function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The body of a response record, as text.
 */
export function recordText(record: WarcRecord): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(record.body);
}
