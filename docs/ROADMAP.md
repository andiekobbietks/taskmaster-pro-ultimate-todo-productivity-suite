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

### M1 — Connect mail ingestion to the app — DONE

| | |
|---|---|
| **Was** | `src/jmap.ts` exported four functions and nothing imported it. There was no IMAP client at all. The inbox filled only by a manual `POST /api/inbox`. |
| **Now** | `src/mail.ts` reads the mail server configured in Settings and pulls anything new. `POST /api/inbox/fetch` does it on demand — a "Fetch mail now" button on the Settings email tab — and an hourly cron in `wrangler.json` does it in production, through the same route. |
| **Deduplication** | Messages from the mail server get a stable id (`inbox-jmap-<id>`), so fetching the same message twice is skipped rather than duplicated. The insert was extracted into `insertInboxItem` so both the manual route and the fetch share it. |
| **Still missing** | **IMAP.** Only JMAP (RFC 8620) is implemented, so the IMAP host, port, user and password in Settings do nothing. A Yahoo or Gmail user has to use a JMAP provider or keep forwarding mail. |
| **Proof** | 12 checks in `scripts/test-bugfixes.mjs`: no server configured is refused with an explanation, an unreachable server reports the cause, a stable id is not stored twice, and a message that names a competition is linked to it |

### M2 — Make the digest use the eligibility engine — DONE

| | |
|---|---|
| **Was** | `src/capacity.ts` set `const eligible = true; // Simplified`, and `GET /api/digest/priority` added a flat `+ 0.3; // eligible bonus` to every competition. The digest's score was urgency × 0.4 + prize × 0.3 + a constant, so an ineligible competition tied with an eligible one, and every result carried the path "eligible (no restrictions)". |
| **Now** | Both endpoints call `evaluateEligibility` — the same engine as `GET /api/hackathons/eligibility` — and report the real `eligible`, `qualification_path` and `reasons`. The profile is read from the canonical table, so the digest and the Settings screen cannot disagree. |
| **Proof** | 10 checks in `scripts/test-bugfixes.mjs`: a citizenship-restricted competition scores lower than an open one with the same deadline and prize, says why, and all three endpoints agree |

### M3 — Put the new test suites in CI — DONE

| | |
|---|---|
| **Was** | `.github/workflows/ci.yml` ran `npm test` only. The route regression suite and the browser suite ran nowhere but one machine, so 52 of the checks could rot silently. |
| **Now** | A `browser` job installs Playwright, starts the mock API, and runs the 18 browser checks; the `test` job also runs the route regression suite. Screenshots go to the runner's temp directory, not `docs/`, so the docs drift gate is unaffected. |
| **Proof** | 36 + 42 route checks and 18 browser checks now run on every push |

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

### C1 — Delete `src/components/Button.stories.jsx` — DONE

Written in Storybook's CSF format for a Storybook that was never
installed — there has never been a `@storybook/*` dependency in
`package.json`. The live component page is `src/storybook.jsx`, 13 stories,
no runtime dependency. The file implied a setup that did not exist, so it
is gone.

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
