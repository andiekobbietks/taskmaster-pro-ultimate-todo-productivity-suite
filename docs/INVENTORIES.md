# TaskMaster Pro — Software Inventories

Generated 2026-10-16 · version `0.1.0-alpha` · release stage **alpha**

Three linked inventories share one tagging vocabulary. Every entry was verified by reading the actual source — `src/index.ts` (312 lines), `public/index.html` (821 lines), `package.json`, `wrangler.json` — and carries exact line references. Nothing here is inferred.

| ID prefix | Inventory | File | Answers |
|---|---|---|---|
| `DEP-*` | Dependency SBOM (CycloneDX 1.5) | [`sbom.cyclonedx.json`](./sbom.cyclonedx.json) | *What software do we ship, and is any of it vulnerable?* |
| `FEAT-*` | Feature inventory | [`features.json`](./features.json) | *What does it do, and is each thing real?* |
| `COMP-*` | Architecture inventory | [`architecture.json`](./architecture.json) | *How is it built, and where is it weak?* |

**How they link:** a `FEAT-*` points to the `COMP-*` it needs; a `COMP-*` points to the `DEP-*` it loads. So a single question — "how exposed are we if esm.sh goes down?" — resolves to `DEP-002` → `COMP-011` → `COMP-006` → every feature that renders.

---

## 1. Dependency SBOM — `DEP-*`

10 dependencies. **8 of 10 are fetched at page load from third-party CDNs.** Two of those were unpinned with no integrity check — both are now fixed (pinned + SRI); six remain version-pinned without SRI because importmap and font entries don't accept `integrity`.

| ID | Component | Version | Source | License | Risk |
|---|---|---|---|---|---|
| `DEP-001` | hono | 4.6.0 | npm (bundled) | MIT | low |
| `DEP-002` | react | 18.3.1 | esm.sh | MIT | medium |
| `DEP-003` | react-dom | 18.3.1 | esm.sh | MIT | medium |
| `DEP-004` | react/jsx-runtime | 18.3.1 | esm.sh | MIT | medium |
| `DEP-005` | lucide-react | 0.400.0 | esm.sh | ISC | medium |
| `DEP-006` | @babel/standalone | 7.29.10 *(pinned+SRI)* | unpkg | MIT | ~~high~~ → low |
| `DEP-007` | tailwindcss (Play CDN) | 3.4.17 *(pinned+SRI)* | cdn.tailwindcss.com | MIT | ~~high~~ → low |
| `DEP-008` | Inter | variable | Google Fonts | OFL-1.1 | low |
| `DEP-009` | JetBrains Mono | variable | Google Fonts | OFL-1.1 | low |
| `DEP-010` | cloudflare:workers | platform | runtime external | proprietary | low |

**The two that mattered — now fixed.** `DEP-006` and `DEP-007` previously carried no version at all: the browser executed whatever those CDNs served *today*, with full page privilege and no integrity check. Both are now pinned with sha384 SRI (`DEP-006` → Babel 7.29.10, `DEP-007` → Tailwind 3.4.17).

Note the version choice: **Babel 8 and Tailwind 4 were deliberately rejected.** This app uses the v7 `data-presets="react"` API and the v3 `tailwind.config` global object; both newer majors are incompatible. Also note that the Play CDN's latest is `3.4.17` while npm's latest 3.x is `3.4.19` — requesting `3.4.19` from that CDN returns a 731-byte error stub, which would have silently killed all styling. This is why `docs/MAINTENANCE.md` requires confirming the pinned URL returns the real file.

The remaining CDN entries (`DEP-002`–`DEP-005` esm.sh, `DEP-008`–`DEP-009` Google Fonts) are version-pinned but carry no SRI — importmap and font entries do not accept `integrity`. The complete fix is the build step tracked as `COMP-008`/`COMP-009`, which removes the runtime CDN dependency entirely.

**Correctly handled:** `DEP-010` (`cloudflare:workers`) is always external and never bundled, per platform rules.

---

## 2. Feature inventory — `FEAT-*`

31 features. **9 implemented · 11 partial · 3 stub · 8 planned.**

The uncomfortable category is **phantom features** — code that looks like it works and doesn't. Four of them:

| ID | Feature | Why it's a phantom |
|---|---|---|
| `FEAT-010` | Filter by tag | `src/index.ts:16` reads `?tag=` then **never uses it in the query**. The API silently returns unfiltered results. No UI exists. |
| `FEAT-017` | Estimated pomodoros | State declared (`index.html:78`), column written on every create — but **no input field is ever rendered**, so the value is always `1`. |
| `FEAT-025` | Error handling | Every `catch` block only calls `console.error`. A failed request leaves the UI silently stale. |
| `FEAT-026` | ⌘K shortcut | The search box advertises it in placeholder text. **No keydown handler exists anywhere.** |

A phantom is worse than an absent feature: absent is honest, phantom misleads the user and the next developer.

