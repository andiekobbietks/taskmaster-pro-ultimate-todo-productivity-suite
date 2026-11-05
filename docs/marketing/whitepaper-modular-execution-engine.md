# The Modular Execution Engine

## Why TaskMaster Pro is not a todo app

**Whitepaper · TaskMaster Pro v1.5.0**

---

## Abstract

Most productivity software treats work as a static list of tasks. That model
works for chores and projects, but it fails for time-sensitive opportunities:
hackathons, grants, bug bounties and procurement deadlines. These opportunities
have three properties that a todo list cannot capture:

1. **They appear and change while you are not looking.**
2. **They come with external rules that determine whether you can participate.**
3. **They require auditable evidence if something goes wrong.**

TaskMaster Pro is a **modular execution engine** built on Cloudflare's edge
platform. It provides a shared core — tasks, storage, security, audit, calendar
publishing and an agent protocol surface — and plugs domain-specific modules into
that core. Module 1, Hackathons, is production-ready. Modules 2–4
(Grants, Bug Bounties, Enterprise Tenders) are architected and can reuse the same
primitives.

This paper explains the taxonomy, the core, the calendar model, the security
baseline and the commercial Open Core shape that follows from the design.

---

## 1. The problem: deadline intelligence is not task management

A traditional task manager records a decision *after* a human has made it. It
does not discover opportunities, interpret eligibility rules, subscribe a phone
calendar to a live feed, or produce a dispute-ready evidence bundle.

For time-sensitive work, the real workflow looks like this:

```
Discover → Filter (eligibility) → Track → Gather evidence → Submit → Dispute?
```

Each stage has different tooling today:

- **Discover:** RSS, Discord, Twitter/X, email newsletters, manual site checks.
- **Filter:** Reading terms and conditions repeatedly.
- **Track:** A calendar event copied by hand, often wrong by a timezone.
- **Evidence:** Screenshots, browser bookmarks, emails scattered across services.
- **Submit:** A form at the last minute.
- **Dispute:** A hope that the organiser remembers the original terms.

The result is missed deadlines, rejected submissions and unprovable claims.
TaskMaster Pro replaces this toolchain with one coherent engine.

---

## 2. A taxonomy for the system

A taxonomy is a classification system. TaskMaster Pro is classified into two
categories:

- **Core** — shared infrastructure that every domain module needs.
- **Domain modules** — pluggable verticals that add ingest, rules and evidence.

### Core responsibilities

| Capability | Purpose |
|---|---|
| Edge runtime and routing | HTTP handling, CORS, cache headers, URI versioning, rate limiting |
| Stateful persistence | Per-space SQLite inside a Durable Object |
| Universal tasks and tags | Action items, lists, search, pinning |
| Evidence vault | Attachments with soft-delete trash and 30-day auto-purge |
| Inbound mail | Parsing and linking emails to opportunities |
| Live calendar publisher | RFC 5545 iCalendar feed at `/api/calendar.ics` |
| MCP server | 21 tools for AI agents |
| Timezone scheduling | Deadline conversion and capacity planning |
| Security baseline | Bearer-token gate, audit log, AES-256-GCM encryption |

### Domain module responsibilities

| Module | Ingest | Rules engine | Evidence output |
|---|---|---|---|
| **Module 1: Hackathons** | Devpost API, WACZ archives, MLH | Eligibility (residency, citizenship, age, student status) | Submission dossier (PDF) |
| **Module 2: Grants** | UKRI, Innovate UK, Horizon Europe (planned) | Budget and compliance thresholds | Grant Application Audit Ledger |
| **Module 3: Bug Bounties** | HackerOne, Bugcrowd (planned) | In-scope / out-of-scope verification | Disclosure chain-of-custody report |
| **Module 4: Enterprise Tenders** | Government / corporate RFP feeds (planned) | Deadline and mandatory-criteria matcher | Tender Bid Submission Ledger |

Every module reuses the core. A new vertical is mostly domain logic plus the
existing primitives.

---

## 3. The core engine

### 3.1 Runtime and storage

TaskMaster Pro runs as a Cloudflare Worker with a single Durable Object (`App`)
per deployment. The Durable Object hosts an embedded SQLite database that
survives redeploys. This is deliberately single-tenant: one token-protected space
per user or team, not a multi-user SaaS.

### 3.2 Universal task surface

The front end is a React single-page app. Tasks carry tags, priorities, due
dates and attachments. The same task primitives are used by every module: a
hackathon submission, a grant deadline and a tender response are all tasks with
different source metadata.

### 3.3 Evidence vault

Attachments are stored as BLOBs in the same SQLite database as the tasks. Delete
is a soft delete: bytes are kept, `deleted_at` and `purge_at` are set, and an
hourly cron hard-deletes after the configured retention period (default 30 days).
Restore is a pointer flip. This gives a safety net without endless undo dialogs.

### 3.4 Inbound mail

A raw email parser receives mail at `/api/inbox/fetch`. Emails can be linked to
opportunities and included in evidence bundles.

### 3.5 MCP server

The Model Context Protocol server exposes 21 tools over Streamable HTTP. Agents
can create tasks, query hackathons, import Devpost pages, inspect schema drift,
generate dossiers and read diagnostics. The tool surface is intentionally
stateless so agents cannot accidentally corrupt data across sessions.

### 3.6 Timezone and capacity

