#!/usr/bin/env node
/**
 * tier1-check.mjs — static cross-file consistency checks for a Cloudflare
 * Worker project. No build, no model, no network. Runs in milliseconds.
 *
 * Usage: node tier1-check.mjs <repo-root>
 * Exit 0 = no FAIL findings. Exit 1 = at least one FAIL.
 *
 * ============================ READ THIS BEFORE DELETING ============================
 * This file exists because of a specific, documented failure, and every check
 * in it is a case from that one build.
 *
 * The first generated build of this project shipped THREE fatal configuration
 * defects simultaneously:
 *
 *   1. The Durable Object class was exported from src/index.ts, but
 *      wrangler.json never bound it in durable_objects.bindings. The Worker
 *      deployed cleanly, wrangler reported success, the front end rendered --
 *      and the API could not serve a single request.
 *
 *   2. The `?tag=` query filter was read from the request, validated, and then
 *      dropped before it reached the SQL. Every request returned the full
 *      todo list regardless of the tag asked for.
 *
 *   3. `?search=` interpolated user input straight into a LIKE pattern, so
 *      searching "100%" returned every row in the table.
 *
 * All three are invisible to a compiler, invisible to a bundler, invisible to
 * `wrangler deploy --dry-run`, and invisible to a test that only asserts
 * "returns 200 with valid JSON". Defects 2 and 3 returned well-formed,
 * correct-looking JSON containing the wrong rows -- which is precisely why
 * nobody caught them.
 *
 * They shipped, and they were not noticed for NINETEEN DAYS.
 *
 * ============================ WHAT THIS CHECKS ============================
 * The one property all three share: nothing that runs will catch them, because
 * the code that is broken is not the code that executes. This file compares
 * files against each other instead of running the program:
 *
 *   - a Durable Object exported from src but never bound in wrangler.json
 *   - a missing `migrations` entry for a class that IS bound
 *   - an unnamed worker, or a missing `main`
 *   - a query parameter read from the request and never used in the SQL
 *   - README routes documented that no longer exist in the code
 *
 * ============================ WHAT IT DELIBERATELY DOES NOT DO ============================
 * It does not typecheck, lint, test, or build. Those jobs already exist in
 * ci.yml. This is the narrow slice that nothing else covers -- it reads text
 * and compares facts across file boundaries. If you are about to add a
 * general-purpose linter, do not; that is scope creep and it duplicates
 * existing jobs.
 *
 * Keep it dependency-free. A checker that needs `npm install` cannot run in the
 * "my install is broken" scenario, which is exactly when it is most needed.
 *
 * ============================ WHEN A CHECK FIRES ============================
 * Read the finding before you suppress it. Every check here corresponds to
 * something that already shipped broken to real users. A check firing is not
 * noise to route around -- it is the checker doing the only job it has.
 *
 * See also: docs/THREAT-NOTE.md for the security posture, and the "Fixed"
 * section of CHANGELOG.md for the 1.0.1 release that shipped these two
 * correctness fixes alongside this gate.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? '.'
const findings = []
const FAIL = 'FAIL'
const WARN = 'WARN'

const report = (severity, id, message, file) => findings.push({ severity, id, message, file })

/** Strip // and /* *\/ comments while leaving string + template literals intact. */
function stripCodeComments(s) {
  let out = ''
  let quote = null, inLine = false, inBlock = false, esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1]
    if (inLine) { if (c === '\n') { inLine = false; out += c }; continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++ }; continue }
    if (quote) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === quote) quote = null
      continue
    }
    if (c === '/' && n === '/') { inLine = true; i++; continue }
    if (c === '/' && n === '*') { inBlock = true; i++; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c }
    out += c
  }
  return out
}

function stripJsonc(s) { return stripCodeComments(s) }

const read = (p) => { try { return readFileSync(join(root, p), 'utf8') } catch { return null } }
const exists = (p) => existsSync(join(root, p))
const isDir = (p) => { try { return statSync(join(root, p)).isDirectory() } catch { return false } }
const lineOf = (src, needle, from = 0) => {
  const i = src.indexOf(needle, from)
  return i < 0 ? '?' : src.slice(0, i).split('\n').length
}

