# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each tagged release on GitHub is generated from the matching section below by
[`.github/workflows/release.yml`](.github/workflows/release.yml), so the
changelog is the single source of truth for what a release contains.

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
