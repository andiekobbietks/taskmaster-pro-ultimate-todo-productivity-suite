#!/usr/bin/env node
/**
 * validate-seed.mjs — guard the QA/chaos fixtures.
 *
 * Fails the build if seed/chaos-fixtures.json is malformed, so a broken fixture
 * is caught in CI rather than halfway through someone's test session.
 *
 * Pure Node, no dependencies. Run: node scripts/validate-seed.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "seed", "chaos-fixtures.json");

const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const violations = [];
const problem = (where, message) => violations.push(`${where}: ${message}`);

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

let fixtures;
try {
  fixtures = JSON.parse(readFileSync(FIXTURES, "utf8"));
} catch (err) {
  console.error(`\u274c ${FIXTURES} could not be parsed: ${err.message}`);
  process.exit(1);
}

/* ── _meta ─────────────────────────────────────────────────────────── */

if (!fixtures._meta || !isNonEmptyString(fixtures._meta.purpose)) {
  problem("_meta", "must exist and carry a non-empty 'purpose' string");
}

/* ── lists ─────────────────────────────────────────────────────────── */

const listKeys = new Set();
if (!Array.isArray(fixtures.lists) || fixtures.lists.length === 0) {
  problem("lists", "must be a non-empty array");
} else {
  fixtures.lists.forEach((list, i) => {
    const where = `lists[${i}]`;
    if (!isNonEmptyString(list.key)) problem(where, "'key' must be a non-empty string");
    else if (listKeys.has(list.key)) problem(where, `duplicate key '${list.key}'`);
    else listKeys.add(list.key);

    if (!isNonEmptyString(list.name)) problem(where, "'name' must be a non-empty string");
    if (list.color !== undefined && !HEX_COLOR_RE.test(list.color)) {
      problem(where, `'color' must be a #RRGGBB hex string, got ${JSON.stringify(list.color)}`);
    }
    if (list.icon !== undefined && typeof list.icon !== "string") {
      problem(where, "'icon' must be a string when present");
    }
  });
}

/* ── todos ─────────────────────────────────────────────────────────── */

const todoKeys = new Set();
const seenTitles = new Map();
if (!Array.isArray(fixtures.todos) || fixtures.todos.length === 0) {
  problem("todos", "must be a non-empty array");
} else {
  fixtures.todos.forEach((todo, i) => {
    const where = `todos[${i}]`;
    const label = isNonEmptyString(todo.key) ? `${where} (${todo.key})` : where;

    if (!isNonEmptyString(todo.key)) problem(where, "'key' must be a non-empty string");
    else if (todoKeys.has(todo.key)) problem(where, `duplicate key '${todo.key}'`);
    else todoKeys.add(todo.key);

    if (!isNonEmptyString(todo.title)) problem(label, "'title' must be a non-empty string");
    else seenTitles.set(todo.title, (seenTitles.get(todo.title) ?? 0) + 1);

    if (todo.description !== undefined && typeof todo.description !== "string") {
      problem(label, "'description' must be a string when present");
    }
    if (!PRIORITIES.has(todo.priority)) {
      problem(label, `'priority' must be one of ${[...PRIORITIES].join("/")}, got ${JSON.stringify(todo.priority)}`);
    }
    if (todo.due_date !== null && todo.due_date !== undefined && !DATE_RE.test(todo.due_date)) {
      problem(label, `'due_date' must be null or YYYY-MM-DD, got ${JSON.stringify(todo.due_date)}`);
    }
    if (todo.list_id !== undefined && typeof todo.list_id !== "string") {
      problem(label, "'list_id' must be a string when present");
    }
    if (!Array.isArray(todo.tags) || todo.tags.some((t) => typeof t !== "string")) {
      problem(label, "'tags' must be an array of strings");
    }
    if (
      todo.estimated_pomodoros !== undefined &&
      typeof todo.estimated_pomodoros !== "number"
    ) {
      problem(label, "'estimated_pomodoros' must be a number when present");
    }
    if (todo.is_pinned !== undefined && typeof todo.is_pinned !== "boolean") {
      problem(label, "'is_pinned' must be a boolean when present");
    }
  });

  // Every todo must point at a list this fixture file also creates, otherwise
  // the seeder would reference a list that does not exist yet.
  fixtures.todos.forEach((todo) => {
    if (todo.list_id !== undefined && !listKeys.has(todo.list_id)) {
      problem(`todos (${todo.key})`, `list_id '${todo.list_id}' is not declared in 'lists'`);
    }
  });
}

/* ── negativeCases ─────────────────────────────────────────────────── */

const negativeKeys = new Set();
if (!Array.isArray(fixtures.negativeCases) || fixtures.negativeCases.length === 0) {
  problem("negativeCases", "must be a non-empty array of requests that SHOULD fail");
} else {
  fixtures.negativeCases.forEach((nc, i) => {
    const where = `negativeCases[${i}]`;
    if (!isNonEmptyString(nc.key)) problem(where, "'key' must be a non-empty string");
    else if (negativeKeys.has(nc.key)) problem(where, `duplicate key '${nc.key}'`);
    else negativeKeys.add(nc.key);

    if (nc.payload === null || typeof nc.payload !== "object") {
      problem(where, "'payload' must be an object");
    }
    if (typeof nc.expectStatus !== "number") {
      problem(where, "'expectStatus' must be the HTTP status the API is expected to return");
    }
    if (!isNonEmptyString(nc.reason)) {
      problem(where, "'reason' must explain what behaviour is being asserted");
    }
  });
}

/* ── expectations ──────────────────────────────────────────────────── */

if (!fixtures.expectations || typeof fixtures.expectations !== "object") {
  problem("expectations", "must document what a tester should assert after seeding");
}

/* ── report ────────────────────────────────────────────────────────── */

const duplicateTitles = [...seenTitles.entries()].filter(([, n]) => n > 1);

if (violations.length > 0) {
  console.error("\u274c seed/chaos-fixtures.json failed validation:\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`\n${violations.length} problem(s). Fix the fixtures, then re-run.`);
  process.exit(1);
}

console.log("\u2705 seed/chaos-fixtures.json is valid");
console.log(`   ${fixtures.lists.length} lists`);
console.log(`   ${fixtures.todos.length} todos (${duplicateTitles.length} intentional duplicate-title group(s))`);
console.log(`   ${fixtures.negativeCases.length} negative case(s) expected to be rejected`);
console.log(`   ${Object.keys(fixtures.expectations).length} documented expectation(s)`);