// ---------------------------------------------------------------- app root
function resolveAppRoot() {
  if (isDir('src')) return '.'
  if (isDir('workspace')) {
    for (const d of readdirSync(join(root, 'workspace'))) {
      if (isDir(join('workspace', d, 'src'))) return join('workspace', d)
    }
  }
  return '.'
}
const APP = resolveAppRoot()
const at = (p) => (APP === '.' ? p : `${APP}/${p.replace(/^[./\\]+/, '')}`)

// ---------------------------------------------------------------- config
const cfgRaw = read(at('wrangler.json')) ?? read('wrangler.json') ?? read('wrangler.jsonc')
if (!cfgRaw) report(FAIL, 'CFG-01', 'no wrangler.json / wrangler.jsonc found', '.')

let cfg = {}
try { cfg = JSON.parse(stripJsonc(cfgRaw ?? '{}')) }
catch (e) { report(FAIL, 'CFG-02', `wrangler config unparseable: ${e.message}`, at('wrangler.json')) }

const workerRaw = read(at('src/index.ts'))
if (!workerRaw) report(FAIL, 'SRC-01', 'src/index.ts missing — nothing to check', at('src/index.ts'))
const workerSrc = stripCodeComments(workerRaw ?? '')

// ------------------------------------------------- 1. DO exported vs bound
const doClasses = [...workerSrc.matchAll(/export class (\w+) extends DurableObject/g)].map(m => m[1])
const boundNames = new Set((cfg.durable_objects?.bindings ?? []).map(b => b.class_name))
const migratedNames = new Set((cfg.migrations ?? []).flatMap(m => m.new_sqlite_classes ?? []))

for (const cls of doClasses) {
  const line = lineOf(workerSrc, cls)
  if (!boundNames.has(cls)) {
    report(FAIL, 'DO-BINDING',
      `Durable Object "${cls}" is exported but has no durable_objects.bindings entry — it will never be constructed`,
      `${at('src/index.ts')}:${line}`)
  }
  if (!migratedNames.has(cls)) {
    report(FAIL, 'DO-MIGRATE',
      `Durable Object "${cls}" has no migrations[].new_sqlite_classes entry — storage class never migrated`,
      `${at('src/index.ts')}:${line}`)
  }
}

// ------------------------------------------------------- 2. worker name
if (!cfg.name) {
  report(FAIL, 'WORKER-NAME', 'wrangler.json has no "name" — deploy and preview targets undefined', at('wrangler.json'))
}
if (cfg.main && !exists(at(cfg.main))) {
  report(FAIL, 'MAIN-EXISTS', `wrangler.main "${cfg.main}" does not exist on disk`, at('wrangler.json'))
}
if (cfg.assets?.directory && !isDir(at(cfg.assets.directory))) {
  report(FAIL, 'ASSETS-EXIST', `wrangler assets directory "${cfg.assets.directory}" does not exist`, at('wrangler.json'))
}

// ------------------------------------------ 3. imports vs declared deps
let pkg = {}
try { pkg = JSON.parse(read(at('package.json')) ?? '{}') }
catch { report(FAIL, 'PKG-01', 'package.json unparseable', at('package.json')) }

const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
])
const BUILTIN = new Set([
  'node:fs', 'node:path', 'node:url', 'node:os', 'node:crypto', 'node:util',
  'fs', 'path', 'url', 'os', 'crypto', 'util', 'cloudflare:workers', 'react',
])

const srcFiles = []
;(function walk(dir) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) { if (!/node_modules|\.git|dist|\.wrangler/.test(e.name)) walk(p) }
    else if (/\.(ts|tsx|jsx|js|mjs)$/.test(e.name)) srcFiles.push(p)
  }
})(APP === '.' ? '.' : APP)

