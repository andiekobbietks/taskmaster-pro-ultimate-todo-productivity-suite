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
| **The format** | `src/mime.ts` parses a raw MIME source: folded headers, repeated headers, multipart, quoted-printable, base64, RFC 2047. `POST /api/inbox` takes either a raw source or structured fields, so anything that can fetch mail can feed the app. Tested against a real Devpost message. |
| **Still missing** | **The transport.** Only JMAP (RFC 8620) is implemented, so the IMAP host, port, user and password in Settings do nothing. A Yahoo or Gmail user has to use a JMAP provider, point the app at the Yahoo Mail API, or post the raw source in from outside. |
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

### S1 — Make bulk capture real — DONE

**The capture side is done too.** `scripts/capture-wacz.py` drives
Playwright, records every response the page makes, writes a WARC, and
packages it as a WACZ. It then posts the archive to
`POST /api/archive/wacz`.

| Piece | Where |
|---|---|
| The WACZ reader | `src/wacz.ts` |
| The ingest route | `POST /api/archive/wacz` in `src/archive.ts` |
| The capture | `scripts/capture-wacz.py` |
| The validator | `scripts/validate-wacz.py` |
| A real WACZ to test against | `scripts/fixtures/sample-capture.wacz` |

The capture records the same-origin traffic by default, so a capture holds
the page and its assets rather than the analytics and font hosts the page
happened to call. `--allow-external` turns that off.

CI captures a page and checks the archive with **warcio**, which is not
the code that wrote it. If warcio can read the archive, the WARC is well
formed enough for pywb and the rest of the webrecorder tooling.

**The manifest lives in the app.** Settings has a Capture tab with the
list of pages to capture. `POST /api/capture/jobs` queues them, and
`scripts/capture-wacz.py --from-app` takes its work from the app, so
there is no configuration file to keep in step. A capture that arrives
closes its job and creates the competition, named from the page's own
title.

**Still not done: finding them.** `scripts/sync-hackathons.mjs:22`
has all three sources set to `enabled: false` — Devpost, MLH and lablab.
`docs/HACKATHON-SOURCES.md` has what the research found, and two of the
findings changed the answer:

- **There is no RSS feed for hackathon listings, anywhere.** Devpost's
  `feed.rss` returns the homepage as HTML, and MLH has no feed at all.
  The feeds that work are tech-news feeds — TechCabal and Gadget for
  EMEA, AIM and YourStory for India — and they find hackathons
  *mentioned in articles*, which is noisy and will miss most.
- **Devpost serves a Cloudflare bot challenge to a headless browser.**
  Both the listing and a single competition page came back as the
  challenge, not the page. The capture machinery is fine — it recorded
  14 responses and warcio read every record — but the browser has to be
  a real one with a profile that has solved the challenge before.

So the routes to "find them all" are: the Wayback Machine, which
`src/archive.ts` already reads; a persistent real-Chrome profile for
the capture, which is a small change to a script that already works; or
a platform with a real API, where the data is clean but the prizes are
smaller.

### The mail transport — MOSTLY DONE

The Yahoo Mail API works, and the app fetches the mail itself with it,
inside the Worker. Register an application at developer.yahoo.com with
the Mail / Read permission, then put the client id, the client secret
and the refresh token in Settings → Email. There is a button that checks
them.

**Still missing: IMAP.** A Gmail user has nothing to point the app at.
They have to use the Yahoo API, a JMAP provider, or post the raw source
in from outside. That is the last piece of the transport.

The WACZ format, from the Webrecorder specification 1.1.1:

```
datapackage.json          the collection description
datapackage-digest.json   its hash
archive/data.warc.gz      every raw HTTP transaction, gzipped
pages/pages.jsonl         one line per captured page
indexes/index.cdx.gz      a CDX index, for random access
```

**On the Wayback Machine's own archiving.** Save Page Now can be
triggered, and its form has a "Email me a WACZ file with the results"
option. Two reasons not to build on it: it is rate limited per IP — the
response carries `X-RL`, the number of captures left, and it answers 429
once that runs out — and the WACZ arrives **by email**, so it lands in
the inbox rather than in a file the pipeline can point at. Keep the
Wayback route for pages that are already archived; do not automate
archiving.

`scripts/sync-hackathons.mjs:22` still has all three sources set to
`enabled: false` — Devpost, MLH and lablab. That is a separate problem
from the format, and the answer to it is still "pick one platform".

### S2 — Schedule the digest, and let it read the todos

`wrangler.json` declares no `triggers` and `src/capacity.ts` never reads
the `todos` table. Note that `digest.today_tasks` (`src/capacity.ts:225`)
holds **competitions**, not todo items — the frontend's "Focus today"
heading is misleading. Renaming it and adding the real todos closes that.

### S3 — Extend the handbook from components to views — DONE

The handbook documented 11 components. It did not document the views a
product manager actually looks at: Today, Hackathons, Settings, Archives.
Those are the screens the user judges the product by, and they had no
pixel samples.

`scripts/capture-views.py` drives the running app with Playwright and
captures each view at two times resolution into `docs/samples/views/`. The
handbook has a new section 3, "The views", and what followed it is
renumbered. The samples are cropped to the content, and the sidebar is
left out: it is the same on every screen, and in a document page it takes
a third of the width.

While capturing them, a bug surfaced that the component samples had
hidden: `fetchDigest`, `fetchCapacity` and `fetchWeeklyPlan` were defined
and **never called**, so the Today view showed "Loading..." until you
pressed Refresh. Same family as the settings screen — a loader written
and then not wired to anything.

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

## The security findings

`docs/THREAT-MODEL.md` is a STRIDE walk of the whole app, written
2026-10-21. Seven findings. Two were fixed during the walk; five are open.

| # | Finding | Severity | State |
|---|---|---|---|
| 1 | No authentication on any `/api/*` route | Critical | **open** |
| 2 | No audit trail | High | **open** |
| 3 | The capture runner does not validate the URL it is given | High | partly fixed 2026-10-21 |
| 4 | Secrets are XOR-obfuscated, not encrypted | Medium | open |
| 5 | The Durable Object is a single thread | Medium | open |
| 6 | Captured pages and mail are untrusted input to an agent | Medium | open, inherent |
| 7 | The rate limit is per IP, in one shared object | Low | open |

**Finding 3 was not fully fixed.** The upload and the decompressed
archive are now capped, but the runner still does not check the scheme
or reject private address ranges. That is the next thing to do with it.

**On Vault and Supabase:** neither is implemented, and neither should be.
The threat note has the reasoning. The three things that should exist
instead are Cloudflare Workers Secrets for the deployment secrets, Web
Crypto for the per-user credentials at rest, and a token on the routes.
The token is finding 1, and it is the only one that is critical.

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
