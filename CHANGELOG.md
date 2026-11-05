# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each tagged release on GitHub is generated from the matching section below by
[`.github/workflows/release.yml`](.github/workflows/release.yml), so the
changelog is the single source of truth for what a release contains.

## [1.5.0] - 2026-11-05

### Added

- **GDS API standards and Technology Code of Practice compliance pass.** The project now closes every blocker identified in `docs/THREAT-MODEL.md` §6 and `docs/ROADMAP.md` M4.
  - Bearer-token authentication on `/api/*` (`src/index.ts:apiTokenAuth`), with `/health` and internal cron routes (`/api/inbox/fetch`, `/api/digest/send`, `/api/trash/purge`) exempt. Accepts `Authorization: Bearer <token>` or `?api_token=<token>`; returns 401 on mismatch. The gate stays open only when `API_TOKEN` is unset.
  - Structured audit logging (`src/audit.ts`, `audit_log` table) for settings, profile, credential and reset changes. Reads via `GET /api/audit/log?limit=`; records actor and IP but never records secret values.
  - AES-256-GCM settings encryption (`src/settings-crypto.ts`) keyed by `SETTINGS_ENCRYPTION_KEY`, with PBKDF2(SHA-256, 100000 iterations) and an `enc:v1:` prefix. Legacy XOR obfuscation is retained as a backwards-compatibility decoder only.
  - Masked secret compare view and break-glass revoke: `/api/settings` returns only the first 3 alphanumerics of sensitive values; `/api/settings/revoke` deletes them immediately.
  - CORS middleware on `/api/*` that echoes the request `Origin`, lists allowed methods and headers, short-circuits `OPTIONS` with 204, and sets `Access-Control-Max-Age: 86400`.
  - Cache-control header `Cache-Control: no-store, no-cache, must-revalidate, private` on every `/api/` response.
  - URI versioning alias `/api/v1/*` that forwards to `/api/*` while keeping unversioned paths stable.
  - Complete OpenAPI 3.0.3 rewrite (`openapi.yaml` and `public/openapi.yaml`) generated from the real 113-route inventory, global `bearerAuth` + `queryToken` security, public endpoints marked `security: []`, and the two files kept byte-identical.
  - Self-hosted fonts: Inter and JetBrains Mono woff2 files in `public/fonts/`; Google Fonts preconnect/stylesheet/`<noscript>` removed from `public/index.html` and `public/storybook.html`; `@font-face` rules added to `src/tailwind.css`; CSP tightened to `font-src 'self'`.
  - Capture source URL validation in `src/capture.ts` and `scripts/capture-wacz.py` using `ipaddress`; rejects non-HTTP(S), missing host, `localhost`, loopback, private, link-local, multicast and reserved ranges before a job is created.
  - Yahoo Mail API config resolved from `env` using the existing `src/email.ts` `pick()` rule; `fetchFromYahoo` now takes a resolved `YahooConfig`.
  - `scripts/sync-hackathons.mjs` rewritten to call the server's own import routes (`/api/devpost/import`, `/api/mlh/import`) instead of reimplementing scrapers; supports `--api` and `--token`/`API_TOKEN`; exits non-zero when any source fails. HackerEarth returns HTTP 501 because a keyless importer is infeasible.
  - Upstream schema-drift detection for Devpost (`src/devpost.ts`) plus a new MCP tool `inspect_schema_drift` (`src/mcp-tools.ts`) that reports the most recent drift diagnostics without changing the zod schema.
  - Progressive-disclosure settings UI with collapsible JMAP and IMAP sections, an Advanced tab, and a gated `<CheckpointCLI />` widget.
  - Terminal CLI at `scripts/taskmaster-cli.mjs` with a full REPL, `/help`, scenarios and export commands.

### Before

