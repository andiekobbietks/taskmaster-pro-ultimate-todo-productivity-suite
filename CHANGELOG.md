# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each tagged release on GitHub is generated from the matching section below by
[`.github/workflows/release.yml`](.github/workflows/release.yml), so the
changelog is the single source of truth for what a release contains.

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
- **Settings** — swappable storage backend (Cloudflare R2, Amazon S3, Azure
  Blob Storage) with a connection test, plus profile, notification, and
  email/IMAP configuration.
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
