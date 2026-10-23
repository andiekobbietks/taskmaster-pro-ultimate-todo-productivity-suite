# TaskMaster Pro — Ultimate Todo & Productivity Suite

> The first concrete reference project produced by **AK Build** and the **`@cf-vibesdk/sdk`** — a deployable, full-stack app that started from a plain-language prompt and was shaped by an AI agent inside the AK Build workspace.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-4.6-000000?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6?style=flat-square&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/Storage-SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
[![CI](https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite?sort=semver)](https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite/blob/main/LICENSE)

## What this is, in plain terms

TaskMaster Pro is a to-do and productivity app that runs in a browser, saves state on the server, and works on a phone or laptop without an install. It handles tasks, lists, priorities, due dates, tags, pinned items, a per-task focus timer, search, a weekly dashboard, hackathon deadline tracking, email digests, web push reminders, and a small diagnostics/checkpoint CLI.

It is **Alpha** — it works end to end, but it does not yet have user accounts or authentication. Do not load it with confidential data until you add an auth layer.

## Why it exists

This app is a **reference implementation**: a real, runnable product that exercises the AK Build / VibeSDK platform from prompt to deployment. It is deliberately more than a toy demo — it uses Durable Objects, embedded SQLite, web push, scheduled cron jobs, multi-source importers, settings with masked secrets, and a checkpoint/diagnostics subsystem so the platform is tested against real engineering decisions.

## Built by AK Build

