# TaskMaster Pro — Docs Index

This is the readable entry point for the product. The frontend (`public/index.html` + `src/app.jsx`) and API (`openapi.yaml`) stay in sync with this index.

## What is built today (verified from source, not inferred)

- **Batch 1** (`7fa4aba`): 4 Devpost fields (`displayed_location`, `prizes_counts`, `time_left_to_submission`, `featured`), 2 MCP tools, 6 derived filters, `test-batch1.mjs` 5/5.
- **Batch 2** (`7fa4aba`): 3 MCP tools (`high_prize`, `near_me`, `closing_soon`), `locationMatches` (UK↔GB + word-boundary), dynamic params (`min_prize`, `location`, `days`, `featured_only`, `limit`).
- **Email**: 3 providers (`oracle` / `sendgrid` / `ses`), 23 tests pass (`test-email.mjs`); Yahoo IMAP/app-password set up (`yahoo.ts`, `mail.ts`); settings compare/revoke masked (`app.jsx` ~1685–1715, first 3 chars + `●●●*`, red Revoke button).
- **Settings**: deep-merge fix (`readSettings` / `settings.ts`); `IMAP_HOST`/`IMAP_PORT` visible; Yahoo fields (`provider`, `yahoo_client_id`, `yahoo_client_secret`, `yahoo_refresh_token`, `yahoo_mailbox_id`, `from_address`) missing from `/api/settings` — needs configuration.
- **Developer**: 9 debug/email routes (`/api/debug/*`), Settings tab fully wired (`test-routes` 245/245, `test` 36/36, `test:timezone` 42/42, `test:push` 11/11); `openapi.yaml` (20 routes); `docs/architecture.json`; `THREAT-MODEL.md` (S-1 to E-1 open; auth [S-1], [I-1] before public exposure).
- **Web push**: `src/push.ts` (hand-rolled, no `web-push` npm — `https` unavailable in Worker); 26 checks pass; Firefox refused interactive grant (needs user gesture, not synthetic); `user.js` pre-grant written but browser not restarted.
- **Inbox / capture**: 6 working feeds, 120 items; capture via `taskmaster-capture` (browser driver, not Worker); `catalogue.csv` / `.txt`, 51 duplicate groups.
- **Video thread**: 383 videos / 60.0 GB / 85.4 h; 14 dark/blank-frame candidates (#0063 #0065 #0088 #0090 #0157 #0192 #0197 #0198 #0211 #0227 #0302 #0312 #0324 #0356) need `gemini-3.1-flash-lite`; LogiCapture audio confirmation needed for `2024-05-14_19-49-58.mp4` (7.07 GB / 43.2 h); 1.67 GB cleanup approved; ~14 GB undecided (recommend keep).
- **Design**: 12 pt body, 1.5 lh, page breaks, clickable TOC, hyperlinks on non-obvious terms; `TaskMaster_Pro_Design_System_Handbook.pdf` (23 pp, 1,534,577 bytes); Storybook 11 stories / 11 pixel samples.
- **Handbook (API-embedding)**: Markdown only — no PDF exists yet (`C:\Users\Admin\...taskmaster-pro\docs/`).

## Where to look, by question

- **Journey broken?** `scripts/dev-server.mjs` (proxy, 8080) + `npm run dev` (8787). Root cause verified: `python -m http.server` (PID 6272) has no POST handler → `501 Unsupported method`. Fix confirmed.
- **Batch 2 fail?** `scripts/test-batch1.mjs` — `FAIL=1` (`"gb does not match mid-word"`). `src/mcp-tools.ts` line `locationMatches`.
- **Yahoo creds?** `.dev.vars` empty; `/api/settings` email section shows only `IMAP_HOST=SET`, `IMAP_PORT=993`. Token exists (no portal trip needed per decision log).
- **Auth before public?** `THREAT-MODEL.md` S-1 (Critical) — `api/debug/*` exposed. Add `auth/` middleware before hosting `openapi.yaml` via Redoc.
- **SDK / portal?** `openapi.yaml` (20 routes); SDK strategy = OpenAPI Generator first; self-host = `elestio` (`npm install -g elestio`, v1.4.0, `elestio` not `elestio-cli`); `elestio.io` DNS blocked from this machine (use GitHub release alternative).
- **Demo / landing?** See `public/landing.html` and `docs/LANDING.md`. Wire via `SEED_DEMO_DATA=true` (env) and `POST /api/demo/seed`.

## Latest build reference

- `main` / `open-core` = `7fa4aba` (verified: `open-core` reports "Everything up-to-date" with `7fa4aba`; `git log` confirms).
- `public/index.html` → loads `/assets/app.js` + `/assets/app.css` (built by `npm run build`).
- `docs/index.md` (this file) is the docs entry point.