- `/api/*` had no authentication; anyone with the URL could read or write tasks, settings and hackathons.
- Secrets were XOR-obfuscated with a key in the source, and sensitive values were returned in plaintext.
- There was no audit trail for settings or credential changes.
- No CORS or cache headers were set on API responses.
- The API was unversioned and the OpenAPI spec was incomplete.
- `scripts/capture-wacz.py` could be pointed at private/loopback addresses.
- Google Fonts loaded an external stylesheet at page view.
- Hackathon sync was implemented as scrapers inside the script, duplicating server logic.

### After

- `/api/*` is gated by a bearer token in production while remaining open for local development when no token is configured.
- Sensitive settings are encrypted at rest, compared in a masked view, and can be revoked instantly.
- Every settings/profile/credential change is written to `audit_log` with actor and IP.
- API responses carry correct CORS and cache headers; clients can pin to `/api/v1/*`.
- OpenAPI accurately describes the route surface and is identical in the repo root and `public/`.
- Capture jobs are rejected before creation if the URL points to a non-public host.
- No external stylesheet or script executes at page view; fonts are self-hosted.
- `scripts/sync-hackathons.mjs` reuses the server's importers and fails loudly on errors.

### Why now

Portfolio readiness. The project was already feature-rich but still carried alpha-grade security assumptions. The compliance pass moves the baseline from "works for its author" to "can be deployed privately without leaking data or secrets", which is the precondition for any shared beta or public demo.

### Scenarios

1. **Private deployment.** You set `API_TOKEN` via `wrangler secret put API_TOKEN` and share the Worker URL with a trusted collaborator. Every write now requires the token, and every settings change is logged.
2. **Lost laptop.** A secret stored in settings is compromised. You open Settings, use the masked compare to confirm which key it is, and click Revoke; the value is deleted immediately and the action is audited.
3. **Automation script.** `scripts/sync-hackathons.mjs --api http://taskmaster.localhost --token $API_TOKEN` runs nightly, imports Devpost and MLH competitions through the authenticated API, and exits non-zero if an importer fails so your scheduler can alert you.
4. **Schema drift alert.** Devpost changes a field name. The next import detects the drift, writes a `UPSTREAM_SCHEMA_DRIFT` diagnostic, and the MCP tool `inspect_schema_drift` surfaces it so the parser can be updated before silent data loss occurs.

### Changed

- `docs/architecture.json`, `docs/features.json`, `docs/sbom.cyclonedx.json` and `docs/readiness-gates.json` updated to reflect the 1.5.0 state; `docs/readiness.json` and `docs/READINESS.md` regenerated.
- `README.md` security section rewritten from "Alpha / no auth" to describe the bearer-token gate, encrypted settings and debug-route gating.
- Release stage moved from **alpha** to **beta** in `docs/sbom.cyclonedx.json`.

### Security

- `apiTokenAuth` returns 401 for missing or mismatched tokens and exempts only `/health` and cron-internal routes.
- `audit_log` records field names, not values, for sensitive changes.
- `src/settings-crypto.ts` uses AES-256-GCM with a random IV per encryption; no key leaves values in plaintext passthrough.
- `/api/debug/*` routes are only registered when `DEBUG_ROUTES_ENABLED=true`.
- Capture URL validation blocks SSRF vectors against private/internal hosts.

## [1.4.0] - 2026-10-23

### Added

- **Court-ready Hackathon Lifecycle & Evidence Dossier.** A new route and local PDF builder turn a hackathon ticket and its linked evidence into a signed, reproducible bundle.
  - `GET /api/hackathons/:id/dossier-data` returns a canonical JSON payload containing the hackathon record, the user's eligibility profile, the computed qualification path, every matching inbox message, and every non-deleted attachment, plus a `master_sha256` over the canonical JSON so the bundle can be integrity-checked.
  - `scripts/build-dossier.py` renders the PDF locally with ReportLab. It is deliberately not run inside the Cloudflare Worker because ReportLab is a Python library; the Worker serves the data, the user's machine produces the document.
  - `scripts/dossier-fixture-json.mjs` generates a fixture payload in-process against the in-memory SQLite harness, so the dossier shape can be verified without a running wrangler dev server.

