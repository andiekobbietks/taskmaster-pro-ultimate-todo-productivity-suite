/**
 * Copy the readable docs into the static build so the landing page can link
 * to them by URL (/docs/INDEX.md) and so the OpenAPI spec is served at
 * /openapi.yaml for the developer portal.
 *
 * Why a copy and not a route: the Worker serves static files from public/,
 * and the docs live in docs/ next to the source. Copying keeps one copy of
 * the truth (docs/) and one copy of what ships (public/docs/).
 *
 * Run: node scripts/build-docs.mjs   (part of `npm run build`)
 */
import { cpSync, mkdirSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DOCS = join(ROOT, "docs");
const OUT = join(ROOT, "public", "docs");

mkdirSync(OUT, { recursive: true });

// 1. Every markdown file at the top of docs/ becomes /docs/<name>.md
let copied = 0;
for (const name of readdirSync(DOCS)) {
  if (!name.endsWith(".md")) continue;
  copyFileSync(join(DOCS, name), join(OUT, name));
  copied++;
}

// 2. The OpenAPI spec ships next to the landing page.
const spec = join(ROOT, "openapi.yaml");
if (existsSync(spec)) {
  copyFileSync(spec, join(ROOT, "public", "openapi.yaml"));
  copied++;
}

// 3. The handbook PDF, when it has been built.
const pdf = join(ROOT, "public", "handbook", "TaskMaster_Pro_Design_System_Handbook.pdf");
if (existsSync(pdf)) copied++;

console.log(`build-docs: ${copied} file(s) into public/docs + public/openapi.yaml`);
