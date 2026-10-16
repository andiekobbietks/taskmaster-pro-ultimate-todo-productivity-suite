#!/usr/bin/env node
/**
 * extract-changelog.mjs — pull one version's notes out of CHANGELOG.md.
 *
 * Used by .github/workflows/release.yml so a GitHub Release's notes are written
 * once, in the changelog, and reused verbatim. Fails loudly if the tag has no
 * matching section, because shipping a release with empty notes is worse than
 * shipping no release.
 *
 * Usage: node scripts/extract-changelog.mjs v1.0.0
 * Emits: release-notes.md (and prints `version=` for workflow outputs)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "release-notes.md");

const rawTag = process.argv[2];
if (!rawTag) {
  console.error("usage: node scripts/extract-changelog.mjs <tag>   e.g. v1.0.0");
  process.exit(1);
}

const tag = rawTag.trim();
const version = tag.replace(/^v/, "");

const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const lines = changelog.split(/\r?\n/);

// Find `## [1.0.0] - date` (or `## [1.0.0]`).
const heading = /^##\s*\[?v?(.+?)\]?(\s+-\s+.*)?$/;
let start = -1;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(heading);
  if (m && m[1].trim() === version) {
    start = i + 1;
    break;
  }
}

if (start === -1) {
  console.error(`\u274c No "## [${version}]" section found in CHANGELOG.md.`);
  console.error("   Add a section for this version before tagging, so the release has real notes.");
  process.exit(1);
}

// Collect until the next top-level heading.
const body = [];
for (let i = start; i < lines.length; i++) {
  if (/^##\s/.test(lines[i])) break;
  body.push(lines[i]);
}

const notes = body.join("\n").replace(/^\s+/, "").replace(/\s+$/, "") + "\n";
writeFileSync(OUT, notes, "utf8");

console.log(`version=${version}`);
console.log(`Wrote ${OUT} (${notes.length} bytes) for tag ${tag}`);