### Before

- Hackathon evidence lived in three separate places: the hackathon card, the inbox, and the attachment list. If a deadline, prize rule, or eligibility verdict changed, there was no snapshot to prove what the page said at the time you applied.
- Export meant screenshots and emails scattered across folders, with no single hash or index tying them to a specific competition.

### After

- One API call returns everything for one ticket in a stable, ordered JSON payload.
- The same data feeds a formatted PDF with cover sheet, hackathon summary, eligibility explanation, email timeline, artifact register, and integrity declaration.
- The payload is hashed before the hash field is injected, so tampering with any email, attachment, or profile value invalidates the dossier.

### Why now

Portfolio readiness and dispute protection. Hackathon terms change, deadlines slip, and eligibility wording can be ambiguous. A signed dossier gives you:
- An audit trail if an organiser rejects an entry after the fact.
- A single file to attach to a prize appeal, tax record, or portfolio case study.
- A reproducible artifact reviewers can generate themselves from the same JSON.

### Scenarios

1. **Rejected entry appeal.** You qualify under "EU citizens", the site later changes to "EU residents", and your entry is rejected. The dossier shows the original rule, your profile, and the qualifying path at the time of submission.
2. **Prize/tax audit.** A sponsor asks for proof of the competition date, prize pool, and your eligibility. The PDF contains the official URL, deadlines, prize, and attachments.
3. **Portfolio evidence.** You want to show a mentor or employer that you shipped for a specific hackathon. The dossier bundles the submission emails and artifacts in one document.
4. **Deadline dispute.** The organiser extends the deadline and denies your early submission. The dossier's email timeline and generation timestamp prove when you entered.

### Changed

- `src/dossier-routes.ts` imports use explicit `.ts` extensions so the route can be exercised under `node --experimental-strip-types` in the in-process test harness.

### Security

- Dossier data is scoped strictly to the requested `ticket_id`. Soft-deleted attachments (`deleted_at` is set) are excluded from the payload.
- The `master_sha256` is computed with `crypto.subtle` over the canonical JSON before the field is injected, preventing circular hashing.

## [1.1.0] - 2026-10-20

### Added

- **Hackathon Tracker** — full CRUD over competitions with deadline countdowns,
  prize display, platform badges, and status tracking.
- **Policy-structure eligibility engine** — rules are stored as JSON per
  hackathon, so a new hackathon needs no code change. Supports citizenship,
  residency, and region (EU/EEA/Schengen/UK/US/Global) constraints, age
  bounds, student-only, team size, and sponsor exclusions. Reports the
  qualifying path, not just eligible/not eligible.
- **Attachment system** — upload, list, download, and delete screenshots
  against a ticket. Previews inline in a modal.
- **Screenshot pipeline** — Playwright automation that visits competition
  pages, captures full-page screenshots, and uploads them as attachments.
- **Archive integration** — Wayback Machine CDX API adapter. Fetches archived
  snapshots and extracts deadlines, prizes, and rules. No live-site scraping.
- **Settings** — a storage-backend credential test (Cloudflare R2, Amazon S3,
  Azure Blob Storage), plus profile, notification, and email/IMAP
  configuration. The provider is tested, not yet wired to an upload path.
- **Capacity planner and daily digest** — a weekly available-hours template
  and a prioritised daily view: what fits today, what conflicts, what is due
  this week, and how much capacity is left.
- **JMAP email client** — RFC 8620/8621 support for JMAP-compatible servers.
  JSON instead of MIME parsing, stateless, push-capable.
- **Email inbox** — a Cloudflare Email Worker receives inbound mail, parses
  it, and files it against the right ticket. Non-hackathon mail is forwarded
  to the personal inbox.
- **Design system** — tokens as JSON, a written specification, a reusable
  component library, and a Storybook configuration.
- **Error boundary, health check, rate limiting, and security headers** — a
  crash in one component no longer blanks the app; the Worker answers
  `GET /health`; requests are capped per IP; responses carry CSP and the
  usual hardening headers.

