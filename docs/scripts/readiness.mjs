#!/usr/bin/env node
/**
 * readiness.mjs — self-ticking maturity checklist.
 *
 * Reads the three inventories (features, architecture, sbom) plus the
 * declarative gate definitions, derives each gate's live status, and emits:
 *
 *   docs/readiness.json   machine-readable state
 *   docs/READINESS.md     human-readable view with next-action chips
 *
 * Run after any change to the inventories:
 *
 *   node docs/scripts/readiness.mjs
 *
 * Nothing here is hand-maintained. If a feature's status changes in
 * features.json, the gates recompute on the next run. Edit
 * docs/readiness-gates.json to change what a stage means.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (f) => JSON.parse(readFileSync(join(DOCS, f), "utf8"));

const features = read("features.json");
const arch = read("architecture.json");
const sbom = read("sbom.cyclonedx.json");
const gatesDoc = read("readiness-gates.json");

const featById = Object.fromEntries(features.features.map((f) => [f.id, f]));
const compById = Object.fromEntries(arch.components.map((c) => [c.id, c]));

/* ── derivation helpers ─────────────────────────────────────────────── */

const OK_STATUS = new Set(["implemented", "partial"]);
const OK_MATURITY = new Set(["solid", "adequate"]);

/** A gate's `derivedFrom` is a small rule language. Evaluate it. */
function evaluate(rule) {
  // explicit count-based rules
  if ("phantomCount" in rule) {
    const found = features.summary.phantomFeatures.length;
    return { pass: found <= rule.phantomCount, detail: `${found} phantom feature(s)` };
  }
  if ("unpinnedCount" in rule) {
    const comps = sbom.components.filter((c) => /UNPINNED/i.test(c.version));
    return { pass: comps.length <= rule.unpinnedCount, detail: `${comps.length} unpinned dep(s)` };
  }

  // single feature
  if (rule.featureId) {
    const f = featById[rule.featureId];
    if (!f) return { pass: false, detail: `${rule.featureId} missing` };
    const pass = rule.requireStatus.includes(f.status);
    return { pass, detail: `${rule.featureId} is "${f.status}"` };
  }

  // all-of features
  if (rule.allOf) {
    const bad = rule.allOf.filter((id) => !rule.requireStatus.includes(featById[id]?.status));
    return { pass: bad.length === 0, detail: bad.length ? `not ready: ${bad.join(", ")}` : `all ${rule.allOf.length} ready` };
  }

  // any-of features
  if (rule.anyOfFeatures) {
    const ok = rule.anyOfFeatures.filter((id) => rule.requireStatus.includes(featById[id]?.status));
    return { pass: ok.length > 0, detail: ok.length ? `satisfied by ${ok[0]}` : `none of ${rule.anyOfFeatures.join("/")} ready` };
  }

  // single component
  if (rule.componentId) {
    const c = compById[rule.componentId];
    if (!c) return { pass: false, detail: `${rule.componentId} missing` };
    const pass = rule.requireMaturity.includes(c.maturity);
    return { pass, detail: `${rule.componentId} is "${c.maturity}"` };
  }

  // any-of components
  if (rule.anyOfComponents) {
    const ok = rule.anyOfComponents.filter((id) => rule.requireMaturity.includes(compById[id]?.maturity));
    return { pass: ok.length > 0, detail: ok.length ? `satisfied by ${ok[0]}` : `none of ${rule.anyOfComponents.join("/")} healthy` };
  }

  return { pass: false, detail: "unrecognised rule" };
}

/* ── derive every gate ──────────────────────────────────────────────── */

const evaluated = gatesDoc.gates.map((g) => {
  const r = evaluate(g.derivedFrom);
  return {
    ...g,
    pass: r.pass,
    detail: r.detail,
    // a gate that is explicitly optional for some contexts still counts,
    // but we surface the caveat
    conditional: g.conditional ?? null,
    note: g.note ?? null,
  };
});

/* ── roll up per stage ──────────────────────────────────────────────── */

