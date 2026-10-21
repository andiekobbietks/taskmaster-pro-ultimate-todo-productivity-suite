# Roadmap — TaskMaster Pro

Ordered by the user's journey, not by feature. Every item states where the
code is today, what it blocks, and how you know it is finished. Every line
reference was read out of the source, not inferred.

Last checked: 2026-10-21, at commit `93e2bae`.

---

## The journey

The product exists for one person: a developer competing in several
hackathons a week. The information needed to enter and win a competition is
scattered across a dozen platforms, and the time to act on it is measured
in hours a week, not hours a day.

That gives six stages, and the value only lands if the chain between them
is unbroken:

| # | Stage | The user is doing | Where it lives |
|---|---|---|---|
| 1 | **Capture** | getting a competition into the system | `src/hackathons.ts`, `src/archive.ts` |
| 2 | **Qualify** | finding out whether they may enter | `src/hackathons.ts` — `evaluateEligibility` |
| 3 | **Receive** | learning that a competition exists | `src/jmap.ts`, `scripts/email_worker.ts` |
| 4 | **Triage** | sorting the noise from the signal | `src/inbox.ts` |
| 5 | **Plan** | deciding what to do today | `src/capacity.ts` |
| 6 | **Build** | actually doing the work | `src/index.ts` — todos |

**The critical path is 2 → 3 → 5.** Stage 2 produces the eligibility
verdict that stage 5 ranks by, and stage 3 is the only way a new
competition is ever heard about. Today the chain breaks in three places:

- Stage 3 has no live connection. `src/jmap.ts` exports four functions and
  **nothing imports it**; `scripts/email_worker.ts` is a separate Cloudflare
  Email Worker that needs its own domain and routing setup.
- Stage 5 does not use stage 2's output. `src/capacity.ts:200` sets
  `const eligible = true; // Simplified`.
- Stage 5 is not scheduled and never reads `todos`, so the plan does not
  know what is already committed.

---

## Must have

Broken chain, or no safety net. In critical-path order.

### M1 — Connect mail ingestion to the app

| | |
|---|---|
| **Where** | `src/jmap.ts:50` (`discoverJMAPSession`), `src/settings.ts:33` (`jmap_server_url`), `src/inbox.ts:194` (`POST /api/inbox`) |
| **Why critical path** | Stage 3. Nothing fills the inbox except a manual `POST /api/inbox`. The JMAP client is written and unimported; there is no IMAP client at all. |
| **Blocks** | S2, S3, and the whole inbox feature |
| **Done when** | A scheduled fetch reads the configured mail server, posts new mail to `POST /api/inbox`, and the inbox fills without a human |
| **Also needs** | A `triggers` block in `wrangler.json` — there is no `scheduled()` handler anywhere |

### M2 — Make the digest use the eligibility engine

| | |
|---|---|
| **Where** | `src/capacity.ts:200` (`const eligible = true`), `src/capacity.ts:204` (the score), `src/hackathons.ts:92` (`evaluateEligibility`) |
| **Why critical path** | Stage 2 → 5. The digest ranks competitions the user cannot enter alongside ones they can. The eligibility term in the score is a constant 0.3 and never separates anything. |
| **Blocks** | Nothing — it is a small, self-contained change |
| **Done when** | `GET /api/digest/priority` returns the same verdict as `GET /api/hackathons/eligibility` for the same competition, and an ineligible competition scores lower than an eligible one with the same deadline and prize |

### M3 — Put the new test suites in CI

| | |
|---|---|
| **Where** | `.github/workflows/ci.yml:123` runs `npm test` only — `scripts/test-bugfixes.mjs` (34 checks) and `scripts/verify-ui.py` (18 checks) run nowhere but this machine |
| **Why** | Without this, M1 and M2 can rot silently. 52 of the 88 checks that exist do not run on every push. |
| **Done when** | CI runs all three suites on every push and fails on a red one. `verify-ui.py` needs Playwright installed on the runner and a server on a known port |

### M4 — Authentication, before any public deployment

| | |
|---|---|
| **Where** | `src/index.ts:10` — the Durable Object has security *headers* middleware but no identity check |
| **Why** | Anyone with the URL has full read and write. Not needed for local dev, which is the current scope. This is the gate on the "scale out" step, not on the current one. |
| **Done when** | Every `/api/*` route requires a token, and data is scoped per user |

