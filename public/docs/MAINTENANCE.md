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

Every dependency is now an npm package, and almost all of them are bundled ahead of time. A dependency change is therefore a **build** change, not a runtime change, which makes the failure modes different and cheaper to catch.

**Procedure:**

1. Update the pin in `package.json`, then `npm install`.
2. Rebuild: `npm run build`. esbuild fails loudly on a broken import; the Tailwind CLI fails loudly on a class it cannot resolve.
3. Check the bundle sizes moved in a direction you expect — `public/assets/app.js` and `public/assets/app.css`.
4. Open the page and confirm it **renders**. A build that succeeds but renders nothing is possible, and React version skew (two React copies breaking `useContext`) is the usual cause.
5. Update the `DEP-*` entry in `docs/sbom.cyclonedx.json`, then re-run `npm run docs:readiness` and commit the result.

### The trap this repo already fell into — and why it cannot repeat the same way

Until 2026-10-17 the app loaded its front-end libraries from CDNs, and for a while both scripts were unpinned: the browser executed whatever the vendor served as "latest" at page load, with full page privilege and no integrity check. Pinning with SRI fixed that, but the fix was fragile in two ways this repo hit for real:

- **A CDN and npm do not carry the same versions.** npm listed `tailwindcss` 3.4.19; `cdn.tailwindcss.com/3.4.19` returned 731 bytes of `console.error("Unknown Tailwind version…")`. Pinning that URL would have silently killed every page's styling.
- **An SRI hash must match the exact bytes served.** That requires `Accept-Encoding: identity`, and the URL, the `integrity` attribute and the explanatory comment have to be updated in one atomic edit.

**The build step removed the entire class of problem**: there is no third-party script tag left to pin, hash or get wrong. If you ever reintroduce one, reintroduce it with SRI and record it in the SBOM — but prefer bundling it.

### Known remaining exposure

| ID | Component | Exposure |
|---|---|---|
| `DEP-008`, `DEP-009` | Inter, JetBrains Mono (Google Fonts) | No version pin and no integrity attribute — font stylesheets do not accept one. Carries no script privilege; the fix is self-hosting the woff2 files. |

---

## Structural fixes

These are not on the daily loop. They are the projects that reduce your ongoing maintenance burden, and they build on each other in order.

### 1. Build step — **DONE (2026-10-17)**

Landed as `COMP-017`: `npm run build` runs esbuild (`src/app.jsx` → `public/assets/app.js`) and the Tailwind CLI (`src/tailwind.css` → `public/assets/app.css`). `npm run dev` and `npm run deploy` both run the build first, and CI asserts that both outputs exist before it will pass.

What it bought:

- Removed `@babel/standalone` and the Tailwind Play CDN entirely, and moved react / react-dom / lucide-react off esm.sh onto npm — six CDN dependencies gone in one move.
- Removed the first-paint compile cost: the browser no longer transpiles ~40KB of JSX or JITs the whole stylesheet on every load.
- The app now works offline and behind restrictive networks, apart from the two Google Fonts requests.

**One consequence to respect: `public/assets/` is build output and is deliberately not committed.** A fresh clone serves a blank page until `npm run build` runs. `npm run dev` handles that for you; a bare `npx wrangler dev` will not.

### 2. Decompose `COMP-006` — the next one

One 800-line `App()` function holds 24 `useState` hooks, all data fetching, all rendering, and the timer. It is at the limit of what one scope can hold. The build step removed the earlier objection (editing a 40KB inline `<script>` block by hand), so splitting it is now ordinary work: extract `Sidebar`, `TodoItem` and the two modals into their own modules and leave `App` holding state and effects.

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
