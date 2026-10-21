# Threat model — TaskMaster Pro

A STRIDE walk of the application, written 2026-10-21 against commit
`3230baf`. It is a statement of what the code does now, not of what it
should do. The gaps are named as gaps.

The method is Microsoft's STRIDE: **S**poofing, **T**ampering, **R**epudiation,
**I**nformation disclosure, **D**enial of service, **E**levation of privilege.
Each one is asked of each boundary, and each one gets an answer.

Every claim here was checked against the source. Where a control is absent
it says so.

---

## 1. The boundaries

| # | Boundary | What crosses it |
|---|---|---|
| B1 | Browser ↔ Worker | Every `/api/*` request. The Worker is the only thing that can reach the Durable Object. |
| B2 | Worker ↔ Durable Object | All state. One object, one thread, one SQLite file. |
| B3 | Worker ↔ Yahoo | OAuth token exchange, then the mail API. Carries the refresh token. |
| B4 | Worker ↔ Internet Archive | The Wayback CDX API and the snapshot fetch. Read-only. |
| B5 | Capture runner ↔ any site | Playwright drives a browser to whatever URL it is given. Runs on the user's machine, not in the Worker. |
| B6 | Capture runner ↔ Worker | The WACZ archive is posted back, and the manifest is read from the app. |
| B7 | Mail body ↔ browser | The stored message text, rendered in the inbox. |

## 2. The assets

| Asset | Where it lives | Value |
|---|---|---|
| The Yahoo refresh token | `settings` table, XOR-obfuscated | Full read of the mailbox |
| The IMAP and JMAP passwords | `settings` table, XOR-obfuscated | Full read of the mailbox |
| The storage credentials (S3 keys, Azure SAS) | `settings` table, XOR-obfuscated | Write access to the bucket |
| The profile (citizenship, age, residency) | `hackathon_profile` table | Decides which competitions you may enter |
| The competitions, the inbox, the attachments | The Durable Object's SQLite | The user's actual work |
| The capture archives | `captures/` on disk | The evidence behind a competition |
| The Durable Object itself | One instance, one thread | Every request the app serves |

---

## 3. STRIDE, per boundary

### B1 — Browser ↔ Worker

**Spoofing — fails.** There is no authentication. `src/index.ts` has a
security-headers middleware and a rate limiter, and nothing else. Anyone
who can reach the Worker is the owner of the data. The only endpoint
called out as unauthenticated is `/health`, and it is not the only one.

*Mitigation: none. This is the gap that gates everything else.*

**Tampering — fails, same cause.** `PUT /api/settings` accepts a new
profile, a new mail server and new storage credentials from anyone.
`POST /api/capture/jobs` and `DELETE /api/hackathons/:id` likewise.

**Repudiation — fails.** There is no audit trail. `src/index.ts`,
`src/settings.ts`, `src/capture.ts` and `src/archive.ts` contain no
activity log, no actor, no timestamped history of who changed what. A
change to the profile or the storage credentials leaves no trace.

**Information disclosure — partly fixed, and still open.** A secret is
now write-only: `GET /api/settings` returns `********` for a set value
rather than the value, and the screen only sends a new one when it is
typed. That was fixed on 2026-10-21 after the assessment found the
secrets coming back in the clear. But the endpoint is still
unauthenticated, so anyone can *set* a secret, and the XOR obfuscation is
not encryption — the key is in the source.

**Denial of service — partly bounded.** The rate limiter allows 100
requests a minute per IP, counted in the `rate_limits` table. The upload
size and the decompressed size were unbounded; both are now capped
(32 MB in, 64 MB inflated, 16 MB per record). The Durable Object is
single-threaded, so one slow request stalls every request.

**Elevation of privilege — fails.** There is no privilege to elevate
from, which is the same finding as Spoofing. There is no per-user data
model, so one person and the public share one database.

### B2 — Worker ↔ Durable Object