const stages = gatesDoc.stages.map((s) => {
  const inStage = evaluated.filter((g) => g.stage === s.id);
  const passed = inStage.filter((g) => g.pass);
  const pct = inStage.length ? Math.round((passed.length / inStage.length) * 100) : 100;
  return {
    ...s,
    total: inStage.length,
    passed: passed.length,
    percent: pct,
    complete: passed.length === inStage.length,
    failing: inStage.filter((g) => !g.pass).map((g) => g.id),
  };
});

// overall stage = highest fully-complete stage
let currentStage = stages[0];
for (const s of stages) {
  if (s.complete) currentStage = s;
}

/* ── per-ICP readiness ──────────────────────────────────────────────── */

const icps = gatesDoc.icps.map((icp) => {
  const needed = new Set();
  for (const sid of icp.requiredStages) {
    for (const g of evaluated.filter((x) => x.stage === sid)) needed.add(g.id);
  }
  const gates = evaluated.filter((g) => needed.has(g.id));
  const pass = gates.filter((g) => g.pass).length;
  // an ICP is ready when every stage it requires is complete
  const readyStages = icp.requiredStages.every((sid) => stages.find((s) => s.id === sid)?.complete);
  const blockedBy = gates.filter((g) => !g.pass);
  return {
    id: icp.id,
    name: icp.name,
    description: icp.description,
    requiredStages: icp.requiredStages,
    total: gates.length,
    passed: pass,
    percent: gates.length ? Math.round((pass / gates.length) * 100) : 100,
    ready: readyStages,
    blockers: blockedBy.map((g) => ({ id: g.id, label: g.label, stage: g.stage, effort: g.effort })),
  };
});

/* ── next-action chips ──────────────────────────────────────────────── */
/* Mirrors Google AI Studio's "suggest next feature" pattern: derive the
   highest-leverage unmet items and surface them as discrete, actionable
   chips rather than a wall of todos. Ordered by (stage, effort).        */

const EFFORT_RANK = { small: 0, medium: 1, large: 2, done: 9, "done-partially": 9 };
const STAGE_RANK = Object.fromEntries(gatesDoc.stages.map((s, i) => [s.id, i]));

const candidates = evaluated
  .filter((g) => !g.pass)
  .sort((a, b) =>
    STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
    (EFFORT_RANK[a.effort] ?? 5) - (EFFORT_RANK[b.effort] ?? 5)
  );

const chips = candidates.slice(0, 6).map((g) => {
  const target = g.blockingFeature ? featById[g.blockingFeature]
    : g.blockingComponent ? compById[g.blockingComponent]
    : null;
  return {
    gate: g.id,
    stage: g.stage,
    label: g.label,
    effort: g.effort,
    why: g.why,
    detail: g.detail,
    target: target ? { id: target.id, name: target.name, status: target.status ?? target.maturity, evidence: target.evidence ?? null } : null,
    dependsOn: g.dependsOn ?? null,
  };
});

/* ── emit ───────────────────────────────────────────────────────────── */

const out = {
  schema: "readiness-state/1.0",
  project: features.project,
  version: features.version,
  generated: new Date().toISOString(),
  sourceInventories: ["features.json", "architecture.json", "sbom.cyclonedx.json", "readiness-gates.json"],
  currentStage: { id: currentStage.id, name: currentStage.name, ordinal: currentStage.ordinal },
  stages,
  icps,
  gates: evaluated.map(({ derivedFrom, ...rest }) => rest),
  nextActions: chips,
  summary: {
    totalGates: evaluated.length,
    passed: evaluated.filter((g) => g.pass).length,
    failing: evaluated.filter((g) => !g.pass).length,
    phantomFeatures: features.summary.phantomFeatures,
    criticalRisks: arch.summary.criticalRisks,
  },
};