const bare = new Map()
for (const f of srcFiles) {
  const s = stripCodeComments(read(f) ?? '')
  for (const m of s.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1]
    if (spec.startsWith('.') || spec.startsWith('/')) continue
    const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    if (BUILTIN.has(spec) || BUILTIN.has(pkgName)) continue
    if (!bare.has(pkgName)) bare.set(pkgName, f)
  }
}
for (const [name, file] of bare) {
  if (!declared.has(name)) {
    report(FAIL, 'DEP-MISSING', `source imports "${name}" but package.json does not declare it`, file)
  }
}

// ---------------------------------------------------- handler blocks
const HANDLER = /this\.app\.(get|post|patch|delete|put)\(\s*"([^"]+)"/g
const handlers = [...workerSrc.matchAll(HANDLER)]
function blockAt(i) {
  const start = handlers[i].index
  const end = i + 1 < handlers.length ? handlers[i + 1].index : workerSrc.length
  return { start, block: workerSrc.slice(start, end) }
}

handlers.forEach((h, i) => {
  const [, verb, route] = h
  const { start, block } = blockAt(i)

  // 4. dead query params — the phantom-filter detector
  const params = [...new Set([...block.matchAll(/c\.req\.query\(\s*"([^"]+)"\s*\)/g)].map(m => m[1]))]
  for (const p of params) {
    const decl = new RegExp(`const\\s+${p}\\s*=\\s*c\\.req\\.query\\([^)]*\\)\\s*;?`)
    const without = block.replace(decl, '')
    const uses = (without.match(new RegExp(`\\b${p}\\b`, 'g')) || []).length
    if (uses === 0) {
      report(WARN, 'DEAD-FILTER',
        `${verb.toUpperCase()} ${route}: reads query param "${p}" but never uses it — filter is advertised and does nothing`,
        `${at('src/index.ts')}:${lineOf(workerSrc, `const ${p} =`, start)}`)
    }
  }

  // 5. unescaped LIKE — params for a LIKE clause are built by template literal
  if (/LIKE \?/i.test(block)) {
    const pushes = [...block.matchAll(/params\.push\(\s*`([^`]*)`/g)].map(m => m[1])
    if (pushes.some(s => /\$\{/.test(s))) {
      report(WARN, 'LIKE-ESCAPE',
        `${verb.toUpperCase()} ${route}: LIKE pattern built from raw user input without escaping % or _ — searching "100%" matches everything`,
        `${at('src/index.ts')}:${lineOf(workerSrc, 'LIKE ?', start)}`)
    }
  }
})

// ------------------------------------------ 6. README route table vs code
const readme = read(at('README.md'))
if (readme && workerSrc) {
  const docRoutes = new Set(
    [...readme.matchAll(/^\|\s*(GET|POST|PATCH|DELETE|PUT)\s*\|\s*`([^`]+)`/gm)]
      .map(m => `${m[1].toUpperCase()} ${m[2].replace(/\/$/, '')}`))
  const codeRoutes = new Set(handlers.map(m => `${m[1].toUpperCase()} ${m[2].replace(/\/$/, '')}`))
  for (const r of docRoutes) {
    if (!codeRoutes.has(r)) report(WARN, 'DOC-ROUTE', `README documents "${r}" but no such route is registered`, at('README.md'))
  }
}

// ------------------------------------------------------------------ output
const order = { FAIL: 0, WARN: 1 }
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id))

console.log(`\ntier1-check  app-root=${APP}  target=${root}\n`)
if (!findings.length) { console.log('  clean — no findings\n'); process.exit(0) }

let cur = null
for (const f of findings) {
  if (f.id !== cur) { cur = f.id; console.log(`  [${f.id}]`) }
  console.log(`    ${f.severity}  ${f.message}`)
  console.log(`            at ${f.file}`)
}
const fails = findings.filter(f => f.severity === FAIL).length
console.log(`\n  ${fails} FAIL, ${findings.length - fails} WARN\n`)
process.exit(fails ? 1 : 0)