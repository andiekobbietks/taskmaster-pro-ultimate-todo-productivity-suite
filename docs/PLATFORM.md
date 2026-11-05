# Platform architecture — TaskMaster Pro

TaskMaster Pro is not a hackathon app. It is a **time-sensitive execution engine**
built on Cloudflare's edge platform. The "hackathon" surface is simply the first
domain module plugged into that core.

This document explains the modular model, what belongs to the core, what belongs
to a domain module, and how the commercial "Open Core" shape follows from that
split.

---

## 1. The core engine

The core is everything a high-stakes, deadline-driven workflow needs regardless
of domain. It is intentionally small in dependency surface and large in
platform leverage.

| Capability | What it provides | Where it lives |
|---|---|---|
| **Edge runtime & routing** | HTTP request handling, CORS, cache headers, URI versioning, rate limiting | `src/index.ts` |
| **Stateful persistence** | Per-space SQLite inside a Durable Object; survives deploys | `src/index.ts` (`App` DO) |
| **Universal tasks & tags** | Task CRUD, lists, priorities, due dates, search, pinning | `src/index.ts`, `src/app.jsx` |
| **Evidence vault** | Attachments with soft-delete trash and 30-day auto-purge | `src/attachments.ts`, `src/trash.ts` |
| **Inbound mail** | Raw email parser and inbox endpoint | `src/inbox.ts`, `src/mail.ts` |
| **Live calendar publisher** | RFC 5545 iCalendar feed at `/api/calendar.ics` | `src/calendar-routes.ts` |
| **MCP server** | 21-tool Model Context Protocol surface for AI agents | `src/mcp.ts`, `src/mcp-tools.ts` |
| **Timezone-aware scheduling** | Deadline conversion, capacity planning, iCalendar generation | `src/timezone.ts`, `src/capacity.ts` |
| **Security baseline** | Bearer-token gate, audit trail, AES-256-GCM settings encryption | `src/index.ts`, `src/audit.ts`, `src/settings-crypto.ts` |
| **Diagnostics** | Endpoint failure logging and checkpoint snapshots | `src/diagnostics.ts`, `src/checkpoints.ts` |

The core is deliberately single-tenant. It protects a private deployment with a
shared token; it does not provide per-user authorization. That is the right
shape for a personal or small-team engine and the wrong shape for a multi-user
SaaS.

---

## 2. The calendar is zero-babysit

The calendar feed is one of the strongest product hooks because it removes the
need to open the app to stay on top of deadlines.

```
[ Devpost / Ingestion Cron ]
           │ (auto-updates)
           ▼
[ TaskMaster SQLite ]
           │
           ▼ (serves live RFC 5545 feed at /api/calendar.ics)
[ iPhone / Outlook / Google Calendar ]
```

How it works in practice:

1. On your iPhone, go to **Settings → Calendar → Accounts → Add Subscribed
   Calendar** once.
2. Paste `https://your-domain.com/api/calendar.ics`.
3. You never touch it again.

When the hourly cron ingests a new hackathon, updates a prize or adjusts a
deadline, SQLite updates immediately. The next time iOS Calendar or Outlook does
its background fetch, your calendar silently updates. Deadlines appear on your
lock screen and wrist without you ever opening TaskMaster Pro.

This same feed can carry grant deadlines, bounty disclosure windows, or tender
closing dates once those modules exist.

---

## 3. Module taxonomy

A taxonomy is a classification system. The module taxonomy here splits the
product into **Core** plus pluggable **domain modules**. Each module adds its own
data sources, rules engine and evidence output, but reuses the core for storage,
tasks, calendar, audit and MCP.

### Module 1: Hackathons (current)

The first domain module. It turns the core into an automated competition
workflow.

| Layer | Component | File |
|---|---|---|
| Ingestion | Devpost API + WACZ web archive import | `src/devpost.ts`, `src/archive.ts` |
| Rules | Legal & immigration eligibility engine (IT/GB/EU rules, student status, residency) | `src/hackathons.ts` |
| Evidence | Court-ready ReportLab PDF dossier with WACZ hashes and email milestones | `src/dossier-routes.ts`, `scripts/build-dossier.py` |
| Calendar | Live deadlines feed | `src/calendar-routes.ts` |

### Modules 2–4: future plug-ins

These are not implemented. They are included to show how the core generalises.

| Module / vertical | What it tracks | Unique engine added | Evidence / dossier produced |
|---|---|---|---|
| **Module 2: Grants & Research Funding** | UKRI, Horizon Europe, Innovate UK calls | Grant compliance & budget-threshold calculator | Grant Application Audit Ledger + submission receipts |
| **Module 3: Bug Bounties & Security** | HackerOne, Bugcrowd targets | Scope verification engine (in-scope vs out-of-scope assets) | Vulnerability disclosure chain-of-custody report |
| **Module 4: Enterprise Tenders & RFPs** | Government / corporate procurement | Procurement deadline & mandatory-criteria matcher | Formal Tender Bid Submission Ledger |

Every module reuses the same primitives: tasks for action items, attachments for
evidence, the calendar for deadlines, the inbox for inbound notifications, and
the dossier generator for final submission bundles.

---

## 4. What "Pro" means: the Open Core model

The commercial shape follows directly from the module split.

### Core (open / free)

Anyone can self-host:

- Basic task manager
- SQLite edge storage
- Simple calendar subscription
- MCP tool surface
- Auth/audit/encryption baseline

### Pro (modular upgrades)

The domain intelligence is what makes it "TaskMaster Pro":

- Automated Hackathon & Opportunity Engine
- WACZ cryptographic web archiving
- Court-ready PDF Dossier Generator
- Eligibility / compliance rules engines
- Agentic MCP workflows tuned to a domain

You are not selling a todo list. You are selling **pluggable operational
intelligence**: discovery, eligibility checking, evidence guarantees, and
calendar sync that runs without manual babysitting.

---

## 5. Why this matters for the codebase

The 1.5.0 compliance pass was not just security hygiene — it was the platform
baseline that makes the modular model safe to expose:

- Bearer-token auth protects any module's data.
- Audit logging records who changed what.
- AES-256-GCM encryption keeps module credentials safe.
- URI versioning lets modules pin to a stable API.
- OpenAPI accuracy lets external integrators build against the surface.

Without that baseline, a grant or tender module could not safely store API keys,
receive inbound mail, or produce auditable evidence. With it, each new module is
mostly domain logic plus the existing core primitives.

---

## 6. Adding a new module

The expected pattern:

1. Add a route module under `src/` (e.g. `src/grants.ts`).
2. Add importer/crawler logic that calls external APIs and writes to the core
   SQLite tables.
3. Add a rules engine that returns structured eligibility or compliance output.
4. Reuse `src/attachments.ts` for evidence and `scripts/build-dossier.py` (or a
   variant) for final bundles.
5. Expose module-specific tools through `src/mcp-tools.ts`.
6. Add module rows to this document and update `docs/architecture.json`.

The core should not need to change.