### Changed

- Every SQL query that could throw on an empty result now uses an existence
  check first, so the 404 branches actually run.
- Delete handlers check for the row before deleting rather than reading a
  property the SQL cursor does not have.
- PATCH handlers validate that incoming values are strings or null before
  binding them.
- The view switcher uses a single `activeView` state, so exactly one of the
  task, hackathon, archive, settings, and digest views renders at a time.
- Route order puts the literal `/eligibility` and `/profile` paths ahead of
  the `:id` pattern, which would otherwise shadow them.
- Personal data in the seed file is anonymised, and the default profile ships
  empty so nobody inherits someone else's citizenship or age.

### Security

- The seed file no longer contains a real person's citizenship, residency
  status, or age.
- Source docstrings no longer contain personal email addresses.
- Screenshots and archived pages are stored per ticket; the inbox keeps
  extracted metadata rather than raw mail.

## [1.1.1] - 2026-10-20

### Fixed

- **`src/archive.ts` no longer breaks the Worker bundle.** The file opened with
  a Python-style triple quote, which TypeScript reads as a string that never
  closes, so `wrangler deploy --dry-run` failed and CI was red. It now opens
  with a normal block comment.
- A stray `import json` with no module specifier was removed from the same
  file. It was dead code and a second parse error.
- Twelve files carried mangled UTF-8 sequences, where an em dash had been
  decoded as Windows-1252 and re-encoded. They now hold the original bytes.
  This affects the changelog, the design system document, the design tokens,
  and seven component files.

## [1.2.0] - 2026-10-20

### Added

- **Inbox view.** A sidebar entry listing every email the Email Worker has
  filed, with unread markers, expandable bodies, mark-read and mark-processed,
  and delete. Unread count badges the sidebar item.
- **Eligibility verdicts on hackathon cards.** Each card now shows whether you
  qualify and, if you do, by which route — "eligible via EU citizenship (IT)",
  "eligible via UK residency (GB, settled)". Ineligible entries show the
  blocking reason. The engine existed; nothing displayed it.
- **Content-based inbox matching.** An email is matched to a hackathon by
  scoring its subject against each hackathon's name, so two competitions on the
  same platform stay distinguishable. A match records its confidence and the
  method used. Ambiguous emails are left unlinked rather than guessed, and
  `POST /api/inbox/:id/relink` lets you fix a link by hand.
- **Inbox rebuilt on reusable UI primitives.** A split view puts the list
  beside a detail panel, rows are keyboard reachable (Enter or Space opens one),
  and the sender avatar, unread dot, match confidence and attachment list follow
  the interaction patterns of cloudflare/agentic-inbox (Apache-2.0), rebuilt on
  TaskMaster Pro's own tokens. Email bodies render as plain text, so no HTML
  sanitiser is involved.

- **API test suite.** Thirty-six checks drive the real Hono routes against an
  in-memory SQLite database. They run in CI on every push.

### Fixed

- **Routes that never registered.** A misplaced brace in the hackathon module
  closed the registration function early, so the single-hackathon, create,
  update and delete routes were orphaned outside it and never ran. The same
  shape of error left the attachment upload and list handlers defined but
  unregistered. All routes now register exactly once.
- **Writes that were not reliably applied.** Route modules inserted rows and
  updated them without consuming the statement's cursor, so a read-back
  immediately afterwards could miss a row that had in fact been written. The
  original todos route already did this correctly; the newer modules now match
  it.
- **Route shadowing.** `/api/inbox/stats` was being swallowed by
  `/api/inbox/:id`. Literal paths are now registered before their parameter
  siblings.
- **Data that never loaded.** The mount effect had been narrowed to todos,
  lists and stats, so the hackathon, archive, digest and inbox views all
  opened empty. It now loads every view's data.
- **A ticket namespace that lied.** Attachments were uploaded to
  `/api/todos/:id/attachments` while carrying hackathon ids. The primary route
  is now `/api/tickets/:id/attachments`; the old path still works.