**Spoofing — holds.** The Durable Object is reached only through the
Worker's `fetch`, and the object name is fixed (`idFromName("taskmaster")`).
There is exactly one instance, so there is nothing to spoof.

**Tampering — holds.** The Worker is the only writer. The Durable Object
class is not exposed to the internet.

**Repudiation — fails.** Same as B1: no record of what was changed.

**Information disclosure — holds, given B1 is fixed.** The state is in
the object, and the object is behind the Worker. Once the Worker requires
a token, the data is as private as the token.

**Denial of service — partly bounded.** The rate limiter is per IP and
per object, so a single attacker can exhaust the shared 100/minute
bucket for everyone behind the same address. A Durable Object is
single-threaded; there is no second object to spread the load.

**Elevation of privilege — holds.** No route escalates another.

### B3 — Worker ↔ Yahoo

**Spoofing — holds.** The token is the Yahoo one, and it is verified by
Yahoo. The refresh token exchange uses HTTP Basic with the client id and
secret, over TLS.

**Tampering — holds.** The responses are signed by TLS; the app does not
modify them.

**Repudiation — holds, in the sense that Yahoo keeps the mail log.**

**Information disclosure — the one to watch.** The refresh token crosses
the boundary on every fetch, because a new access token is bought each
time. It is held in the `settings` table under XOR, which is obfuscation
and not protection. The token is never written to a log, and the API does
not hand it back, but the storage is the weak point.

**Denial of service — partly bounded.** One failed token exchange fails
the whole fetch, and the error is reported rather than swallowed. There is
no retry, so a transient Yahoo outage means no mail.

**Elevation of privilege — holds.** The Yahoo app is scoped to
`mail-r` by the permission that was requested. A token with more scope
would be the person's own choice, not the app's doing.

### B4 — Worker ↔ Internet Archive

**Spoofing — holds.** The CDX API is public and read-only.

**Tampering — holds.** The snapshot is fetched and read; nothing is
written back.

**Repudiation — holds.**

**Information disclosure — holds.** Only the URLs that were asked for
are sent.

**Denial of service — partly bounded.** The archive fetch has no timeout
in the route, and a slow Internet Archive response holds the Durable
Object's thread.

**Elevation of privilege — holds.**

### B5 — Capture runner ↔ any site

**Spoofing — not applicable.** The runner authenticates to nothing.

**Tampering — not applicable.**

**Repudiation — fails.** The capture leaves the app's records only when
the archive is posted. A capture that was taken and not posted is
invisible.

**Information disclosure — the real one.** The runner drives a browser
to whatever URL it is given, with the person's cookies, on the person's
machine. It records the responses it sees, and it writes them to disk.
`scripts/capture-wacz.py` does **not** validate the URL: there is no
scheme check, and no check against internal addresses. Pointed at
`http://192.168.1.1/` it would capture the router's admin page, and the
archive would be written to `captures/`. The default is same-origin only,
which bounds what a *page* pulls in, but it does not bound what the
*runner* is pointed at.

**Denial of service — partly bounded.** A page that never settles is
capped by the navigation timeout and the settle time.

**Elevation of privilege — the one to watch.** A captured page is
untrusted content that the agent will read. It is the prompt-injection
vector: a competition page could contain text that tries to make the
agent do something else. The archive is the input to a tool, so it is
worth treating its contents as data and never as instructions.

### B6 — Capture runner ↔ Worker

**Spoofing — fails, same as B1.** The runner posts to the Worker with
no token, and it reads the manifest with no token.

**Tampering — the manifest is the app's, but anyone can change it**,
because B1 fails.

**Repudiation — partly holds.** The capture job carries a job id, and the
app records the status, the size and what was extracted. There is a
trail of *what was captured*, but not of *who captured it*.

**Information disclosure — holds.** The archive is the runner's own
capture, posted back to the app that asked for it.