Deadlines are stored as `TEXT` in `YYYY-MM-DD` or ISO form and converted to wall
clock time in the user's zone. Capacity planning answers: "If I need 4 hours per
day in Dublin time, how many tasks fit before the deadline?"

---

## 4. Module 1: Hackathons

The first domain module turns TaskMaster Pro into an automated competition
workflow.

### 4.1 Ingestion

- **Devpost:** `GET https://devpost.com/api/hackathons?status[]=open&per_page=40&page=N`
- **MLH:** season-based API; 2026 season currently returns 24 past events and no
  upcoming events, so imports are closed rows until the next season publishes.
- **HackerEarth:** deliberately returns HTTP 501. A keyless importer is
  infeasible, so the route fails fast rather than scraping without permission.
- **WACZ:** web archives can be imported for pages that lack an API.

### 4.2 Eligibility engine

Rules are stored as JSON per hackathon. The engine is deterministic and
rule-based, not an LLM. It returns:

- `eligible` — the user meets the criteria.
- `not eligible` — a hard rule fails.
- `needs review` — a soft or unclear rule applies.

Current rule dimensions include country of residence, citizenship, age and
student status. This covers the most common competition restrictions without
guessing.

### 4.3 Evidence and dossier

The dossier generator (`scripts/build-dossier.py`) produces a PDF bundle with:

- Competition metadata
- Prize and deadline snapshots
- WACZ archive hashes
- Linked email milestones
- Audit timestamps

This is designed to be credible in a submission dispute or prize appeal.

---

## 5. The zero-babysit calendar

The calendar feed is one of the strongest product hooks because it removes the
need to open the app.

```
[ External source ]
        │
        ▼
[ Importer cron ]
        │
        ▼
[ SQLite ]
        │
        ▼
[ /api/calendar.ics ]
        │
        ▼
[ iPhone / Outlook / Google Calendar ]
```

The user subscribes to `/api/calendar.ics` once. After that, every importer run
that adds, updates or removes a deadline is reflected on the phone's lock screen
and wrist within the calendar client's next background fetch.

The same feed will carry grant deadlines, bounty disclosure windows and tender
closing dates once those modules exist.

---

## 6. Security baseline

The 1.5.0 release established the platform security baseline that makes modules
safe:

- **Bearer-token gate:** `Authorization: Bearer <token>` or `?api_token=` on
  `/api/*`. When `API_TOKEN` is unset, the gate stays open for local development.
- **Audit log:** `audit_log` table records actor, IP, action and changed field
  names (never values) for settings, profile and credential changes.
- **Settings encryption:** AES-256-GCM with PBKDF2(SHA-256, 100,000 iterations)
  from `SETTINGS_ENCRYPTION_KEY`. Legacy XOR is retained only for migration.
- **Break-glass revoke:** secrets can be revoked immediately from the settings
  UI.
- **Self-hosted assets:** six woff2 font files; no external stylesheet or script
  is loaded at page view.
- **Cache headers:** `Cache-Control: no-store, no-cache, must-revalidate, private`
  on all `/api/` paths.

This baseline is shared by every future module.

---

## 7. The Open Core model

The commercial shape follows from the module split.

### Core — open / free

- Basic task manager
- SQLite edge storage
- Simple calendar subscription
- MCP tool surface
- Auth, audit and encryption baseline

Anyone can self-host the core on their own Cloudflare account.

### Pro — modular upgrades

- Automated Hackathon & Opportunity Engine
- WACZ cryptographic web archiving
- Court-ready PDF Dossier Generator
- Domain-specific eligibility / compliance rules
- Agentic MCP workflows tuned to a vertical

The value is not the todo list. The value is **pluggable operational
intelligence**: discovery, eligibility checking, evidence guarantees and
calendar sync that runs without manual babysitting.

---

## 8. Adoption pattern

A team or individual adopts TaskMaster Pro in three stages:

1. **Core self-host:** deploy the worker, add one API token, subscribe the
calendar.
2. **Module 1 activation:** connect Devpost and MLH, set eligibility profile,
let the cron run.
3. **Module expansion:** when the next vertical is released, enable it with the
same storage, audit trail and security baseline.

Because each module reuses the core, the marginal cost of adding a new vertical
is low. The architecture encourages composability over feature bloat.

---

## 9. Conclusion

TaskMaster Pro is a **time-sensitive execution engine**, not a todo app. Its
core provides the persistence, security, calendar, audit and agent surface that
every deadline-driven workflow needs. Its modules provide the domain-specific
ingest, rules and evidence that make those workflows actionable.

Module 1, Hackathons, proves the model. Modules 2–4 show how the model
generalises. The Open Core split gives users a free, self-hostable foundation and
gives the project a clear path to sustainable Pro revenue.

The right container for a deadline is not a checkbox. It is an engine.

---

## Appendix: current measured state (v1.5.0)

- Runtime dependencies: 5 (`hono`, `lucide-react`, `react`, `react-dom`, `zod`)
- Dev dependencies: 4 (`@modelcontextprotocol/sdk`, `esbuild`, `portless`, `tailwindcss`)
- Test suites: 4 — 36, 270, 26 and 42 checks, all passing (374 total)
- MCP tools: 21
- Self-hosted font files: 6
- Modules implemented: 1 (Hackathons)
- Modules planned: 3 (Grants, Bug Bounties, Enterprise Tenders)
