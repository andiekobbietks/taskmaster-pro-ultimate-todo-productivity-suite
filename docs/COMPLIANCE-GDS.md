# GDS API standards and TCoP compliance assessment — TaskMaster Pro

**Scope:** assess the current codebase (post-`35da513`, release `1.5.0` work) against
[GOV.UK API technical and data standards](https://www.gov.uk/guidance/gds-api-technical-and-data-standards)
and the [Technology Code of Practice](https://www.gov.uk/guidance/the-technology-code-of-practice),
both read in full on 2026-11-05.

**Question asked:** "Does this entirely meet all of this?"

**Short answer:** Not entirely. The 2026-11-05 compliance pass closed every
blocker the project's own threat model identified (authentication, audit trail,
secret encryption, CORS, cache headers, URI versioning, OpenAPI accuracy,
capture URL validation and self-hosted fonts). Several criteria are only
meaningful for a UK government service and are marked *government-only* below.
What remains is polish that a personal open-source project would not normally
need: a formal API sandbox, an OAuth 2.0 authorization server, resource-level
scopes, a domain strategy, and formal accessibility/energy audits.

---

## 1. What was checked

| Evidence | Source |
|---|---|
| Code and routing | `src/index.ts` |
| Security headers, auth, CORS, rate limit, versioning | `src/index.ts` lines 38–152 |
| Settings / secrets handling and audit | `src/settings.ts`, `src/settings-crypto.ts`, `src/audit.ts` |
| Mail ingestion and Yahoo API | `src/mail.ts`, `src/yahoo.ts`, `src/email.ts` |
| Capture URL validation | `src/capture.ts`, `scripts/capture-wacz.py` |
| OpenAPI document | `openapi.yaml` / `public/openapi.yaml` |
| Frontend / PWA / fonts | `public/index.html`, `public/storybook.html`, `public/fonts/`, `src/tailwind.css` |
| Security statement | `README.md` lines 130–148 |
| Dependency list | `package.json`, `docs/sbom.cyclonedx.json` |
| Threat model | `docs/THREAT-MODEL.md` §3–§6 |
| Roadmap | `docs/ROADMAP.md` M4 |
| Test suites | `npm test`, `npm run test:routes`, `npm run test:push`, `npm run test:timezone` |

---

## 2. Applicability disclaimer

Both documents are government guidance. The API standards are "for people
building APIs in government". TCoP is mandatory for government procurement and
"the agreed standard for cross-government projects". Neither document states it
binds a personal, private, open-source project. This assessment applies the
criteria technically anyway, but flags where a criterion is only meaningful in
a government context.

---

## 3. GDS API technical and data standards

### 3.1 Design your API

| # | Criterion | Verdict | Evidence / gap |
|---|---|---|---|
| D1 | Gather user needs | Partly met | `docs/ROADMAP.md` describes a single-user journey, but there is no documented user research, personas or Service Standard-style discovery. |
| D2 | Check for existing APIs / API Catalogue | Not met — government-only | Not registered on `api.gov.uk` or the UK API Catalogue; irrelevant for a personal project. |
| D3 | API-first design | Partly met | The HTTP API is the real interface, but the OpenAPI spec is maintained from code rather than written first (`openapi.yaml` is generated from the route inventory). |
| D4 | Follow TCoP and Data Standards Catalogue | In progress | This assessment is the first structured check. |
| D5 | Use ISO 8601 for dates | Partly met | `hackathons.start_date` etc. are stored as `TEXT YYYY-MM-DD`. Timestamps are Unix epoch integers, not ISO 8601. `GET /api/calendar.ics` emits RFC 5545. |
| D6 | Use GeoJSON for location | Not applicable | No geospatial API surface. |
| D7 | UK GDPR / privacy by design | Partly met | Mail is filtered to hackathon-only before ingest (`src/mail.ts`). No cloud upload of recordings. No privacy policy or DPIA. |
| D8 | REST style | Met | Stateless HTTP via Hono; resource-oriented routes. `Cache-Control: no-store, no-cache, must-revalidate, private` is set on every `/api/` response. |
| D9 | OpenAPI 3 spec before code | Partly met | `openapi.yaml` and `public/openapi.yaml` are now 3.0.3, cover the real route inventory, declare global bearer and query-token security, and are byte-identical. They are still derived from code, not written ahead of it. |
| D10 | Secure by design / OWASP API Top 10 | Mostly met | Bearer-token auth, structured audit logging, AES-256-GCM settings encryption, input validation on capture URLs, CORS, cache headers, rate limiting and gated debug routes are all in place. No resource-level scopes and no formal threat-model review against the OWASP API Top 10. |
| D11 | Test assumptions with stubs and iterate | Partly met | `npm test` (36), `npm run test:routes` (270), `npm run test:push` (26) and `npm run test:timezone` (42) all pass. No formal API sandbox. |

### 3.2 Build your API

| # | Criterion | Verdict | Evidence / gap |
|---|---|---|---|
| B1 | UTF-8 encoding | Met | `public/index.html` declares `<meta charset="UTF-8">`; JSON responses are UTF-8. |
| B2 | JSON responses | Met | All `/api/*` routes return JSON except the ICS feed and static assets. |
| B3 | Consistent resource names | Partly met | Resource routes are consistent (`/api/todos`, `/api/hackathons`); debug and diagnostics routes are namespaced under `/api/debug/*`, `/api/diagnostics*` and `/api/checkpoints*`. |
| B4 | Persistent resource names | Met | IDs are stable (UUIDs, integer keys, prefixed inbox ids). |
| B5 | Standard HTTP status codes | Partly met | 200, 201, 400, 404, 429, 500 used. Some failures return 500 with raw error strings. |
| B6 | Host per API domain guidance | Not checked | Single Cloudflare Workers host; no evidence reviewed for `api.example.gov.uk` style. |
| B7 | Make all users authenticate | Mostly met | `/api/*` requires a bearer token when `API_TOKEN` is configured; exempts `/health` and internal cron routes. The gate stays open when `API_TOKEN` is unset so local development still works. |
| B8 | Avoid API keys / use OAuth 2.0 | Not met | The auth mechanism is a shared API token, not OAuth 2.0. For a single-operator deployment this is deliberate; a multi-user service would need an authorization server. |
| B9 | Resource-level scopes checked per request | Not met | The token gates the whole dataset, not per-user or per-resource scopes. |
| B10 | TLS 1.2+ | Met in production | Cloudflare's edge terminates TLS. Local dev defaults to plain HTTP. |
| B11 | Validate all inputs / enforce schema | Partly met | Capture sources and settings values are validated; `zod` is used for MCP tool definitions but not as a universal request-body validator across every API route. |
| B12 | CORS | Met | `/api/*` echoes the request `Origin`, declares allowed methods and headers, answers `OPTIONS` with 204, and sets `Access-Control-Max-Age: 86400`. |
| B13 | Disable unused HTTP verbs / remove test endpoints | Met | `/api/debug/*` is gated by `DEBUG_ROUTES_ENABLED=true` and is off by default; `/api/demo/seed` is not present. |
| B14 | Enforce content type | Partly met | Capture WACZ route expects `application/octet-stream`; most JSON routes rely on Hono defaults. |
| B15 | Cacheability | Met for dynamic API | Every `/api/` response carries `Cache-Control: no-store, no-cache, must-revalidate, private`. Static assets are served by Cloudflare's asset layer with its own caching. |
| B16 | Rate limiting | Partly met | 100 req/min per IP with `cf-connecting-ip` fallback; exempts diagnostics/checkpoint routes and skips for `unknown` IP. |
| B17 | Provide a sandbox | Not met | No separate sandbox environment or test API. |
| B18 | Test compliance and register in API catalogue | Not met — government-only | Not registered; not applicable to a personal project. |
| B19 | Document how to use the API | Partly met | `openapi.yaml`, `README.md` and this assessment exist; interactive documentation is not hosted. |

### 3.3 Operate your API

| # | Criterion | Verdict | Evidence / gap |
|---|---|---|---|
| O1 | Version via URI (`/v1`) | Met | `/api/v1/*` is aliased to `/api/*`; clients can pin to v1. Unversioned paths remain stable during the 1.x lifetime. |
| O2 | Avoid header/media-type versioning | N/A | No versioning in use beyond the URI alias. |
| O3 | Retire versions with notice | N/A | No versions to retire. |
| O4 | Use an API gateway / management system | Not met | Direct Cloudflare Worker → Durable Object; no gateway for access control, audit or network management. |
| O5 | Log when personal/sensitive data is provided and to whom | Met | `audit_log` records settings, profile and credential changes (field names only, never values) with actor and IP. `src/audit.ts` writes; `GET /api/audit/log` reads. |
| O6 | Monitor for unusual activity | Partly met | Rate-limit counters per IP, diagnostics logging and upstream drift detection exist, but no alerting or anomaly detection. |

---

## 4. Technology Code of Practice

| # | Point | Verdict | Evidence / gap |
|---|---|---|---|
| 1 | Define user needs | Partly met | Roadmap frames a single-user journey; no formal research. |
| 2 | Make things accessible and inclusive | Partly met | `lang="en"`, viewport meta, font-fallback, responsive UI. No WCAG audit, no accessibility statement. |
| 3 | Be open and use open source | Met | MIT licence, public GitHub repo, runtime deps are all open source. |
| 4 | Make use of open standards | Mostly met | RSS, iCalendar, WACZ, MCP, OAuth 2.0 (client), OpenAPI, JSON, REST. Dates are `YYYY-MM-DD` but timestamps remain Unix epoch. |
| 5 | Use cloud first | Met | Cloudflare Workers / Durable Objects. |
| 6 | Make things secure | Mostly met | Bearer-token auth, audit trail, AES-256-GCM encryption for secrets, gated debug routes, CORS, cache headers, rate limiting and capture URL validation. No OAuth 2.0 server and no per-user authorization. |
| 7 | Make privacy integral | Partly met | Hackathon-only mail filter, no cloud upload of recordings, minimal data collection, encrypted settings. No privacy policy or DPIA. |
| 8 | Share, reuse and collaborate | Partly met | Open source; no published contribution guide or reusable package. |
| 9 | Integrate and adapt technology | Met | MLH/Devpost importers, Yahoo Mail API integration, calendar push (Graph/CalDAV), email providers, MCP server, WACZ capture. |
| 10 | Make better use of data | Partly met | Eligibility engine, calendar feed, dossier output, digest scoring. |
| 11 | Define your purchasing strategy | Not applicable | Personal project with no procurement. |
| 12 | Make your technology sustainable | Not checked | No energy/carbon assessment reviewed. |
| 13 | Meet the Service Standard | Not applicable | Only required for government services going through assessment. |

---

## 5. Government-only criteria (not binding on this project)

These apply only if the API were operated as a UK government service:

- Registration in the UK API Catalogue (`api.gov.uk`).
- TCoP point 11 (purchasing strategy) and point 13 (Service Standard assessment).
- Formal API assurance / Service Standard alpha/beta/live assessment.
- GovS 005 and other government-specific security assurances.

---

## 6. Needs review — low-confidence verdicts

These are borderline or depend on evidence not inspected:

| Item | Why it needs review |
|---|---|
| B6 host/domain naming | No domain strategy document was checked. |
| B10 TLS locally | Local dev uses plain HTTP by default; production uses Cloudflare TLS. Verdict assumes production. |
| TCoP 12 sustainability | No energy or carbon data was reviewed. |
| TCoP 2 accessibility | No automated accessibility scan (axe, Lighthouse) or manual WCAG check was run. |
| D1 user needs | The roadmap is a journey, not user-research evidence. |
| B8 OAuth 2.0 | The API token is appropriate for a single-operator project; a government service would need OAuth 2.0 or equivalent. |

---

## 7. What was built to close the gaps

The items below were the active remediation list in `docs/THREAT-MODEL.md` §6 and
`docs/ROADMAP.md` M4. All of them were implemented in the 1.5.0 compliance pass.

1. **Authentication on `/api/*`** — `apiTokenAuth(env)` in `src/index.ts:38–53`, mounted at `src/index.ts:141`. Exempts `/health` and cron-internal routes (`/api/inbox/fetch`, `/api/digest/send`, `/api/trash/purge`). The gate stays open only when `API_TOKEN` is unset.
2. **Audit trail** — `audit_log` table plus `src/audit.ts` (`writeAuditLog`, `readAuditLog`). Writes on settings/profile/credential changes and reset; reads via `GET /api/audit/log?limit=`. Actor from `X-Audit-Actor`, IP from `cf-connecting-ip` / `X-Forwarded-For`. Sensitive-field changes record field names only.
3. **URL validation in `scripts/capture-wacz.py` and `src/capture.ts`** — rejects non-HTTP(S) schemes and private/loopback/link-local/multicast/reserved addresses before any job is created.
4. **Move deployment secrets to Workers Secrets** — Yahoo config is resolved from `env` using the `src/email.ts` `pick()` rule; `fetchFromYahoo` takes a resolved `YahooConfig`.
5. **Replace XOR obfuscation with Web Crypto** — `src/settings-crypto.ts` provides AES-256-GCM encryption with PBKDF2(SHA-256, 100000 iterations) from `SETTINGS_ENCRYPTION_KEY`, `enc:v1:` prefix. Legacy XOR retained as `legacyDeobfuscate` for backwards compatibility only.
6. **Remove or protect debug routes** — `/api/debug/*`, `/api/diagnostics*` and `/api/checkpoints*` are wrapped in `if (env?.DEBUG_ROUTES_ENABLED === "true")`; the UI widget is hidden unless an Advanced settings toggle enables it.
7. **API versioning** — `/api/v1/*` URI alias forwards to `/api/*` so clients can pin to v1.
8. **CORS and cache headers** — CORS middleware on `/api/*` and `Cache-Control: no-store, no-cache, must-revalidate, private` on every `/api/` response.
9. **Complete the OpenAPI spec** — both `openapi.yaml` files rewritten from the real route inventory (3.0.3, version 1.5.0, global bearer/query-token auth, `/health` and `/push/key` public) and kept byte-identical.
10. **Self-host Google Fonts** — six woff2 files in `public/fonts/`, Google Fonts preconnect/stylesheet removed from `public/index.html` and `public/storybook.html`, `@font-face` rules added to `src/tailwind.css`, CSP tightened to `font-src 'self'`.
11. **Hackathon importers** — `scripts/sync-hackathons.mjs` calls the real import routes (`/api/devpost/import`, `/api/mlh/import`) instead of reimplementing scrapers; HackerEarth returns HTTP 501 because a keyless importer is infeasible.
12. **Upstream drift detection** — `src/devpost.ts` detects unexpected schema drift after ingestion and writes a `UPSTREAM_SCHEMA_DRIFT` diagnostic; the MCP tool `inspect_schema_drift` exposes the result without touching the zod schema.
13. **Test coverage** — suites grew from 0 to 374 checks covering the DO, routes, push/VAPID and timezone parsing.

Remaining items that are deliberately not implemented:

- **OAuth 2.0 authorization server** (B8) — out of scope for a single-operator project.
- **Resource-level scopes / per-user partitions** (B9) — the token gate protects a private deployment, not a multi-user service.
- **Formal API sandbox** (B17) — no separate test environment.
- **Domain strategy document** (B6) — not reviewed.
- **Accessibility / energy audits** (TCoP 2, TCoP 12) — not run.

---

## 8. Verdict

TaskMaster Pro v1.5.0 is a hardened personal open-source project. It is **not
fully compliant** with the GDS API technical and data standards or the Technology
Code of Practice in the sense that a UK government service assessment would
still require government-only registration, procurement documentation, and
formal assurance. However, the compliance pass closed every blocker the
project's own threat model identified: authentication, audit logging, secret
encryption, CORS, cache headers, URI versioning, OpenAPI accuracy, capture URL
validation and self-hosted fonts.

The project scores well on openness, cloud-first design, test coverage,
deliberate privacy controls and now has a defensible security baseline for a
single-operator deployment. It remains single-tenant and should not be exposed
as a multi-user service without adding OAuth 2.0 or equivalent per-user
authorization.
