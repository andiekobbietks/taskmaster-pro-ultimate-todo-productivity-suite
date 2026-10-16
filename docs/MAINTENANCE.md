# Maintenance — the single-operator runbook

For one person running this app without a team. Every process here is designed so that **you** can do it in minutes, and so that the app cannot silently rot.

---

## The one rule

> **The inventories are the source of truth. Everything else derives from them.**

If you change the code, update the matching inventory entry. Then re-run the generator. If you skip the inventory update, the readiness checklist lies to you — and a checklist that lies is worse than no checklist.

| File | What it tracks | When you touch it |
|---|---|---|
| `features.json` | Every user-facing capability (`FEAT-*`) | You add, finish, or break a feature |
| `architecture.json` | Every structural component (`COMP-*`) | You add, remove, or restructure a component |
| `sbom.cyclonedx.json` | Every dependency (`DEP-*`) | You add, remove, or upgrade a dependency |
| `readiness-gates.json` | What each stage *means* (`G-*`) | You change your ambitions, not your code |
| `readiness.json` / `READINESS.md` | **Generated** — never edit | `node docs/scripts/readiness.mjs` |

---

## Daily loop

**1. Change code.**

**2. Update the inventory entry it belongs to.** Keep the line references accurate — they are what makes an entry verifiable rather than a claim.

**3. Re-run the generator.**

```bash
node docs/scripts/readiness.mjs
```

It prints the stage and gate count:

```
readiness: stage=Alpha gates 3/19 pass
  wrote docs/readiness.json and docs/READINESS.md
```

**4. Read `docs/READINESS.md` → "Next actions".** It is ordered by *stage then effort*, so the first chip is always the smallest change that moves you furthest.

**5. Commit code + inventory + generated docs together.** Never separate them — the git history should always show a working correspondence between what changed and what was recorded.

---

## Updating a dependency

This is the operation most likely to break the app silently, so it has a fixed procedure.

**The trap this repo already fell into:** both third-party scripts were unpinned. The browser executed whatever the CDN served as "latest" at page load — with full page privilege and no integrity check. That is now fixed, and the fix is fragile in a specific way you must respect.

### Step 1 — pin to a version that exists *on that CDN*

The npm registry and a CDN's available versions are **not the same list**. This is not theoretical — it happened while writing the current pins:

- npm said `tailwindcss` latest **3.4.19**
- `cdn.tailwindcss.com/3.4.19` returned **731 bytes** of `console.error("Unknown Tailwind version…")`
- The real latest on that CDN was **3.4.17**

Had that gone unnoticed, every page load would have silently lost all styling. **Always confirm the pinned URL returns the real file, not an error stub.**

```powershell
$r = Invoke-WebRequest -Uri 'https://cdn.tailwindcss.com/3.4.17' -UseBasicParsing
Write-Output "bytes: $($r.Content.Length)"   # expect ~407000, not ~700
```

### Step 2 — compute a fresh SRI hash

```powershell
$r = Invoke-WebRequest -Uri '<pinned-url>' -UseBasicParsing -Headers @{ 'Accept-Encoding' = 'identity' }
$bytes = if ($r.Content -is [string]) { [System.Text.Encoding]::UTF8.GetBytes($r.Content) } else { $r.Content }
$sha = [System.Security.Cryptography.SHA384]::Create()
'sha384-' + [Convert]::ToBase64String($sha.ComputeHash($bytes))
```

`Accept-Encoding: identity` matters — otherwise a compressed response yields a hash that matches the transfer encoding, not the file, and the browser rejects it.

### Step 3 — update all three together

1. The `src=` URL (version suffix)
2. The `integrity=` attribute
3. The comment above it explaining *why* that version

Leaving a stale `integrity` against a new URL means the browser blocks the script and the app dies on load. That is the correct behaviour — it is the whole point — but it means your edit must be atomic.

### Step 4 — verify in a browser

Open the page with devtools → Network. Both scripts must show **200**, not blocked. Then confirm the app renders. An SRI failure is silent in the HTML but loud in the console.

### Known remaining exposure

These are pinned by version but carry **no SRI**, because importmap entries and Google Fonts stylesheets do not accept an `integrity` attribute the same way:

| ID | Component | Exposure |
|---|---|---|
| `DEP-002`–`DEP-005` | react, react-dom, jsx-runtime, lucide-react (esm.sh) | Version-pinned; no integrity check |
| `DEP-008`–`DEP-009` | Inter, JetBrains Mono (Google Fonts) | No version pin; privacy-filterable |

