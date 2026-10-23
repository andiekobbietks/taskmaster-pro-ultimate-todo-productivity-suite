/**
 * The dev server: the built frontend plus the real API.
 *
 * Why this exists
 * ---------------
 * `python -m http.server public` serves the built files and nothing
 * else. The frontend calls the API with relative paths, so every
 * POST, PUT and DELETE went to the static server, which answered
 * "501 Unsupported method ('POST')". Reads looked fine; anything that
 * wrote was broken. The error appeared in the UI as a red toast and
 * nothing else, which is the worst kind of failure.
 *
 * This serves the same static files and forwards every /api call to
 * the Worker running on 8787, so one URL does the whole job.
 *
 * Usage:
 *   npx wrangler dev --port 8787     (the Worker, in another terminal)
 *   node scripts/dev-server.mjs 8080  (this, in front of it)
 *
 * Then open http://127.0.0.1:8080
 *
 * No new dependencies: node:http, node:fs and node:path only.
 */

import { createServer, request as httpRequest } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const PORT = Number(process.argv[2] || 8080);
const API_HOST = process.env.API_HOST || "127.0.0.1";
const API_PORT = Number(process.env.API_PORT || 8787);
const ROOT = join(import.meta.dirname, "..", "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".wacz": "application/octet-stream",
};

/** The paths that belong to the API rather than to the static build. */
function isApiPath(url) {
  return url.startsWith("/api/") || url === "/health";
}

const server = createServer((req, res) => {
  const url = req.url || "/";

  // --- The API -----------------------------------------------------------
  if (isApiPath(url)) {
    const proxy = httpRequest(
      {
        host: API_HOST,
        port: API_PORT,
        method: req.method,
        path: url,
        headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(res);
      }
    );
    proxy.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "The API is not answering.",
          detail: String(err.message || err),
          hint: `Is the Worker running on ${API_HOST}:${API_PORT}? Start it with: npx wrangler dev --port ${API_PORT}`,
        })
      );
    });
    req.pipe(proxy);
    return;
  }

  // --- The static build --------------------------------------------------
  // normalize() keeps a ".." in the path from walking out of public/.
  const clean = normalize(decodeURIComponent(url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  let file = join(ROOT, clean);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // A single-page app: unknown paths fall back to the shell.
    file = join(ROOT, "index.html");
  }
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found. Has the frontend been built? npm run build");
    return;
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`TaskMaster Pro dev server: http://127.0.0.1:${PORT}`);
  console.log(`  static: ${ROOT}`);
  console.log(`  api:    http://${API_HOST}:${API_PORT}`);
  console.log("  (start the Worker first: npx wrangler dev --port " + API_PORT + ")");
});
