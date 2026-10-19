# TaskMaster Pro — Ultimate Todo & Productivity Suite

## What this is, in plain terms

TaskMaster is a to-do list app. It runs in a web browser, saves your tasks on the
server, and works on a phone or a laptop without installing anything. It does the
ordinary things a good to-do app should: create tasks, set priorities and due dates,
group them into lists, tag them, pin the important ones, search everything, and show
a small dashboard of how much you got done.

**How mature is it?** It is **Alpha** — early. It works, and the current release
fixes the reason it previously didn't. It is not yet something to load with
confidential data. See [Is it ready to use?](#-is-it-ready-to-use) below.

**Who is it for?** At the moment, one person or a small trusted team. There are no
user accounts yet — see [Security](#-security), which is the single most important
section in this file.

![TaskMaster Pro — the task list, with priority badges, due dates, tags and a per-task focus timer](docs/images/task-list.png)

*Every task carries its own priority, due date, tags and pomodoro estimate. Pinned
tasks sort to the top; the rest sort by due date. Search, filters and the focus
timer all act on the same list.*

## 💡 What this product is actually about

Most to-do apps are a checklist. This one is built around a different premise:
**a task is only useful if you can tell whether you are actually finishing it.**

That shows up in the choices:

- **Pomodoro focus is per task, not global.** Every task carries its own estimate
  and its own completed count. The question the app answers is not *"what is on my
  list"* but *"did I actually do the thing I said I would do"*.
- **Estimates and completions are separate numbers.** A task can be estimated at 4
  pomodoros and completed at 7. That gap is the signal, and it is the reason the
  stats dashboard exists.
- **Sorting is opinionated.** Pinned first, then by due date, then newest. Not by
  alphabetical order or manual drag-and-drop — the list you see is the list that
  needs your attention next.
- **Failures are visible.** A request that fails shows a banner with a retry. The
  alternative — a screen that silently shows stale data — is the failure mode this
  project has the least patience for.
- **The data model is small and inspectable.** Two tables, thirteen columns, no
  hidden services. You can read the whole schema in one screen.

The honest summary: **this is an opinionated small-team task list, not a project
management suite.** It does a few things deliberately rather than many things
approximately. [`docs/VERTICAL-SLICES.md`](docs/VERTICAL-SLICES.md) is candid about
which parts are finished and which are only advertised.

---

<details>
<summary><strong>Technical detail (skip if you don't need it)</strong></summary>

A full-featured todo and productivity app built on **Cloudflare Workers**, using a
**Durable Object** with an embedded SQLite database for persistent, per-user state
and a **Hono** REST API.

</details>

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-4.6-000000?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6?style=flat-square&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/Storage-SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
[![CI](https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite?sort=semver)](https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-16A34A?style=flat-square)](LICENSE)

**Stage: Alpha** — the honest maturity answer, derived from the code rather than asserted, lives in [`docs/READINESS.md`](docs/READINESS.md).

## ✨ Features

- **Todos** — create, update, complete, and delete tasks
- **Priorities** — filter tasks by priority level
- **Tags & lists** — organise tasks into lists and tag them freely
- **Pinning** — pin important tasks so they sort to the top
- **Due dates** — tasks sort by due date ahead of creation date
- **Search** — full-text search across titles and descriptions
- **Stats dashboard** — aggregated productivity stats at a glance
- **Pomodoro tracking** — estimated and completed pomodoro counts per task
- **Visible failures** — every request reports errors in the UI with a retry, instead of leaving the screen silently stale

## 📗 Is it ready to use?

**Yes for trying out. Not yet for anything you would mind losing.**

| | |
|---|---|
| **Works?** | Yes, as of `v1.0.1`. The previous release, `v1.0.0`, could not serve its own data at all — see [`docs/VERSION-HISTORY.md`](docs/VERSION-HISTORY.md). |
| **Safe for private or sensitive data?** | **No.** There are no user accounts yet. Anyone who finds the web address can read, change or delete everything on it. |
| **Safe to share with a team?** | Only with people you trust completely, and only after the decisions in [`docs/THREAT-NOTE.md`](docs/THREAT-NOTE.md) are implemented. |
| **Will it lose your data?** | No. Tasks are stored on the server, not in your browser, so you can close the tab and come back. |
| **Does it cost anything?** | No, on Cloudflare's free tier — comfortably so for a small team. |

The one-line answer: **it is a working prototype.** The code is sound and tested by
four automated checks, but the security work for real users has not started yet.
That is deliberate and documented, not an oversight.

## 🧭 Which parts of this file do you need?

This README serves two audiences, so it is written in two layers. Read the top
three sections and stop — you have what you need. Everything below is for people
building or hosting it.

| If you want to… | Read |
|---|---|
| Know what the app does | [What this is](#what-this-is-in-plain-terms), [Features](#-features) |
| Know whether it's safe to use | [Is it ready to use?](#-is-it-ready-to-use) |
| Know what was broken and why | [`docs/VERSION-HISTORY.md`](docs/VERSION-HISTORY.md) — [plain version](#what-this-is-in-plain-terms) |
| Share it with the team safely | [`docs/THREAT-NOTE.md`](docs/THREAT-NOTE.md) — starts with a no-jargon summary |
| Install and run it | [Run Locally](#-run-locally) |
| Deploy it | [Releases](#-releases), [Security](#-security) |
| Change it | [Project Structure](#-project-structure) onward, plus `docs/MAINTENANCE.md` |

## 🗂 Project Structure

```
.
├── .github/workflows/
│   ├── ci.yml            # Front-end build, Worker bundle check, docs-sync gate, seed validation
│   └── release.yml       # Tag -> GitHub Release, notes pulled from CHANGELOG.md
├── docs/                 # Self-describing, mostly GENERATED docs (see below)
│   ├── scripts/readiness.mjs
│   ├── READINESS.md      # Generated maturity checklist
│   ├── features.json     # Feature inventory (source of truth)
│   ├── architecture.json # Component inventory
│   └── sbom.cyclonedx.json
├── public/
│   ├── index.html        # SPA shell - no inline scripts
│   └── assets/           # BUILD OUTPUT (app.js + app.css) - gitignored, rebuilt by npm run build
├── scripts/
│   ├── seed.mjs          # Load QA/chaos fixtures into a running instance
│   ├── validate-seed.mjs # Guard the fixtures (runs in CI)
│   └── extract-changelog.mjs
├── seed/
│   └── chaos-fixtures.json
├── src/
│   ├── app.jsx           # The whole front end, compiled by esbuild
│   ├── lib/api.js        # Every request goes through here, with visible error handling
│   ├── tailwind.css      # Tailwind entry + design tokens, compiled to app.css
│   └── index.ts          # Durable Object + Hono REST API
├── .dev.vars.example     # Template for local-only overrides (copy to .dev.vars)
├── tailwind.config.cjs
├── CHANGELOG.md
├── SECURITY.md
├── package.json
└── wrangler.json         # Cloudflare Workers configuration
```

## 🚀 Run Locally

```bash
npm install
npm run build   # esbuild + Tailwind CLI -> public/assets/
npm run dev     # build, then npx wrangler dev
```

Wrangler serves the static assets from `public/` and runs the Durable Object API in-process. **`public/assets/` is build output and is not committed**, so a fresh clone serves a blank page until the build runs — `npm run dev` does that for you, but a bare `npx wrangler dev` will not.

Local-only overrides live in `.dev.vars`, which is gitignored and never deployed:

```bash
cp .dev.vars.example .dev.vars   # then edit; SEED_DEMO_DATA=true gives you demo data locally
```

## 🔌 API

All routes are handled inside the `App` Durable Object.

| Method | Route                  | Description                                   |
| ------ | ---------------------- | --------------------------------------------- |
| GET    | `/api/todos`           | List todos (filters: `status`, `priority`, `search`, `tag`, `listId`) |
| POST   | `/api/todos`           | Create a todo                                  |
| PATCH  | `/api/todos/:id`       | Update a todo                                  |
| DELETE | `/api/todos/:id`       | Delete a todo                                  |
| GET    | `/api/lists`           | List all lists                                 |
| POST   | `/api/lists`           | Create a list                                  |
| DELETE | `/api/lists/:id`       | Delete a list (todos are reassigned to `inbox`)|
| GET    | `/api/stats`           | Aggregated stats                               |

Todos are returned sorted by `is_pinned DESC, due_date ASC, created_at DESC`.

## ✅ Quality gates (CI)

Every push to `main` and every pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Job | What it proves |
| --- | -------------- |
| **Builds + Worker bundles** | `npm run build` produces both front-end assets, then `wrangler deploy --dry-run` bundles the Worker exactly as a real deploy would. Fails on a broken import, a bad `wrangler.json`, a missing asset path, or a front-end build that no longer compiles. Needs no credentials and uploads nothing. |
| **Docs match the code** | Regenerates `docs/READINESS.md` and `docs/readiness.json` from the inventories and fails if the committed copies drifted, so a readiness claim can never silently disagree with the code. |
| **Seed fixtures are valid** | Validates `seed/chaos-fixtures.json` so a malformed fixture is caught before a test session, not during one. |

> Continuous *delivery* (auto-deploy on merge) is deliberately not enabled: it needs a `CLOUDFLARE_API_TOKEN` repository secret. Add that secret and a deploy job is a few lines — see [`wrangler.json`](wrangler.json) and `npm run deploy`.

## 🏷 Releases

A release is a git tag. The tag drives everything:

```bash
# 1. Write the section in CHANGELOG.md (this is the single source of truth)
# 2. Commit, then tag and push:
git tag v1.1.0
git push origin v1.1.0
```

Pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which extracts that version's section from `CHANGELOG.md` into the release notes and publishes the GitHub Release. Tagging a version that has no changelog section **fails loudly** rather than shipping empty notes.

Releases are listed at [Releases](https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/releases).

## 🔒 Security

Read [`SECURITY.md`](SECURITY.md) first — it states plainly that **there is no authentication**, so a deployed instance must be treated as public and untrusted.

- Report vulnerabilities privately via the **Security** tab → **Report a vulnerability**. Do not file public issues for security reports.
- A machine-readable dependency inventory is at [`docs/sbom.cyclonedx.json`](docs/sbom.cyclonedx.json).
- The browser loads no third-party script at all: React, react-dom, lucide-react and the compiled Tailwind stylesheet are bundled from npm at build time. The only remaining third-party request is Google Fonts (two typefaces), which executes no code.

## 🧪 Seed data for QA & chaos testing

`seed/chaos-fixtures.json` is deterministic edge-case data — the payloads that tend to break a todo app — plus the assertions you should check afterwards.

```bash
npm run dev                 # in one terminal
npm run seed                # in another, targets http://localhost:8787
npm run seed -- --dry-run   # print the plan without touching anything
npm run seed -- --api https://your-instance.example
```

What it covers: unicode/emoji/bidi text, oversized titles and descriptions, XSS and SQL-injection probes (stored as data, never executed), quotes and backslashes, past/today/far-future/null due dates, duplicate titles, pinned-vs-unpinned sort ties, every priority level, empty/long/numeric tags, and negative/zero/huge pomodoro estimates. It also sends two requests that **must be rejected** (a whitespace-only title and a missing title), turning the seeder into a smoke test.

Two behaviours worth knowing, both documented in the fixture file:

- `NULL` due dates sort **first** under SQLite's `ASC`, before real dates — that is current behaviour, not a bug to "fix" quietly.
- The API assigns `created_at` at insert time, so later-seeded rows sort **earlier** when everything else ties.

Run `npm run seed:validate` to check the fixtures without a running instance.

### The four built-in demo todos are opt-in

The Worker used to inject four sample tasks and three sample lists into every new deployment with no way to stop it. That is now **off by default**:

- `wrangler.json` sets `SEED_DEMO_DATA=false`, so a real deployment starts with a clean slate.
- To get the demo data locally, copy `.dev.vars.example` to `.dev.vars` and set `SEED_DEMO_DATA=true`.
- For richer data than the four samples, use `npm run seed` — it posts the QA/chaos fixtures above.

## 📚 Self-describing docs

`docs/` is mostly **generated**, which is the point: the descriptions are derived from the code instead of drifting away from it.

- [`docs/READINESS.md`](docs/READINESS.md) — a maturity checklist that ticks itself, per stage (Alpha → Beta → GA → Enterprise) and per target customer.
- `docs/features.json` / `docs/architecture.json` — the inventories that drive it.
- `docs/sbom.cyclonedx.json` — the dependency bill of materials.
- [`docs/INVENTORIES.md`](docs/INVENTORIES.md) — the same inventories in readable form.
- [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md) — how to change things.

After editing an inventory, run `npm run docs:readiness` and commit the result — CI enforces this.

## 🔗 Connecting this repo to GitHub (and disconnecting)

You are already reading this on GitHub, so the repository is the source of truth. If you later connect this project to a builder platform (bolt.new, Lovable, and similar), the contract those platforms use is:

- **Connect** — authorize the platform's GitHub app, then either create a new repository or link this one. Sync is **two-way on the default branch** (`main`).
- **Disconnect** — sync stops and **nothing is deleted**: this repository stays on GitHub with its full history, and your project continues to live wherever it was. Reconnecting generally **creates a new repository** rather than resuming the old link.
- **Gotchas** — one Git provider per project at a time; renaming or moving the repository can break sync permanently.

Because this repository already holds the history, the safe move is always: keep the GitHub repo, disconnect the platform, and pull.

## 📄 License

MIT — see [`LICENSE`](LICENSE).