The proper fix for the esm.sh entries is the same as the build-step item below: bundle them locally so they stop being third-party at runtime.

---

## The two structural fixes, in order

These are not on the daily loop. They are the projects that reduce your ongoing maintenance burden, and they must be done in this order.

### 1. Add a build step (removes `COMP-008`, `COMP-009`)

Today the browser transpiles ~40KB of JSX with Babel **and** JITs the entire Tailwind stylesheet, on every single page load. This is why the unpinned CDNs were dangerous in the first place — a build step makes them unnecessary rather than merely pinned.

Target state:

- **Babel** → replaced by an esbuild/Vite compile. `type="text/babel"` script becomes a compiled `app.js`.
- **Tailwind Play CDN** → replaced by a compiled `styles.css` containing only the utilities actually used. The Play CDN is explicitly vendor-marked as not-for-production.
- **esm.sh imports** → bundled into the output, no longer third-party at runtime.

This is the single highest-leverage change. It simultaneously:

- removes two `high` supply-chain risks (`DEP-006`, `DEP-007`)
- removes the first-paint compile cost
- makes the app work offline / behind restrictive networks
- converts three of the eight CDN dependencies into build-time-only dependencies

**But** it requires introducing tooling (a `package.json` build script, a bundler) to a repo that currently has none. That is a real change to how you work, so it is deliberately *not* done as part of the pinning fix.

### 2. Decompose `COMP-006`

One 821-line `App()` function holds 24 `useState` hooks, all data fetching, all rendering, and the timer. It is at the limit of what one scope can hold. Once a build step exists, splitting it into components is cheap; doing it *before* a build step means editing a 40KB inline `<script>` block by hand. Order matters.

---

## Weekly check

Run these five minutes of checks before you forget what you changed:

```bash
# 1. Regenerate — did anything drift?
node docs/scripts/readiness.mjs
git diff --stat docs/

# 2. Are all inventories still valid JSON?
for f in docs/features.json docs/architecture.json docs/sbom.cyclonedx.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('ok $f')"
done

# 3. Any unpinned deps crept back in?
node -e "
const s=require('./docs/sbom.cyclonedx.json');
const u=s.components.filter(c=>/UNPINNED/i.test(c.version));
console.log(u.length? 'UNPINNED: '+u.map(c=>c.name).join(', ') : 'all pinned');
"
```

If step 3 ever reports unpinned dependencies, treat it as the first thing you fix. It is the cheapest high-severity item on the board.

---

## How this maps to the AI Studio pattern

The readiness checklist is built on the same logic as Google AI Studio's Build mode, for a deliberate reason — it is the pattern that makes an autonomous agent legible to a human operator.

**What AI Studio does, from Google's own blogs:**

- **AI Chips** — suggested features as discrete clickable pills in the prompt box, not a menu. You select capabilities rather than describe them.
- **Proactive detection** — "the agent now proactively detects when your app needs a database or login" and offers the integration for approval, rather than waiting to be told.
- **"I'm Feeling Lucky"** — a random spark for when you do not know what to build next.
- **Brainstorming Loading Screen** — cycles context-aware ideas *while the app builds*, turning dead wait time into suggestions.
- **Annotation Mode** — point at a part of the app and describe the change, instead of narrating the change abstractly.

**What was borrowed, and why:**

| Google pattern | Here | Why |
|---|---|---|
| AI Chips | "Next actions" in `READINESS.md` | Discrete, individually actionable, ordered by leverage — not a wall of todos |
| Proactive detection | Gates derived from inventories | The system detects the gap itself from code evidence; you never assert readiness by hand |
| Loading-screen suggestions | Chip ordering by *stage then effort* | Always surfaces a small doable next step, so the operator is never staring at a blank "what now" |
| Annotation Mode's grounding | Line references on every `FEAT-*` and `COMP-*` | Each claim points at exact code lines, so it can be verified rather than believed |

The one thing deliberately **not** borrowed: the conversational interface. This is a file you commit and a script you run, because the output needs to live in the repo and survive alongside the code. A pane that only exists in an editor session cannot be reviewed in a pull request.

**The ICP table is the load-bearing part.** "Am I ready?" has no answer until you say *ready for whom*. The same codebase is release-ready for personal use and four gates away from team-ready. Making that explicit is what stops a solo operator from either shipping prematurely or polishing indefinitely.