**Fully beta-ready (9):** create task · list with filters · update · complete toggle · pin · priority levels · stats · pomodoro count · view tabs · empty states · create list.

**Highest-priority fixes:**

| ID | Feature | Gap |
|---|---|---|
| `FEAT-027` | Authentication | **Blocker.** No auth of any kind — anyone with the URL has full read/write. |
| `FEAT-024` | Responsive layout | Sidebar hidden below `lg` with no drawer or menu. **On mobile you cannot switch views or lists at all.** The `Menu` icon is imported but never rendered — the affordance was intended and never built. |
| `FEAT-013` | Search | `LIKE` wildcards (`%`, `_`) in user input are unescaped. Searching `100%` matches everything containing `100`. |
| `FEAT-015` | Pomodoro timer | State not persisted — a refresh destroys the running session. Uses `alert()`, which blocks the main thread. |
| `FEAT-020` | Dark mode | Preference not persisted; resets to light on every reload. No `prefers-color-scheme` read, so system-dark users get a light flash. |
| `FEAT-022` | Seed data | 4 fake tasks and 3 fake lists injected into every deployment with no opt-out. |

---

## 3. Architecture inventory — `COMP-*`

16 components. **3 solid · 5 adequate · 6 fragile · 2 missing.**

| ID | Component | Maturity | Risk |
|---|---|---|---|
| `COMP-001` | Cloudflare Workers runtime | solid | low |
| `COMP-010` | Custom design tokens | solid | low |
| `COMP-011` | Importmap module resolution | solid | medium |
| `COMP-002` | App Durable Object | adequate | medium |
| `COMP-003` | Hono router | adequate | low |
| `COMP-004` | SQLite storage | adequate | medium |
| `COMP-005` | Static asset layer | adequate | low |
| `COMP-012` | Web typography | adequate | low |
| `COMP-006` | Single-file React SPA | **fragile** | medium |
| `COMP-007` | Client data access layer | **fragile** | **high** |
| `COMP-008` | In-browser JSX transpilation | **fragile** | **high** |
| `COMP-009` | Tailwind Play CDN | **fragile** | **high** |
| `COMP-013` | Server-side seed data | **fragile** | medium |
| `COMP-014` | Configuration & typing | **fragile** | medium |
| `COMP-015` | Quality assurance | **missing** | **high** |
| `COMP-016` | Authentication & tenancy | **missing** | **critical** |

**Credit where it's due — `COMP-011` is genuinely well built.** The importmap applies `?external=react,react-dom` to *every* React-consuming package. That is precisely the fix for the dual-React `useContext` null crash, and it is applied consistently across all five entries. This is the most commonly-botched part of this entire architecture, and it was got right.

**What holds it at alpha:**

- **`COMP-016` (critical)** — tenancy relies on the architectural fact that one DO instance serves one deployment. That is single-tenant by *structure*, not by *access control*. It protects a private deploy; it cannot support a shared beta.
- **`COMP-015` (high)** — zero tests, no CI. Nothing verifies any of the 31 features.
- **`COMP-008` + `COMP-009` (high)** — no build step. The browser transpiles 40KB of JSX and JITs the entire CSS framework on every load. Both load third-party code at runtime; the versions are now pinned and integrity-checked, but the correct end state is to remove the runtime dependency entirely.
- **`COMP-006`** — 821 lines in a single function with 24 `useState` hooks, no component decomposition, no router. At the limit of maintainability; every added feature increases coupling.

### Data flow

```
Browser (COMP-006)
  └─ fetch('./api/*')  COMP-007
       └─ Hono router  COMP-003
            └─ SQL on DO storage  COMP-004
                 └─ App Durable Object persists via ctx.storage.sql  COMP-002

Static assets (COMP-005) served host-side; only unmatched requests reach the DO.

Third-party CDNs (COMP-008, COMP-009, COMP-011, COMP-012)
  load at page view — entirely outside the Worker boundary.
```

---

## The cross-reference that matters

Follow `DEP-006` (@babel/standalone) through the graph:

```
DEP-006  ──loads──▶  COMP-008  (in-browser JSX transpilation)
                        │
                        └─enables─▶  COMP-006  (the entire SPA)
                                        │
                                        └─carries─▶  all 31 FEAT-* entries
```

A third-party script sits upstream of every feature in the product. That is what the cross-linked IDs buy you: a supply-chain line item and a product capability turn out to be the same fact viewed from two ends. Pinning and SRI make that dependency *verifiable*; the build step is what finally makes it *disappear*.

---

## Verdict

**The product is beta-shaped. The engineering is alpha.**

The architecture is coherent and uses the platform correctly — the DO/SQLite/Hono pattern is idiomatic, asset routing is configured properly, and the importmap is handled with real care. This is meaningfully better than typical generated code.

What blocks beta is not structural wrongness. It is three absences — **auth, tests, a build step** — plus one component too large to grow further, and four phantom features that should either be finished or deleted.

Roughly a focused week of mostly mechanical work. The inventories above are the checklist; `features.json` carries the exact line references for each fix.
