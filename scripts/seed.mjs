#!/usr/bin/env node
/**
 * seed.mjs — load the QA/chaos fixtures into a running TaskMaster instance.
 *
 * Usage:
 *   npm run seed                       # against http://localhost:8787
 *   npm run seed -- --api https://…    # against any other instance
 *   npm run seed -- --dry-run          # print the plan, change nothing
 *
 * What it does:
 *   1. Creates any fixture list that does not already exist (matched by name).
 *   2. Posts every fixture todo, remapping each fixture list key to the
 *      server-assigned list id (the API derives ids from names).
 *   3. Sends the negative cases and asserts the API REJECTS them with the
 *      documented status code, so the seeder doubles as a smoke test.
 *
 * Exits non-zero if any request fails or a negative case is not rejected.
 * Pure Node 18+, no dependencies.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "seed", "chaos-fixtures.json");

/* ── arguments ─────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = value("--api", process.env.API_URL ?? "http://localhost:8787").replace(/\/+$/, "");
const DRY_RUN = flag("--dry-run");

const fixtures = JSON.parse(readFileSync(FIXTURES, "utf8"));

/* ── helpers ───────────────────────────────────────────────────────── */

const failures = [];
const record = (ok, message) => {
  console.log(`${ok ? "  \u2705" : "  \u274c"} ${message}`);
  if (!ok) failures.push(message);
};

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body is itself a finding */
  }
  return { status: res.status, body };
}

/* ── plan ──────────────────────────────────────────────────────────── */

console.log(`\nSeeding TaskMaster chaos fixtures`);
console.log(`  target:   ${BASE}`);
console.log(`  fixtures: ${join("seed", "chaos-fixtures.json")}`);
console.log(`  lists:    ${fixtures.lists.length}   todos: ${fixtures.todos.length}   negative cases: ${fixtures.negativeCases.length}\n`);

if (DRY_RUN) {
  console.log("Dry run — nothing was sent. Would create:");
  for (const list of fixtures.lists) console.log(`  list  ${list.key}  "${list.name}"`);
  for (const todo of fixtures.todos) console.log(`  todo  ${todo.key}  -> ${todo.list_id}`);
  for (const nc of fixtures.negativeCases) console.log(`  neg   ${nc.key}  (expect ${nc.expectStatus})`);
  console.log("");
  process.exit(0);
}

/* ── 1. lists ──────────────────────────────────────────────────────── */

console.log("Lists");
let existing;
try {
  existing = await api("/api/lists");
} catch (err) {
  console.error(`\n\u274c Cannot reach ${BASE}: ${err.message}`);
  console.error("  Start the app first:  npx wrangler dev");
  process.exit(1);
}

const idByName = new Map((existing.body ?? []).map((l) => [l.name, l.id]));
const listIdByKey = new Map();

for (const list of fixtures.lists) {
  if (idByName.has(list.name)) {
    listIdByKey.set(list.key, idByName.get(list.name));
    record(true, `list "${list.name}" already exists (${idByName.get(list.name)})`);
    continue;
  }
  const created = await api("/api/lists", { method: "POST", body: JSON.stringify(list) });
  const id = created.body?.id;
  if (created.status === 201 && id) {
    listIdByKey.set(list.key, id);
    idByName.set(list.name, id);
    record(true, `created list "${list.name}" -> ${id}`);
  } else {
    record(false, `list "${list.name}" returned ${created.status}: ${JSON.stringify(created.body)}`);
  }
}

/* ── 2. todos ──────────────────────────────────────────────────────── */

console.log("\nTodos");
let posted = 0;
for (const todo of fixtures.todos) {
  const { key, ...payload } = todo;
  const resolvedListId = listIdByKey.get(payload.list_id) ?? payload.list_id;
  const res = await api("/api/todos", {
    method: "POST",
    body: JSON.stringify({ ...payload, list_id: resolvedListId }),
  });
  if (res.status === 201) {
    posted += 1;
    record(true, `${key} -> #${res.body?.id} in ${resolvedListId}`);
  } else {
    record(false, `${key} returned ${res.status}: ${JSON.stringify(res.body)}`);
  }
}

/* ── 3. negative cases: these MUST be rejected ─────────────────────── */

console.log("\nNegative cases (the API is expected to reject these)");
for (const nc of fixtures.negativeCases) {
  const res = await api("/api/todos", { method: "POST", body: JSON.stringify(nc.payload) });
  const ok = res.status === nc.expectStatus;
  record(ok, `${nc.key}: got ${res.status}, expected ${nc.expectStatus} — ${nc.reason}`);
}

/* ── 4. verify nothing was destroyed ───────────────────────────────── */

console.log("\nIntegrity");
const todos = await api("/api/todos");
const rows = Array.isArray(todos.body) ? todos.body : [];
record(rows.length >= posted, `GET /api/todos returns ${rows.length} rows after seeding (expected >= ${posted})`);
record(
  rows.some((r) => String(r.title).includes("DROP TABLE")),
  "the SQL-injection probe survived as data, proving it was parameterised",
);

/* ── report ────────────────────────────────────────────────────────── */

if (failures.length > 0) {
  console.error(`\n\u274c ${failures.length} problem(s) while seeding. See above.`);
  process.exit(1);
}

console.log(`\n\u2705 Seeded ${posted} todos into ${listIdByKey.size} lists at ${BASE}.`);
console.log("   Next: open the app and check the expectations in seed/chaos-fixtures.json.\n");
