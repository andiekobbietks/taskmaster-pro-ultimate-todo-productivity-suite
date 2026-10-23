# TaskMaster Pro — Software Inventories

Regenerated 2026-10-17 · version `0.1.0-alpha` · release stage **alpha** · **6/19 readiness gates passing**

Three linked inventories share one tagging vocabulary. Every entry was verified by reading the actual source — `src/index.ts` (323 lines), `src/app.jsx` (854 lines), `src/lib/api.js`, `public/index.html` (31 lines), `package.json`, `wrangler.json` — and carries exact line references. Nothing here is inferred.

| ID prefix | Inventory | File | Answers |
|---|---|---|---|
| `DEP-*` | Dependency SBOM (CycloneDX 1.5) | [`sbom.cyclonedx.json`](./sbom.cyclonedx.json) | *What software do we ship, and is any of it vulnerable?* |
| `FEAT-*` | Feature inventory | [`features.json`](./features.json) | *What does it do, and is each thing real?* |
| `COMP-*` | Architecture inventory | [`architecture.json`](./architecture.json) | *How is it built, and where is it weak?* |

**How they link:** a `FEAT-*` points to the `COMP-*` it needs; a `COMP-*` points to the `DEP-*` it loads. So a single question — "what happens to the app if this dependency is compromised?" — resolves through the graph: `DEP-011` (esbuild) → `COMP-017` (build pipeline) → `COMP-006` (the whole SPA) → every feature that renders.

---

## 1. Dependency SBOM — `DEP-*`

10 dependencies. **8 of 10 are npm packages bundled ahead of time; only 2 are fetched at page load, and both are fonts.** There is no CDN script tag left in the app at all.

| ID | Component | Version | Source | License | Risk |
|---|---|---|---|---|---|
| `DEP-001` | hono | 4.6.0 | npm (bundled into the Worker) | MIT | low |
| `DEP-002` | react | 18.3.1 | npm (bundled into app.js) | MIT | low |
| `DEP-003` | react-dom | 18.3.1 | npm (bundled into app.js) | MIT | low |
| `DEP-004` | react/jsx-runtime | 18.3.1 | npm (ships inside react) | MIT | low |
| `DEP-005` | lucide-react | 0.400.0 | npm (bundled, tree-shaken) | ISC | low |
| `DEP-007` | tailwindcss | 3.4.17 | npm (build-time only) | MIT | low |
| `DEP-008` | Inter | variable | Google Fonts **(CDN)** | OFL-1.1 | low |
| `DEP-009` | JetBrains Mono | variable | Google Fonts **(CDN)** | OFL-1.1 | low |
| `DEP-010` | cloudflare:workers | platform | runtime external | proprietary | low |
| `DEP-011` | esbuild | 0.28.2 | npm (build-time only) | MIT | low |

**What changed on 2026-10-17.** The build step (see `COMP-017`) removed six CDN dependencies in a single move:

- `DEP-006` (`@babel/standalone`, unpkg) — **deleted**. It used to transpile ~40KB of JSX in the browser on every page load.
- `DEP-007` (`tailwindcss`) — moved off `cdn.tailwindcss.com` onto npm. The Play CDN is explicitly vendor-marked as not-for-production.
- `DEP-002`–`DEP-005` (react, react-dom, jsx-runtime, lucide-react) — moved off `esm.sh` onto npm and are bundled into `public/assets/app.js`.

Consequence: `withSRI` in the SBOM summary is now **0**, and that is correct rather than alarming. SRI exists to let a browser verify a third-party script it is about to execute. There is no such script any more, so there is nothing left to verify. Supply-chain exposure moved from *page view* (every visitor) to *build time* (CI and your machine), which is where the pinned versions and the CI bundle check now apply.

**The remaining CDN surface is two fonts.** `DEP-008` and `DEP-009` load from Google Fonts with `preconnect` but no integrity attribute — font stylesheets do not accept one. They execute no script, so the risk is availability and privacy (a request to Google on every page view, blocked outright in some privacy regimes) rather than code execution. Self-hosting the woff2 files is the last remaining move and is tracked in `docs/MAINTENANCE.md`.

**Correctly handled:** `DEP-010` (`cloudflare:workers`) is always external and never bundled, per platform rules.

---

## 2. Feature inventory — `FEAT-*`

31 features. **14 implemented · 9 partial · 2 stub · 6 planned.**

The uncomfortable category is **phantom features** — code that looks like it works and doesn't. Three remain:

| ID | Feature | Why it's a phantom |
|---|---|---|
| `FEAT-010` | Filter by tag | `src/index.ts:16` reads `?tag=` then **never uses it in the query**. The API silently returns unfiltered results. No UI exists. |
| `FEAT-017` | Estimated pomodoros | State declared (`src/app.jsx:94`), column written on every create — but **no input field is ever rendered**, so the value is always `1`. |
| `FEAT-026` | ⌘K shortcut | The search box advertises it in placeholder text. **No keydown handler exists anywhere.** |

**`FEAT-025` (error handling) stopped being a phantom on 2026-10-17.** Every request now goes through one `api()` helper that rejects on a non-2xx response and surfaces the server's own message in a dismissible banner with a retry. Previously all nine call sites swallowed failures into `console.error`, so a failed request left the screen silently stale.

