# Threat Note — shared team deployment for Irene Vera Foundation

**Date:** 2026-10-19
**Scope:** `taskmaster-pro` deployed for IVF team use — shared todo list, per-person
login, team-wide visibility.
**Status:** design review before any code is written. No IVF data may be loaded until
the mitigations in §5 are in place.
**Author:** security-by-design-stride method (STRIDE, five steps)

---

## 1. Boundaries

| # | boundary | trusts |
|---|---|---|
| B1 | team member's browser ↔ Cloudflare Access | Access verifies identity before the Worker runs |
| B2 | Access ↔ Worker | Worker trusts `Cf-Access-Authenticated-User-Email` only if Access is the sole authz layer |
| B3 | Worker ↔ Durable Object (shared) | DO trusts the Worker completely; no verification inside the DO |
| B4 | DO ↔ SQLite at rest | Cloudflare encrypts; no in-app encryption today |
| B5 | Supabase dashboard ↔ team | anyone with dashboard access sees all identities |
| B6 | GitHub ↔ CI ↔ Cloudflare deploy | a leaked token deploys arbitrary code |
| B7 | *(future)* app ↔ LLM provider | prompts leave the trust boundary |

## 2. Assets

1. Grant pipeline — funders, amounts, deadlines, narrative
2. Governance actions — trustee decisions, AGM preparation
3. **The audit trail** — the evidence of who did what
4. Team identities — five or six named email addresses
5. `CLOUDFLARE_API_TOKEN`, Supabase JWT secret
6. The repository and its history
7. *(if ever added)* legal correspondence

## 3. STRIDE per boundary

### Spoofing

- **Two identity layers is a design smell.** Stacking Cloudflare Access and
  Supabase Auth creates two session systems. If they disagree about who a user is,
  there is no defined winner and the failure is discovered in production.
  → **Decision: pick one.** See §5, D1.
- **Supabase accounts can change their email.** Attribution read from a mutable
  profile field is not evidence. The verified address must come from the token
  assertion, never from a user-editable column.
- Access binds identity to an email the team member already controls, which is a
  materially stronger claim than a self-registered password.

### Tampering

- **The DO is shared and single-threaded. There is no per-row authorisation.**
  Any authenticated member can `PATCH` any todo. `assigned_to` is therefore
  *advisory, not enforced*. That is an acceptable reading of "shared with
  visibility", but it must be stated in the README or it will be discovered as a
  bug.
- **Client-supplied audit fields must be stripped server-side.** If `PATCH
  /api/todos/:id` accepts `completed_by` from the request body, attribution can be
  forged with one curl. This is easy to miss and it silently invalidates the
  audit trail.
- `assigned_to` must be validated against the set of known team emails, or any
  string can be assigned and the team view fills with garbage.

### Repudiation

- **This is the whole point of the feature.** "Who did what" must be an artefact,
  not a claim.
- **The audit table must be append-only.** If the app exposes any `UPDATE` or
  `DELETE` on audit rows, an authenticated insider can erase their own trail, and
  the audit trail is worse than useless — it is misleading evidence.
- Cloudflare Access produces its own access logs. Keeping both means edge-level
  authentication events survive even if the application audit is tampered with.

### Information Disclosure

- **UK GDPR applies.** Team members are in Wales; task titles can carry personal
  data. Minimal collection, no unnecessary fields, and a retention decision for
  completed tasks.
- **The future-LLM boundary is the real one (B7).** If agent features are added
  later, grant data enters prompts, and prompts are logged by inference
  providers. A charity's funding pipeline in a third-party log is a data-residency
  problem, not a technicality. **Design rule: no grant or personal data in prompts.**
- The Supabase anon key is public by design and ships in the frontend. This is
  safe *only* because authorisation happens in the Worker and no IVF data lives in
  Postgres. Keep it that way — moving data to Supabase without RLS would invert
  this.
- `SEED_DEMO_DATA` must be `false` in production (`wrangler.json` already sets it).

### Denial of Service

- **One shared DO is one single point of failure.** A slow query stalls every team
  member simultaneously. There is no second instance to fall back to.
- The current query is `SELECT * FROM todos WHERE 1=1` with **no `LIMIT`**
  (`FEAT-031`). With `json_each(tags)` now evaluated per request, cost grows with
  pipeline size. At five users this is theoretical; at grant-deadline time it is not.
- Free-tier Workers allowance (100k requests/day) is not a constraint for a
  five-person team.

### Elevation of Privilege

- **There are no roles.** Every authenticated member is fully privileged. Femi is a
  Project Manager and has no additional authority — and equally, cannot be granted
  any without a schema change.
- `SUPABASE_JWT_SECRET` and `CLOUDFLARE_API_TOKEN` must never appear in frontend
  code, `.dev.vars`, or a CI log line.
- Least privilege on the Worker: the DO binding is the only capability it needs.

## 4. Outstanding unknowns

- Whether Supabase's domain restriction is configured and whether it covers email
  *changes* as well as signups. Must be verified before relying on it.
- Whether Cloudflare Access is free at the intended user count on the chosen plan.
- UK GDPR retention period for completed tasks — a decision, not a fact to look up.

## 5. Decisions

**D1 — One identity layer. Cloudflare Access only, initially.**
Access already returns a verified email at the edge, costs nothing for this team,
and requires no code and no JWT secret to protect. Supabase would add a vendor,
a secret, and a second session system in exchange for in-app account management
IVF has not asked for. *Reconsider only when a specific Access limitation is hit,
not before.*

**D2 — Audit rows are append-only.** No `UPDATE`, no `DELETE`, no route that
reaches them for modification. Enforced by absence of code, not by a flag.

**D3 — Audit fields are server-derived, never client-supplied.** The Worker reads
the verified email and writes it. Request-body values for `created_by`,
`updated_by`, `completed_by` are ignored.

**D4 — `assigned_to` validated against the team email allowlist.**

**D5 — Add `LIMIT` and an index to the todos query before real data is loaded.**

**D6 — Load no IVF data until D1–D5 are shipped.** Demo with the existing chaos
fixtures only.

**D7 — If agent features are added later, no grant or personal data in prompts.**

---

## Not yet a product

This note covers a *shared internal tool*. It is not a compliance posture. For
`G-COMP-01` the charity would still need a DPAs, a sub-processor list, and a
documented retention policy — none of which this application can supply.