writeFileSync(join(DOCS, "readiness.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
writeFileSync(join(DOCS, "READINESS.md"), renderMarkdown(out), "utf8");

console.log(`readiness: stage=${out.currentStage.name} gates ${out.summary.passed}/${out.summary.totalGates} pass`);
console.log(`  wrote docs/readiness.json and docs/READINESS.md`);

/* ── markdown renderer ──────────────────────────────────────────────── */

function bar(pct) {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function renderMarkdown(o) {
  const L = [];
  L.push(`# ${o.project} — Readiness`);
  L.push("");
  L.push(`> **Current stage: ${o.currentStage.name}** · ${o.summary.passed}/${o.summary.totalGates} gates passing`);
  L.push(">");
  L.push("> This file is **generated**. Run \`node docs/scripts/readiness.mjs\` after changing any inventory.");
  L.push("> Do not edit it by hand — your changes will be overwritten.");
  L.push("");
  L.push("## What this is");
  L.push("");
  L.push("A maturity checklist that **ticks itself**. Each gate is a claim about readiness, and it is derived directly from the code inventories rather than asserted by hand. When a feature ships, the gate that depends on it turns green on the next run.");
  L.push("");
  L.push("The stages answer one question each — the exit question is the honest test:");
  L.push("");
  for (const s of o.stages) {
    L.push(`- **${s.name}** — ${s.exitQuestion}`);
  }
  L.push("");
  L.push("## Stage progress");
  L.push("");
  L.push("| Stage | Progress | Gates | Exit question |");
  L.push("|---|---|---|---|");
  for (const s of o.stages) {
    const mark = s.complete ? "✅" : s.percent > 0 ? "🔶" : "⬜";
    L.push(`| ${mark} ${s.name} | \`${bar(s.percent)}\` ${s.percent}% | ${s.passed}/${s.total} | ${s.exitQuestion} |`);
  }
  L.push("");
  L.push("## Readiness by target customer");
  L.push("");
  L.push("The same codebase is \"ready\" or not depending on who you are selling to. Pick your ICP and the blockers change.");
  L.push("");
  L.push("| Target | Ready? | Progress | What's blocking |");
  L.push("|---|---|---|---|");
  for (const i of o.icps) {
    const mark = i.ready ? "✅" : "🚫";
    const blockers = i.blockers.length
      ? i.blockers.slice(0, 3).map((b) => `\`${b.id}\` ${b.label}`).join("<br>") + (i.blockers.length > 3 ? `<br>*+${i.blockers.length - 3} more*` : "")
      : "—";
    L.push(`| ${mark} ${i.name} | ${i.ready ? "yes" : "no"} | \`${bar(i.percent)}\` ${i.percent}% (${i.passed}/${i.total}) | ${blockers} |`);
  }
  L.push("");
  L.push("## Next actions");
  L.push("");
  L.push("Highest-leverage unmet gates, ordered by stage then effort — the smallest change that moves you furthest.");
  L.push("");
  for (const c of o.nextActions) {
    L.push(`### \`${c.gate}\` ${c.label}`);
    L.push("");
    L.push(`**Stage:** ${c.stage} · **Effort:** ${c.effort}${c.dependsOn ? ` · **Depends on:** \`${c.dependsOn}\`` : ""}`);
    L.push("");
    L.push(`*Why this matters:* ${c.why}`);
    L.push("");
    L.push(`*Current state:* ${c.detail}`);
    if (c.target) {
      L.push("");
      L.push(`Target: \`${c.target.id}\` **${c.target.name}** — ${c.target.status}${c.target.evidence ? ` (\`${c.target.evidence}\`)` : ""}`);
    }
    L.push("");
  }
  L.push("---");
  L.push("");
  L.push("## Full gate list");
  L.push("");
  L.push("| Gate | Stage | Status | Evidence | Effort |");
  L.push("|---|---|---|---|---|");
  for (const g of o.gates) {
    L.push(`| \`${g.id}\` ${g.label} | ${g.stage} | ${g.pass ? "✅ pass" : "⬜ not met"} | ${g.detail} | ${g.effort} |`);
  }
  L.push("");
  return L.join("\n");
}
