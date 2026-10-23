# taskmaster-pro — Readiness

> **Current stage: Alpha** · 6/19 gates passing
>
> This file is **generated**. Run `node docs/scripts/readiness.mjs` after changing any inventory.
> Do not edit it by hand — your changes will be overwritten.

## What this is

A maturity checklist that **ticks itself**. Each gate is a claim about readiness, and it is derived directly from the code inventories rather than asserted by hand. When a feature ships, the gate that depends on it turns green on the next run.

The stages answer one question each — the exit question is the honest test:

- **Alpha** — Can I demo this to myself without it falling over?
- **Beta** — Can a stranger use this without me sitting next to them?
- **General Availability** — Would I put a paying customer's data in here and sleep?
- **Enterprise Ready** — Would a security reviewer sign this off?

## Stage progress

| Stage | Progress | Gates | Exit question |
|---|---|---|---|
| ✅ Alpha | `██████████` 100% | 2/2 | Can I demo this to myself without it falling over? |
| 🔶 Beta | `██░░░░░░░░` 17% | 1/6 | Can a stranger use this without me sitting next to them? |
| 🔶 General Availability | `█████░░░░░` 50% | 3/6 | Would I put a paying customer's data in here and sleep? |
| ⬜ Enterprise Ready | `░░░░░░░░░░` 0% | 0/5 | Would a security reviewer sign this off? |

## Readiness by target customer

The same codebase is "ready" or not depending on who you are selling to. Pick your ICP and the blockers change.

| Target | Ready? | Progress | What's blocking |
|---|---|---|---|
| ✅ Personal / solo use | yes | `██████████` 100% (2/2) | — |
| 🚫 Team / shared beta | no | `████░░░░░░` 38% (3/8) | `G-TRUST-02` No phantom features<br>`G-ACCESS-01` Access control exists<br>`G-SCOPE-01` The product works on the device it is used on<br>*+2 more* |
| 🚫 Paid SaaS customers | no | `████░░░░░░` 43% (6/14) | `G-TRUST-02` No phantom features<br>`G-ACCESS-01` Access control exists<br>`G-SCOPE-01` The product works on the device it is used on<br>*+5 more* |
| 🚫 Enterprise procurement | no | `███░░░░░░░` 32% (6/19) | `G-TRUST-02` No phantom features<br>`G-ACCESS-01` Access control exists<br>`G-SCOPE-01` The product works on the device it is used on<br>*+10 more* |

## Next actions

Highest-leverage unmet gates, ordered by stage then effort — the smallest change that moves you furthest.

### `G-TRUST-02` No phantom features

**Stage:** beta · **Effort:** small

*Why this matters:* A feature that appears to work but silently does nothing is worse than an absent one. Absent is honest; phantom misleads the user and the next developer.

*Current state:* 3 phantom feature(s)

Target: `FEAT-010` **Filter by tag** — stub (`src/index.ts:16 (declared), absent from query builder lines 19-43`)

### `G-SCOPE-01` The product works on the device it is used on

**Stage:** beta · **Effort:** small

*Why this matters:* A responsive layout that hides navigation on small screens is not responsive. It silently becomes desktop-only.

*Current state:* FEAT-024 is "partial"

Target: `FEAT-024` **Responsive layout** — partial (`src/app.jsx:340 (search hidden sm:block), 383 (sidebar hidden lg:flex), 352 (timer hidden md:flex)`)

### `G-SAFE-01` Destructive actions are survivable

**Stage:** beta · **Effort:** small

*Why this matters:* Data loss in a productivity tool is unrecoverable by the user. Deletion must confirm, and must report honestly when it removed nothing.

*Current state:* none of FEAT-004/FEAT-028 ready

Target: `FEAT-004` **Delete task** — partial (`src/index.ts:170-174, src/app.jsx:270 (deleteTodo)`)

### `G-SAFE-02` User input cannot alter query semantics

**Stage:** beta · **Effort:** small

*Why this matters:* Parameterised SQL prevents injection but not LIKE-wildcard semantics. Unescaped wildcards mean a search for '100%' silently matches everything.

*Current state:* FEAT-013 is "partial"

Target: `FEAT-013` **Search title + description** — partial (`src/index.ts:38-41, src/app.jsx:85 (searchQuery state), 340-344 (search input)`)

### `G-ACCESS-01` Access control exists

**Stage:** beta · **Effort:** medium

*Why this matters:* The moment a link is shared, anyone holding the URL has full read and write. Single-tenant-by-architecture is not access control.

*Current state:* FEAT-027 is "planned"

Target: `FEAT-027` **Authentication / access control** — planned (`grep for auth|bearer|token|session|cookie across repo returns only the word 'session' in an alert() string`)

### `G-PORT-01` Users can extract their data

**Stage:** ga · **Effort:** small

*Why this matters:* Data a user cannot leave with is data they do not own. Export is also the cheapest possible escape hatch for your own migration problems.

*Current state:* FEAT-028 is "planned"

Target: `FEAT-028` **Data export** — planned (`absent`)

---

## Full gate list

| Gate | Stage | Status | Evidence | Effort |
|---|---|---|---|---|
| `G-CORE-01` Core CRUD loop works | alpha | ✅ pass | all 4 ready | done |
| `G-CORE-02` Data persists beyond the process | alpha | ✅ pass | satisfied by COMP-004 | done |
| `G-TRUST-01` Users see failures instead of silent staleness | beta | ✅ pass | FEAT-025 is "implemented" | small |
| `G-TRUST-02` No phantom features | beta | ⬜ not met | 3 phantom feature(s) | small |
| `G-ACCESS-01` Access control exists | beta | ⬜ not met | FEAT-027 is "planned" | medium |
| `G-SCOPE-01` The product works on the device it is used on | beta | ⬜ not met | FEAT-024 is "partial" | small |
| `G-SAFE-01` Destructive actions are survivable | beta | ⬜ not met | none of FEAT-004/FEAT-028 ready | small |
| `G-SAFE-02` User input cannot alter query semantics | beta | ⬜ not met | FEAT-013 is "partial" | small |
| `G-QUAL-01` Automated tests exist | ga | ⬜ not met | COMP-015 is "missing" | medium |
| `G-QUAL-02` Changes ship through a pipeline | ga | ✅ pass | FEAT-030 is "partial" | medium |
| `G-SUPPLY-01` Third-party code is pinned and integrity-checked | ga | ✅ pass | 0 unpinned dep(s) | done |
| `G-BUILD-01` No build work happens in the user's browser | ga | ✅ pass | COMP-017 is "solid" | done |
| `G-PORT-01` Users can extract their data | ga | ⬜ not met | FEAT-028 is "planned" | small |
| `G-SCALE-01` Read paths are bounded | ga | ⬜ not met | FEAT-031 is "planned" | small |
| `G-OPS-01` Federated identity (SSO/SAML/OIDC) | enterprise | ⬜ not met | FEAT-027 is "planned" | large |
| `G-OPS-02` Audit log of who changed what | enterprise | ⬜ not met | FEAT-027 is "planned" | large |
| `G-OPS-03` Monitoring, alerting and a documented recovery path | enterprise | ⬜ not met | COMP-015 is "missing" | large |
| `G-OPS-04` Tenancy isolation is enforced, not incidental | enterprise | ⬜ not met | COMP-016 is "missing" | large |
| `G-COMP-01` Documented compliance posture | enterprise | ⬜ not met | none of FEAT-027 ready | large |