**Denial of service — partly bounded.** The capture route is inside the
100/minute limit.

**Elevation of privilege — fails, same as B1.**

### B7 — Mail body ↔ browser

**Spoofing — not applicable.**

**Tampering — not applicable.**

**Repudiation — not applicable.**

**Information disclosure — holds.** The body is rendered inside a
`<pre>` as text. There is no `dangerouslySetInnerHTML` anywhere in
`src/components/InboxPrimitives.jsx`, so a mail body cannot execute. The
HTML part is stored but is not rendered.

**Denial of service — holds.** A body is truncated to 500 characters
before it is stored.

**Elevation of privilege — holds.**

---

## 4. What the verdict is

| | Finding | Severity |
|---|---|---|
| 1 | **No authentication on any `/api/*` route.** Anyone with the URL has full read and write, including the storage credentials. | **Critical** |
| 2 | **No audit trail.** Nothing records who changed the profile, the mail server or the credentials. | **High** |
| 3 | **The capture runner does not validate the URL it is given.** It will drive a browser to an internal address and write what it sees to disk. | **High** |
| 4 | **Secrets are XOR-obfuscated, not encrypted.** The key is in the source. | **Medium**, and it is a placeholder, not a design |
| 5 | **The Durable Object is a single thread.** One slow request, one large capture or one hung archive fetch stalls everything. | **Medium** |
| 6 | **Captured pages and mail are untrusted input to an agent.** That is a prompt-injection path. | **Medium**, and inherent |
| 7 | **The rate limit is per IP, in one shared object.** One attacker spends everyone's budget. | **Low** for personal use |

Findings 3 and the size caps in section 3 were **fixed on 2026-10-21**, during
this assessment. Findings 1, 2, 4, 5, 6 and 7 are open.

## 5. About Vault and Supabase

Neither is implemented, and neither is the right answer for this app.

**HashiCorp Vault.** A vault is for a fleet of services that need to
fetch secrets at runtime, with leasing, rotation and revocation. This is
one application with one Durable Object and one person behind it. The
right-sized answer is **Cloudflare Workers Secrets** — `wrangler secret put`
for the client id, the secret and the refresh token, read from `env` rather
than from a database. That is a deployment-time control, it never touches
the SQLite file, and it is already the platform's job. It does not cover
the per-user storage credentials, which are inherently per-user and
belong in the database — and those need real encryption at rest, not
obfuscation, which on a Durable Object means the Web Crypto API with a key
held in a Worker secret.

**Supabase.** Supabase is a hosted Postgres with auth, storage and
realtime. Adopting it would mean moving the whole data layer off the
Durable Object. The reasons not to: the Durable Object is what makes the
app a single self-contained deployment with no database to administer and
no vendor relationship, which is the product's stated premise; and the
authentication problem — the one thing that is actually critical — is
solved by a token on the existing routes, not by a new datastore.

So the answer to "is the vault implemented properly" is: **no, and there
should not be one.** The three things that should exist instead are:
Workers Secrets for the deployment secrets, Web Crypto for the per-user
credentials at rest, and a token on the routes. The first is an hour's
work, the second is half a day, the third is the critical finding above.

## 6. What to do, in order

1. **Put a token on the routes.** One shared secret, checked before the
   routes run, would take finding 1 from critical to acceptable for a
   self-hosted personal deployment. Per-user identity is the upgrade after
   that.
2. **Validate the URL in the capture runner.** Reject anything that is
   not `http` or `https`, and warn about private address ranges. Half a
   dozen lines, and it closes finding 3 properly.
3. **Move the deployment secrets to Workers Secrets.** `wrangler secret put`
   for the Yahoo client id, the client secret and the refresh token.
4. **Encrypt the per-user credentials with Web Crypto**, with the key in a
   Worker secret.
5. **Write the audit trail** when there is more than one person using it.
   Until then it is a single-user app and the trail has one author, which
   is the easier case to fix later.
