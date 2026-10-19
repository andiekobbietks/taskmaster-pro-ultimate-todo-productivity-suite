# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each tagged release on GitHub is generated from the matching section below by
[`.github/workflows/release.yml`](.github/workflows/release.yml), so the
changelog is the single source of truth for what a release contains.

## [Unreleased]

## [1.0.1] - 2026-10-19

Everything below shipped after `v1.0.0` was tagged. The single most important
item is the third one under **Fixed**: `v1.0.0` shipped a Durable Object that
`wrangler.json` never bound, so the API could not serve. This is the first tag
that includes that fix.

**In plain terms.** Version 1.0.0 was released broken — it could not load or save
tasks at all, though nothing on screen said so. This release is the first that
actually works. It also fixes two filters that appeared to work but did not
(filtering by tag returned everything; searching for something containing a `%`
returned everything), makes failed requests visible instead of silent, and adds an
automatic check that compares files against each other so this class of fault
cannot ship again.

Everything below is the detail.

### Added

- **A static cross-file consistency check.** `scripts/tier1-check.mjs` compares
  code against configuration and fails on the defect class a build cannot see:
  a Durable Object exported but absent from `durable_objects.bindings`, a
  missing `migrations` entry, an unnamed worker, a query parameter that is read
  and then dropped before it reaches the SQL, and README routes that no longer
  exist. Dependency-free, runs in well under a second, wired up as a fourth CI
  job and available locally as `npm run check:consistency`.
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

- **`?tag=` no longer lies.** `GET /api/todos` read the `tag` query parameter and
  then dropped it before the SQL, so a tagged filter silently returned unfiltered
  results while both the README and the documented API surface advertised it. It
  is now matched with `EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`,
  which compares an exact JSON element rather than a substring. (`FEAT-010`)
- **A search for `100%` no longer matches everything.** The `LIKE` pattern was
  built from raw input with no escaping, so `%` and `_` acted as wildcards. A
  new `escapeLike()` helper escapes them and the clause declares `ESCAPE`.
  (`FEAT-013`)
- **The Worker can actually serve its API.** `v1.0.0` shipped `src/index.ts`
  exporting `App extends DurableObject` next to a `wrangler.json` with no `name`,
  no `durable_objects` binding and no `migrations` entry, so the DO was never
  constructed and every route 404'd at the edge.
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

[Unreleased]: https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/releases/tag/v1.0.0