A phantom is worse than an absent feature: absent is honest, phantom misleads the user and the next developer.

**Highest-priority fixes:**

| ID | Feature | Gap |
|---|---|---|
| `FEAT-027` | Authentication | **Blocker.** No auth of any kind — anyone with the URL has full read/write. |
| `FEAT-024` | Responsive layout | Sidebar hidden below `lg` with no drawer or menu. **On mobile you cannot switch views or lists at all.** The `Menu` icon is imported but never rendered — the affordance was intended and never built. |
| `FEAT-029` | Automated tests | Zero tests. CI checks the bundle, the docs and the fixtures, but nothing checks behaviour. |
| `FEAT-013` | Search | `LIKE` wildcards (`%`, `_`) in user input are unescaped. Searching `100%` matches everything containing `100`. |
| `FEAT-015` | Pomodoro timer | State not persisted — a refresh destroys the running session. Uses `alert()`, which blocks the main thread. |
| `FEAT-020` | Dark mode | Preference not persisted; resets to light on every reload. No `prefers-color-scheme` read, so system-dark users get a light flash. |

---

## 3. Architecture inventory — `COMP-*`

14 components. **3 solid · 7 adequate · 2 fragile · 2 missing.**

| ID | Component | Maturity | Risk |
|---|---|---|---|
| `COMP-001` | Cloudflare Workers runtime | solid | low |
| `COMP-010` | Custom design tokens | solid | low |
| `COMP-017` | Build pipeline (esbuild + Tailwind CLI) | solid | low |
| `COMP-002` | App Durable Object | adequate | medium |
| `COMP-003` | Hono router | adequate | low |
| `COMP-004` | SQLite storage | adequate | medium |
| `COMP-005` | Static asset layer | adequate | low |
| `COMP-007` | Client data access layer | adequate | medium |
| `COMP-012` | Web typography | adequate | low |
| `COMP-013` | Server-side seed data | adequate | low |
| `COMP-006` | Single-file React SPA | **fragile** | medium |
| `COMP-014` | Configuration & typing | **fragile** | medium |
| `COMP-015` | Quality assurance | **missing** | **high** |
| `COMP-016` | Authentication & tenancy | **missing** | **critical** |

**Three components no longer exist:** `COMP-008` (in-browser JSX transpilation), `COMP-009` (Tailwind Play CDN) and `COMP-011` (esm.sh importmap). `COMP-017` replaced all three.

`COMP-011` deserves a historical note rather than a delete-and-forget. It applied `?external=react,react-dom` to every React-consuming package — precisely the fix for the dual-React `useContext` null crash, applied consistently. That is the most commonly-botched part of that architecture, and it was got right. It is now unnecessary because the bundler resolves a single React instance.

**What holds it at alpha:**

- **`COMP-016` (critical)** — tenancy relies on the architectural fact that one DO instance serves one deployment. That is single-tenant by *structure*, not by *access control*. It protects a private deploy; it cannot support a shared beta.
- **`COMP-015` (high)** — zero tests. CI now gates the bundle, the docs and the seed fixtures, but nothing verifies the 31 features, so `COMP-015` stays `missing` deliberately: a pipeline without tests is not a regression net.
- **`COMP-006`** — 800 lines in a single function with 24 `useState` hooks, no component decomposition, no router. It is no longer transpiled at page load, but every added feature still increases coupling.

### Data flow

```
Browser (COMP-006)
  └─ api()  COMP-007
       └─ fetch('./api/*') → Hono router  COMP-003
            └─ SQL on DO storage  COMP-004
                 └─ App Durable Object persists via ctx.storage.sql  COMP-002

Static assets (COMP-005) served host-side; only unmatched requests reach the DO.

Build (COMP-017) writes public/assets/app.js and app.css before dev, CI and deploy.

Google Fonts (COMP-012) is the only third-party load at page view.
```

---

## The cross-reference that matters

Follow `DEP-011` (esbuild) through the graph:

```
DEP-011  ──builds──▶  COMP-017  (esbuild + Tailwind CLI pipeline)
                          │
                          └─produces─▶  public/assets/app.js  ──enables─▶  COMP-006 (the whole SPA)
                                                                            │
                                                                            └─carries─▶  all 31 FEAT-* entries
```

This is what the cross-linked IDs buy you: a supply-chain line item and a product capability turn out to be the same fact viewed from two ends. When `DEP-006` (`@babel/standalone`) was removed, the inventory made the consequence traceable in one step — it stopped being a page-view risk upstream of every feature. That is also why `COMP-015` staying `missing` matters: a compromised *build-time* tool is upstream of everything, which is exactly what the CI bundle check and the pinned versions are there to bound.

---

## Verdict

**The product is beta-shaped. The engineering is alpha.**

The architecture is coherent and uses the platform correctly — the DO/SQLite/Hono pattern is idiomatic and asset routing is configured properly. The front end is compiled ahead of time rather than assembled in the visitor's browser, which is a meaningful improvement over typical generated code.

What blocks beta is not structural wrongness. It is two absences — **auth and tests** — plus one component too large to grow further, a mobile layout that hides its own navigation, and three phantom features that should either be finished or deleted.

The inventories above are the checklist; `features.json` carries the exact line references for each fix.
