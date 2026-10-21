# Yahoo, what is actually there

Checked 2026-10-21 against the live portal, in a browser, and against the
endpoints themselves. Everything below was observed, not recalled.

## The answer to "can I turn a hackathon site into a feed.rss using Yahoo's site?"

**No.** The service that did that — Yahoo Pipes, backed by YQL — is gone.

| Host | Result |
|---|---|
| `pipes.yahoo.com` | does not resolve |
| `query.yahooapis.com` | does not resolve |
| `yql.yahooapis.com` | does not resolve |
| `apps.yahoo.com` | does not resolve |
| `developer.yahoo.com/yql/` | HTTP 200, but a 493-character empty shell |

`developer.yahoo.com/api/` — the catalogue — now lists exactly two
things:

1. **Yahoo Fantasy Sports API** — fantasy football, baseball, basketball
   and hockey data.
2. **Sign In With Yahoo** — OAuth sign-in.

The last blog updates on the portal are from **March 2023**.

## The mail API is not supported, and the scope is not self-serve

This matters, because the app's Yahoo integration is built on it.

From `senders.yahooinc.com/developer/developer-access/`:

> "**While we no longer support proprietary Mail API's** we are happy to
> provide access through standard interfaces such as **IMAP, CardDav, and
> CalDav with Oauth2 support**, subject to our policies including the
> restrictions in this document."

> "To protect the security and privacy of our users, **those scopes are not
> available for self-served setup in the developer console.** Instead,
> third parties providing applications or services which require access to
> our consumers' data on their behalf **have to apply for access** and
> provide evidence that they are honoring our policies and guidelines."

> "Developers can request **commercial access** to IMAP, CalDav, and CardDav
> by filling out this form. Developers can also reach out to
> **mail-api@yahooinc.com** for any questions."

### What that means for the app

- `apis.mail.yahoo.com/ws/v3` **still answers** — it returned 401 without a
  token, which is how the path was confirmed. An app that already holds an
  approved token keeps working. It is unsupported, though, and new scopes
  are not self-serve.
- The **supported** path is **IMAP with OAuth2**, and getting the OAuth mail
  scope needs an application, a policy review, and a description of how the
  data is handled.
- The scopes Yahoo's own IMAP uses are `AUTH=OAUTHBEARER` with SASL, so an
  IMAP client in the Worker needs a raw TCP socket — `cloudflare:sockets` —
  and a `Reader`/`Writer` pair.

### The three ways to get mail into the app, ranked

| | What it needs | Self-serve? |
|---|---|---|
| **IMAP + Yahoo app password** | An app password from Yahoo's account security page. The app's Settings already have the IMAP fields. | Yes, if Yahoo still issues app passwords for IMAP |
| **IMAP + OAuth2** | The commercial-access application. | No |
| **The API the app already uses** | An app with an approved mail scope. | Only if it is already approved |
| **A local bridge** | The `scripts/email_worker.ts` in the repo, or the capture runner. Your session, your machine. | Yes |

The app password route is the one worth testing first, because it needs no
application process. That is a check, not a claim: whether Yahoo still
issues app passwords for IMAP is worth confirming before building on it.

## What the app can do about feeds instead

Yahoo is not going to build the feed. The app can, and in two directions.

**Outbound.** `GET /api/feed.xml` publishes the competitions the app
tracks as RSS 2.0, with the deadline, the prize and the eligibility
verdict in each item. Anything can subscribe.

**Inbound.** `POST /api/feed/fetch` reads any RSS or Atom feed and pulls
the items that mention a hackathon. That is how a regional tech-news feed
becomes a source of competitions.

`GET /api/feed/known` lists the feeds that work, by region, and the ones
that are dead.

The measured result of reading the six working feeds: **120 items, one
mention, and it was a false positive.** The regional news feeds mention
hackathons rarely. That is the honest position: the feed route finds
competitions occasionally, not systematically. The systematic route remains
per-competition capture, which is what `docs/HACKATHON-SOURCES.md` covers.