- **Mangled UTF-8.** Twelve files had an em dash decoded as Windows-1252 and
  re-encoded. They now hold the original bytes.
- **`.gitattributes`** added so line endings stay LF and binary files are never
  touched.

## [1.3.1] - 2026-10-21

### Fixed

- **The eligibility profile had two definitions and two defaults.**
  `src/hackathons.ts` had an empty profile; `src/settings.ts` had one with
  values in it. With nothing stored, the Settings screen showed a profile
  while the eligibility engine evaluated an empty one — so every verdict
  was computed against someone who did not exist. `src/profile.ts` now holds
  the type, the default, and a merge that fills in any field a stored
  profile is missing. Both modules read from it.
- **`POST /api/settings/reset` cleared only the settings blob**, not the
  canonical `hackathon_profile` table, so after a reset the screen and the
  engine disagreed again. It clears both now.

### Changed

- `scripts/verify-ui.py` seeds its own inbox messages and removes them
  afterwards, and waits on `domcontentloaded` rather than `networkidle`,
  which never settles against the wrangler dev server.

## [1.3.0] - 2026-10-21

### Added

- **A real Add/Edit Hackathon form.** The button set `isHackathonModalOpen`
  but no modal was ever rendered, so it did nothing. The form covers
  platform, status, prize, URL, dates, notes and eligibility rules, and is
  wired to `POST` and `PATCH /api/hackathons` with a delete action.
- **Multi-selection, in both lists.** Per-card checkboxes, select all, and
  bulk actions: mark open, mark closed and delete for hackathons; mark
  processed, mark unprocessed and delete for inbox messages. Ticking an
  inbox row stops the click and the keypress from reaching the row, so a
  message can be queued without opening it.
- **JMAP settings fields.** `src/jmap.ts` needs a server URL, a username and
  a password, and there was nowhere to configure them. `jmap_password` is
  obfuscated at rest like the IMAP password.
- **`scripts/verify-ui.py`** — 18 browser checks covering the Add Hackathon
  form, the populated settings screen, per-card screenshot upload, bulk
  selection in both lists, and the app rendering with no network at all.
- **`scripts/test-bugfixes.mjs`** — 34 route-level checks, including
  regression tests for the settings merge and the settings reset.

### Fixed

- **Settings rendered empty, for three separate reasons.**
  `GET /api/settings` threw on `row.value` where it meant `rows[0].value`.
  There was no `loadSettings`, so the state stayed null and every tab is
  gated on `settings &&`. And `PUT /api/settings` did
  `{...DEFAULT_SETTINGS, ...data}`, so editing one field reset every other
  section back to its defaults.
- **Attach Screenshot did nothing.** The button sat at the view level and
  used `editingHackathon.id`, which is null unless an Edit dialog had been
  opened. It now lives on each card and uploads to that card's id.
- **`setHackathonView` was called by three navigation buttons but never
  declared** — the flag was removed when `activeView` took over — so
  clicking Today, Settings or Archives threw at runtime.
- **`DELETE /api/hackathons/:id` had no return statement**, so the client
  received no response body.
- **The handbook's table cells were plain strings.** ReportLab draws those
  on one line, so long cells overflowed into the next column and overlapped
  it — the known-risks table was three columns of text on top of each other.
  Every cell is now a `Paragraph`, through one `mk_table` helper, with the
  header row repeating across page breaks.
- **The handbook's Modal sample showed a button, not a modal**, and the
  Banner sample showed one variant, because fixed banners all land on the
  same spot. `Banner` gained an `inline` mode, and the modal now has its own
  sample.

### Changed

- **The app no longer needs a network.** Google Fonts blocked the first
  paint, so with no connection the interface never appeared. The stylesheet
  now loads non-blocking and Tailwind carries system font fallbacks, so the
  app renders in the system stack immediately and swaps to Inter if the
  webfont ever arrives.