---

## Should have

The journey works but is manual, or the product is incomplete for the
person it is for.

### S1 — Make bulk capture real

`scripts/sync-hackathons.mjs:22` has all three sources set to
`enabled: false` — Devpost, MLH and lablab. The PRD's premise is that the
information is scattered across a dozen platforms; today capture is one
competition at a time, by hand. Pick one platform, make it work, then the
rest. `scripts/screenshot_pipeline.py` exists and is also standalone.

### S2 — Schedule the digest, and let it read the todos

`wrangler.json` declares no `triggers` and `src/capacity.ts` never reads
the `todos` table. Note that `digest.today_tasks` (`src/capacity.ts:225`)
holds **competitions**, not todo items — the frontend's "Focus today"
heading is misleading. Renaming it and adding the real todos closes that.

### S3 — Extend the handbook from components to views

The handbook documents 11 components. It does not document the views a
product manager actually looks at: Today, Hackathons, Settings, Archives.
Those are the screens the user judges the product by, and they have no
pixel samples.

### S4 — Storage path to R2, with signed URLs

`src/attachments.ts:78` writes every attachment into the SQLite BLOB table.
The Durable Object's ceiling is 10 GB, shared with everything else. There is
no `r2_buckets` binding in `wrangler.json`. The R2 branch of
`POST /api/settings/test-storage` (`src/settings.ts:343`) returns success
without touching anything.

### S5 — Real secret management

`imap_password` and `jmap_password` are obfuscated with a repeating XOR
key held in the source. That keeps them out of plain sight in a database
dump; it is not encryption.

---

## Could have

### C1 — Delete `src/components/Button.stories.jsx`

Written in Storybook's CSF format for a Storybook that was never
installed — there has never been a `@storybook/*` dependency in
`package.json`. The live component page is `src/storybook.jsx`, 13 stories,
no runtime dependency. The file implies a setup that does not exist.

### C2 — Wire the screenshot pipeline to a route

So a competition can be captured by URL without a Python process on the
side.

### C3 — State matrix and do/don't pairs in the handbook

No variant matrix, no usage guidance, no dark-mode comparisons, no
responsive notes, no accessibility annotations.

### C4 — Accessibility pass on the new multi-select

Both lists gained checkboxes inside a `role="button"` row that stops
propagation. That pattern needs an axe run and a keyboard walk, not just a
click test.

### C5 — Responsive pixel samples

Every sample is captured at one width.

---

## Won't have, for now

- **A Storybook runtime dependency.** The static page renders every
  component from the real source and needs no install. Adding the runtime
  buys nothing for one app.
- **A generic handbook generator for any app.** The capture and generate
  loop is one generator script for one app. Generalising it needs the
  story, token and manifest contracts extracted first.
- **Live scraping of Devpost or MLH.** The product's own principle is "no
  scraping, no ToS issues" — `src/archive.ts` exists for exactly that
  reason.

---

## Dependency graph

```
M1 mail ingestion ──┬─→ S2 scheduled digest ──→ S3 handbook views
                     └─→ S1 bulk capture
M2 digest eligibility ──→ S2
M3 CI ────────────────→ protects M1, M2, and everything after
M4 auth ──────────────→ gates any public deployment (not local dev)

S4 R2 storage ──→ unlocks screenshot volume
S5 secrets ────→ gates S4 for real credentials
```

M1 and M2 are independent and can run in parallel. M3 can start
immediately and should, because it protects both.

---

## Current state, measured

| | |
|---|---|
| Routes registered | 48 |
| Exported components | 11 across 8 files |
| Storybook stories | 13 |
| Pixel samples | 12 |
| Handbook | 19 pages |
| API checks | 36 in CI, 34 local only |
| Browser checks | 18, local only |
| Scheduled handlers | 0 |
| Cron triggers | 0 |
| Scripts no route reaches | 16 |

## How to work this list

Pick the top of Must. Each item names the file and the line, so the first
move is an editor, not a decision. When an item is finished, run all three
suites:

```powershell
npm test                                              # 36 route checks
node --experimental-strip-types scripts/test-bugfixes.mjs   # 34 route checks
python scripts/verify-ui.py                            # 18 browser checks
```

and update this file to move the item up or mark it done.
