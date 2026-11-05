# TaskMaster Pro — interactive landing page copy

> A single-page, product-led landing page. The hero contains a live input: paste any
> Devpost URL and the page shows the calendar feed, eligibility verdict and dossier
> outline without signing up.

---

## Hero section

### Headline

**The deadline-driven execution engine.**

### Subheadline

TaskMaster Pro turns hackathons, grants, bug bounties and tenders into a
zero-babysit calendar, an eligibility engine and a court-ready evidence dossier.

### Primary CTA

[Try it with a live Devpost URL]  [Read the platform whitepaper]

### Live demo input

```text
Paste a Devpost URL                                          → See my calendar
https://devpost.com/hackathons/...
```

**What happens next (no account required):**

1. We read the competition page and extract the deadline, prizes and rules.
2. We check the rules against your profile (location, age, student status).
3. We generate an `Add to calendar` link and a one-page evidence checklist.

---

## Social proof bar

> “I stopped missing submission windows. My calendar now updates itself.”

- 5 runtime dependencies
- 21 MCP tools for agent workflows
- 374 passing tests across 4 suites
- Open Core, self-hostable on Cloudflare Workers

---

## Why todo apps fail for time-sensitive work

A generic task manager records *what* you decided to do. It does not:

- Discover new opportunities while you sleep.
- Parse eligibility rules and tell you **No — students only**.
- Subscribe your phone calendar to a live deadline feed.
- Archive the web page, emails and screenshots you need if a dispute happens.

TaskMaster Pro is not a better to-do list. It is a **time-sensitive execution
engine** with pluggable domain modules.

---

## How it works (3 steps)

### 1. Ingest

Connect Devpost, MLH or import a WACZ web archive. The hourly cron pulls new
competitions, prize changes and deadline updates into your private SQLite store.

### 2. Decide

The deterministic eligibility engine answers **eligible**, **not eligible** or
**needs review** in milliseconds. No LLM hallucination, no guesswork.

### 3. Execute

- One subscribed calendar keeps the deadline on your lock screen.
- Attachments + trash give you a 30-day safety net.
- The dossier generator exports a timestamped PDF bundle for submissions or
disputes.

---

## The platform model

TaskMaster Pro is built as a shared **Core** plus pluggable **domain modules**:

| Core | Module 1: Hackathons | Future modules |
|---|---|---|
| Tasks, tags, search | Devpost + WACZ ingest | Grants & research funding |
| Edge SQLite storage | Eligibility engine | Bug bounties |
| Live iCalendar feed | Evidence dossier (PDF) | Enterprise tenders |
| Audit log + encryption | MLH / HackerEarth routes | …and anything with a deadline |

You adopt one module now. The others plug into the same calendar, audit trail and
security baseline later.

---

## Feature comparison

| Capability | TaskMaster Pro | Notion | Trello | Spreadsheet |
|---|---|---|---|---|
| Auto-ingest deadlines from Devpost/MLH | ✅ | ❌ | ❌ | ❌ |
| Eligibility rules engine | ✅ | ❌ | ❌ | manual |
| Live calendar feed | ✅ | limited | ❌ | ❌ |
| WACZ web-archive evidence | ✅ | ❌ | ❌ | ❌ |
| Court-ready dossier export | ✅ | ❌ | ❌ | ❌ |
| MCP agent surface | ✅ | ❌ | ❌ | ❌ |
| Self-hostable / single-tenant | ✅ | ❌ | ❌ | maybe |

---

## Use cases

### For solo hackers

Paste a URL. Know in 10 seconds if you can enter. Add the deadline to your
iPhone calendar once. Never open the app again until you win.

### For teams

Share one token-protected deployment. Every team member sees the same
opportunities, eligibility verdicts and evidence attachments.

### For organisers and lawyers

Generate a timestamped PDF dossier with WACZ hashes and email milestones for
terms-of-service disputes or prize appeals.

---

## Security and trust

- Bearer-token gate on every `/api/*` route.
- AES-256-GCM encryption for settings and credentials.
- Immutable audit log for settings, profile and credential changes.
- Self-hosted fonts; no third-party scripts at page view.
- Single-tenant by design — your data stays in your Durable Object.

---

## Pricing / adoption model

**Core — open and free**

Tasks, calendar, MCP, audit, encryption. Self-host on your own Cloudflare
account.

**Pro — modular upgrades**

- Hackathon & opportunity engine
- WACZ cryptographic archiving
- Court-ready dossier generator
- Domain-specific MCP workflows

You are not buying a todo list. You are buying **pluggable operational
intelligence**.

### Secondary CTAs

[Get the whitepaper]  [View GitHub]  [Self-host in 5 minutes]

---

## FAQ (short)

**Do I need a Cloudflare account?**
Yes for self-hosting. The worker runs on Cloudflare Workers; the SQLite store
lives inside a Durable Object.

**Is my data shared with Devpost or MLH?**
No. The importer calls their public APIs from your worker. Your competition list
and attachments stay in your own database.

**Can I add my own module?**
Yes. The pattern is documented in `docs/PLATFORM.md`: add a route module,
reingest source, add rules, reuse attachments and the dossier generator.

**What if a deadline changes?**
The hourly cron updates SQLite. Your subscribed calendar refreshes on its next
background fetch — usually within minutes.

---

## Footer

Built with **AK Build** and the **Cloudflare VibeSDK**. Open Core. Self-hostable.
Beta.

[GitHub] · [Documentation] · [MCP reference] · [Changelog]
