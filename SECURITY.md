# Security Policy

## Project maturity and supported versions

TaskMaster Pro is currently **Beta**. This is a single-tenant reference application, not a multi-user SaaS security boundary. The latest `main` branch is the development line; published releases should be treated as supported only when their release notes explicitly say so. Security fixes are made on the current development line and included in the next release.

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Use [GitHub Private Vulnerability Reporting](../../security/advisories/new):

1. Open the **Security** tab at the top of this repository.
2. Click **Report a vulnerability**.
3. Describe what you found, how to reproduce it, and what you think the impact is.

If private reporting is unavailable, open a regular issue asking for a secure channel **without** including vulnerability details.

## Deployment security requirements

- Configure strong, unique `API_TOKEN` and `SETTINGS_ENCRYPTION_KEY` secrets before exposing a deployment: `npx wrangler secret put API_TOKEN` and `npx wrangler secret put SETTINGS_ENCRYPTION_KEY`.
- The token is a shared-secret access gate, not per-user identity, role-based access control, or tenant isolation. Browser sessions inherit the same shared permissions.
- Do not deploy without both secrets. `wrangler.json` marks deployed Workers as `APP_ENV=production`; if either `API_TOKEN` or `SETTINGS_ENCRYPTION_KEY` is missing, API requests fail closed with HTTP 503. Local development opts into `APP_ENV=development` in `.dev.vars`.
- The public `GET /health` endpoint exposes only service health and version metadata. `/api/auth/login` exchanges the shared access key for a 12-hour signed `HttpOnly; SameSite=Strict` cookie; `/api/auth/logout` clears it. Browser code never stores the shared key. The cookie is Secure on HTTPS and same-site requests only.
- Scheduled inbox fetch, digest send and trash purge operations require the same bearer token as other API routes. The Worker cron handler supplies it when invoking the Durable Object internally.
- Prefer the `Authorization: Bearer` header. The documented `api_token` query parameter is retained for compatibility but can expose credentials in URLs, browser history, analytics and logs.
- CORS currently reflects the request Origin. This is not an authentication mechanism; keep the API token secret and do not treat CORS as an access-control boundary.
- This deployment uses one Durable Object/database named `taskmaster`. It is not a multi-tenant isolation model. Do not store sensitive personal, health, financial or confidential data without a separate security review and appropriate controls.
- Keep secrets in Worker secrets, never in `wrangler.json`, source files or committed `.dev.vars`.

## Current threat model and known limitations

- **Authentication:** a configured shared bearer token protects `/api/*`; it does not identify individual users or provide fine-grained permissions.
- **Data isolation:** all callers with the token reach the same Durable Object state. There is no per-user or per-organisation row-level isolation.
- **Browser input:** treat stored task, hackathon, mail and attachment metadata as untrusted. Validate at API boundaries and render user-controlled content safely.
- **Backups and recovery:** checkpoints are application-level snapshots, not an independent backup or tested disaster-recovery service. Export and test recovery separately before production use.
- **Dependencies:** review dependency and Worker runtime updates regularly. The generated SBOM is an inventory, not proof that dependencies are vulnerability-free.

## What a good report includes

- The affected route or file.
- Reproduction steps against a local Worker or a disposable test deployment.
- Expected impact (data disclosure, data loss, cross-user access, injection or denial of service).
- Whether the issue has already been shared publicly.

Security findings are triaged against [the readiness checklist](docs/READINESS.md). Any issue that permits unauthenticated data access or destructive operations is release-blocking.