- The storybook has 13 stories, including the inbox selection state and the
  open modal. The capture script clears `docs/samples` first so a renamed
  component cannot leave a stale sample behind, and hides fixed overlays
  belonging to other stories.
- The handbook is 19 pages and includes a new known risk: the mail
  credentials in Settings are stored but nothing reads them. There is no
  IMAP client, and `src/jmap.ts` is not wired to any route — the inbox is
  filled by `POST /api/inbox`.

## [Unreleased]

### Added

- Continuous integration workflow (bundle check, docs-sync gate, seed-fixture
  validation) and a tag-driven release workflow.
- Security policy with an honest threat model.
- Deterministic seed fixtures and a seeder for QA and chaos testing.
- A front-end build: `npm run build` bundles `src/app.jsx` with esbuild and
  compiles `src/tailwind.css` with the Tailwind CLI into `public/assets/`.
  `npm run dev` and `npm run deploy` run it first, and CI fails if either
  asset is missing. `.dev.vars.example` documents local-only overrides.

### Changed

- **The front end is compiled now, not assembled in the visitor's browser.**
  This removed `@babel/standalone` (which transpiled ~40KB of JSX on every
  page load), the Tailwind Play CDN, and the esm.sh importmap for
  react/react-dom/lucide-react in a single move. Those libraries are pinned
  npm packages bundled into `app.js`, so **no third-party script executes at
  page view any more** — the only remaining external request is Google Fonts.
  It also removes the first-paint compile cost.
- `docs/features.json`, `docs/architecture.json` and
  `docs/sbom.cyclonedx.json` were re-anchored to the new file layout: the
  front end moved from an inline `<script>` in `public/index.html` to
  `src/app.jsx`, so every frontend line reference now points at the file that
  actually contains the code.

### Fixed

- **Front-end errors are visible instead of silently stale.** All nine `fetch`
  call sites swallowed failures into `console.error`, so a failed request left
  the UI showing old data with no indication anything had gone wrong. Requests
  now go through one `api()` helper that rejects on any non-2xx response and
  surfaces the server's own message in a dismissible banner with a retry.
  Mutations that would lose typed input (create task, create list) keep their
  modal open on failure. (`FEAT-025`, satisfies `G-TRUST-01`)
- Demo data no longer ships to every deployment. `seedDefaults()` is opt-in via
  `SEED_DEMO_DATA`, which `wrangler.json` sets to `false`. (`FEAT-022`)
- The declared `byStatus` counts in `docs/features.json` had drifted from the
  actual feature statuses (claimed 9/11/3/8, actually 13/8/3/7).
- The README and `docs/MAINTENANCE.md` described the CDN pinning procedure and
  the build step as future work; both now describe what the code does.

## [1.0.0] - 2026-10-16

First tagged release. Everything below is new relative to "no releases at all".

### Added

- **Todos** — create, update, complete, and delete tasks.
- **Priorities** — `low`, `medium`, `high`, `urgent`, filterable.
- **Tags and lists** — free-form tags stored as JSON per todo; lists are
  first-class rows with a colour and icon.
- **Pinning** — pinned todos sort to the top ahead of every other criterion.
- **Due dates** — todos sort by `due_date ASC` ahead of `created_at DESC`.
- **Search** — substring search across title and description.
- **Stats dashboard** — totals, completed, active, high-priority, due-today, and
  pomodoro counts.
- **Pomodoro tracking** — estimated and completed pomodoro counts per todo.
- **Durable Object backend** — a single `App` Durable Object holding an embedded
  SQLite database for persistent per-user state, exposed through a Hono REST API.
- **Static front end** — a single-page app served as Workers static assets.
- **Self-describing docs** — generated maturity checklist, feature and
  architecture inventories, an SBOM, and a maintenance guide under `docs/`.

### Security

- Third-party CDN assets are pinned with Subresource Integrity hashes.
- Self-ticking readiness check so claims about the code stay derived from the
  code rather than asserted by hand.

[Unreleased]: https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/releases/tag/v1.0.0
