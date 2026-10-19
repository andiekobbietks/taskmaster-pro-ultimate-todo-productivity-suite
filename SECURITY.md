# Security Policy

> **The one thing you must know before putting this online: there are no user
> accounts.** Anyone who can find the web address can read, change or delete
> everything stored in it. Treat any live instance as public. The rest of this
> file is the detail behind that warning.

## Supported versions

This project is **Alpha**. Only the newest published release is supported — there
is no long-term-support branch and no back-porting of fixes.

| Version | Supported |
| ------- | --------- |
| 1.0.x | ✅ |
| < 1.0 (untagged `main`) | ⚠️ best-effort only |

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Use [GitHub Private Vulnerability Reporting](../../security/advisories/new):

1. Open the **Security** tab at the top of this repository.
2. Click **Report a vulnerability**.
3. Describe what you found, how to reproduce it, and what you think the impact is.

A maintainer is notified immediately when a private report is filed, and the
conversation stays private until a fix ships. Credit is given in the release
notes unless you ask to stay anonymous.

If private reporting is unavailable for your account, open a regular issue asking
for a secure channel **without** including any details of the vulnerability.

## Threat model (read this before deploying)

This is an honest description of the current surface, not a compliance claim.

- **There is no authentication.** Every route in the API is reachable by anyone
  who can reach the deployment. A deployed instance must be treated as
  **public and untrusted**. Do not put real personal data in it.
- **State lives inside a Durable Object's SQLite database.** There is no
  separate database server, so there are no database credentials to leak and no
  network-exposed DB port. The blast radius of a compromised Worker is the data
  of that one object.
- **The API trusts its callers.** Todo fields are stored as sent (after `.trim()`
  and JSON encoding of tags). Output-escaping in the front end is the only XSS
  boundary, so the front end must treat every stored string as hostile.
- **Dependencies are deliberately few.** The only runtime dependency is `hono`.
  A machine-readable inventory lives at [`docs/sbom.cyclonedx.json`](docs/sbom.cyclonedx.json).
- **Secrets:** none are required to run or deploy the app today. If that ever
  changes, this file must change with it.

## What a good report includes

- The affected route or file (e.g. `PATCH /api/todos/:id`).
- Reproduction steps that work against `npx wrangler dev`.
- The impact you expect (data disclosure, data loss, cross-user access, XSS).
- Whether you have already shared it anywhere.

## What happens next

Reports are triaged against the maturity gates in
[`docs/READINESS.md`](docs/READINESS.md). Anything that touches the
Enterprise-Ready security gates is treated as blocking. Fixes ship in the next
patch release via the [release workflow](.github/workflows/release.yml), and the
advisory is published with the release notes.