TaskMaster Pro was generated inside the [AK Build](https://github.com/andiekobbietks/ak-build) agent workspace. The repository's earliest commits were authored by the platform agent before any human-authored commit:

| Hash | Date | Message | Author |
|---|---|---|---|
| `dd54eef` | 2026-09-27 | `chore: initialize think space` | `Agent <agent@vibesdk.local>` |
| `eda3a6c` | 2026-09-27 | `deploy: snapshot working tree` | `Agent <agent@vibesdk.local>` |

The first human commit, `d9a5505` on 2026-10-16, arrived more than two weeks later. The agent therefore produced the app's skeleton, build wiring, and first deployable shape.

### What AK Build is

AK Build is a forked and adapted local development workspace originally based on Cloudflare's **VibeSDK**. Its public repository is [`andiekobbietks/ak-build`](https://github.com/andiekobbietks/ak-build); the workspace's `vibesdk/README.md` describes it as the user-facing product of **VibeEdge Studio**, an AndieKobbieTech project building toward the **AKCloud** sovereign-cloud proposition:

> “AK Build gives a founder or small team a focused, inspectable environment for describing an idea, working with an AI agent, and shipping a live preview.”

In plainer terms, AK Build is an **app builder**: you describe what you want in ordinary language, and an AI agent writes a working app — screens, database, routes, and deployment wiring — that you can run locally and iterate.

The lineage, timeline, and fork rationale are recorded in the AK Build workspace's `vibesdk/README.md`, its `provisioner/README.md`, and the builder handbook.

The VibeSDK fork was cloned locally on **24 September 2026**, the `ak-build-local` branch was created on **25 September 2026**, and the working state was tagged **`ak-build-working-2026-10-15`**. The AK Build identity first appears in the VibeSDK history in commit `00a6946` on 2026-09-25:

```text
commit 00a694685fba8baa016a3e8af324567f6be92a42
Author: AK Build Dev <dev@akbuild.local>
Date:   Fri Sep 25 22:00:56 2026 +0100
feat: add gated large-change workflow, project instructions, and skills
```

### The SDK

The SDK that drives the workspace is **`@cf-vibesdk/sdk`**. Its README in the AK Build workspace documents the `AgenticClient`, `BuildSession`, phase-based builds (`wait.deployable()`), file listings, and deployment waits. The provisioner README confirms the SDK already drives the running platform over HTTP and WebSocket.

### Why "first reference project"

Three facts from the local PC support the description:

1. **Agent authorship.** No earlier application repository found in the local `.git` scan contains the `Agent <agent@vibesdk.local>` authorship that starts TaskMaster Pro. The two commits above are the earliest platform-generated application code present.
2. **Timeline.** The AK Build identity (`AK Build Dev <dev@akbuild.local>`) first appears on 2026-09-25, and TaskMaster Pro was initialized by the agent on 2026-09-27 — two days later.
3. **Workspace listing.** A saved AK Build session snapshot shows “TaskMaster Pro - Ultimate T…” listed as a private app in the AK Build UI at `localhost:5173`.

None of these is a marketing quote on its own. Together they form the strongest line of evidence available from local git history: TaskMaster Pro is the first concrete app generated inside the AK Build workspace, so it is treated as the first reference project.

## What it does

- **Tasks** with priority, due dates, tags, notes, and sub-tasks
- **Lists** to group tasks
- **Pinned tasks** and a **focus timer** per task
- **Search** across tasks, lists, and notes, with collapsible categories
- **Dashboard** summarising your week
- **Hackathon tracker** with deadline countdowns, filters, and platform chips
- **Email subscriptions** to receive digest updates
- **Progressive Web App (PWA)** support — installable on desktop and mobile
- **Web push notifications** for reminders and digests
- **Settings** with masked secrets, progressive disclosure, collapsible JMAP/IMAP sections, and revoke controls
- **Diagnostics / checkpoint CLI** for endpoint failure logging and rollback snapshots, gated behind an Advanced settings toggle
- **Multi-source hackathon importers** (Devpost, MLH, HackerEarth)

## Architecture

- **Cloudflare Worker** (`src/index.ts`) — Hono REST API and static asset serving
- **Durable Object** (`App`) — one per team/user, hosting embedded SQLite state
- **React front end** (`src/app.jsx`) — JSX, Tailwind CSS, Lucide icons
- **Web Push** (`src/push.ts`) — hand-rolled VAPID delivery
- **MCP server** (`src/mcp.ts`) — Streamable HTTP transport for the TaskMaster tool surface
- **Scheduled function** (`scheduled()`) — cron-based digest and hackathon refresh hooks
- **Stateless diagnostics** (`src/diagnostics.ts`, `src/checkpoints.ts`) — endpoint failure logging and full-table snapshots

Runtime dependencies are deliberately tiny:

```json
"hono": "^4.6.x",
"lucide-react": "^0.x",
"react": "^18.x",
"react-dom": "^18.x"
```

`zod` is currently required by the MCP tool layer in `src/mcp-tools.ts`, so the dependency count is effectively five until that layer is either inlined or removed.

## Quick start

```bash
git clone https://github.com/andiekobbietks/taskmaster-pro-ultimate-todo-productivity-suite.git
cd taskmaster-pro-ultimate-todo-productivity-suite
npm install
cp .dev.vars.example .dev.vars
npm run build
npm run dev
```

Local proxy via `portless`:

```bash
npx portless proxy start --no-tls
npx portless alias taskmaster 8787   # http://taskmaster.localhost
```

## Developer notes

- `npm test` runs the in-process test harness (36 tests).
- `npm run test:routes` runs the route/bug-fix regression harness (245 tests).
- `npm run test:push` exercises the VAPID + push encryption paths.
- `npm run seed` populates a fresh DO with sample data.
- `npm run docs:readiness` exports the readiness checklist.
- The terminal CLI is at `scripts/taskmaster-cli.mjs`.

## Security

This project is **Alpha** and currently has **no authentication or authorization**. Do not deploy it with real user data or expose sensitive endpoints (`/api/debug/*`, `/api/diagnostics*`, `/api/checkpoints*`) to untrusted networks without adding an auth layer.

Key points:

- Anyone who can reach the Worker can read or write any task or setting.
- Push subscriptions, email subscriptions, and hackathon imports run without per-user checks.
- The checkpoint/diagnostics UI widget is gated by an **Advanced** settings toggle, but the API routes are not authenticated.

## License

MIT — see [LICENSE](LICENSE).
