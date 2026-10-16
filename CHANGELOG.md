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
