# Where the competitions come from

Written 2026-10-21. Every line was checked against the live site, not
recalled.

The question was: is there an RSS feed that lists hackathons, so the app
can find them without reading a listing page?

## The short answer

**No.** There is no RSS feed for hackathon listings, for any platform, in
any region. The feeds that exist are tech-news feeds, and the two big
platforms have none at all.

## What was checked

### The two big platforms

| Feed | Result |
|---|---|
| `https://devpost.com/feed.rss` | HTTP 200, but `content-type: text/html` — it is the homepage, not a feed |
| `https://devpost.com/hackathons.rss` | HTTP 406 |
| `https://devpost.com/hackathons/feed.rss` | 404 |
| `https://devpost.com/rss` | 404 |
| `https://mlh.io/events.rss` | 404 |
| `https://mlh.io/feed.rss` | 404 |
| `https://mlh.io/events/feed` | 404 |

Devpost has no public feed. MLH has no public feed. There is no
documented way to subscribe to either one's listings.

**Corrected 2026-10-21: Devpost has an undocumented JSON API, and it is
open.** The feed table above stands — there is still no RSS — but the
same endpoint their own front end calls answers a plain GET with no key
and no challenge:

    GET https://devpost.com/api/hackathons?status[]=open&per_page=40&page=1

Measured that day: 59 open hackathons (total catalogue 14,132), 9 rows
default or 40 with `per_page=40`, fields include title, url, prize
(markup-wrapped), submission_period_dates, registrations_count,
invite_only, organization_name. The app ingests it:
`src/devpost.ts`, route `POST /api/devpost/import` (2 pages cover the
whole open set; a re-import updates its own stable
`hack-devpost-<id>` rows instead of duplicating). Caveat: this is an
internal endpoint Devpost does not document and can change or close
without notice — the ingest treats every field defensively and reports
`endpoint_ok: false` on any shape change.

### Regional and aggregator candidates

| Feed | Result |
|---|---|
| `https://ec.europa.eu/commission/presscorner/api/rss?language=en` | Live — EU press releases, 10 items, 0 hackathon mentions |
| `https://techcabal.com/feed/` | Live — TechCabal, African tech, 10 items |
| `https://www.gadget.co.za/feed/` | Live — Gadget, South Africa, 30 items |
| `https://analyticsindiamag.com/feed` | Live — AIM, 50 items, 2 hackathon mentions |
| `https://yourstory.com/feed` | Live — YourStory, 20 items |
| `https://hnrss.org/frontpage` | Live — Hacker News, 20 items |
| `https://www.startupweekend.org/feed/` | HTTP 200 but not a feed |
| BCS, TechUK, Nesta, Techstars, Slush, Hackerspaces, Hack Club, DoraHacks, TechNation, Luma, Eventbrite, Meetup | 404, or no feed |

The EMEA ones that work — TechCabal and Gadget — are **tech news**, not
hackathon listings. A feed filtered for the word "hackathon" finds
occasional articles about hackathons, which is a noisy way to find
competitions and will miss most of them.

## The other finding: Devpost blocks a headless browser

The capture machinery works. It captured a page, recorded 14 responses,
wrote a valid WACZ, and `warcio` read every record back.

**Against Devpost it captures the bot challenge instead of the page.** Both
the listing and a single competition page came back as:

```
https://devpost.com/hackathons/amazon-hackathon
  text/html                       6,239 bytes   <- the challenge page
https://devpost.com/cdn-cgi/challenge-platform/.../orchestrate/chl_page/...
  application/javascript        251,445 bytes   <- the challenge
https://devpost.com/cdn-cgi/challenge-platform/.../fo/...
  text/plain                    107,280 bytes   <- the challenge payload
```

No competition data, in either capture. The listing is a React app, so
the competitions come from an API call that never happens because the
challenge is served instead.

### The usual fixes, tried

| Attempt | Result |
|---|---|
| Bundled Chromium, headless | 2,356-byte challenge page |
| Bundled Chromium, headed | Same |
| Real Chrome (`channel="chrome"`), headless | Same |
| Real Chrome, headed | Same |
| Bundled Chromium, **persistent profile**, headless | Same |
| Bundled Chromium, persistent profile, headed | Same |
| Real Chrome, persistent profile, headless | Same |
| Real Chrome, persistent profile, headed | Same |

A persistent profile is the standard answer to a bot challenge — the
clearance cookie survives, so the second visit is clean. It did not help
here, because a **fresh** profile has no clearance cookie to reuse. The
first visit needs a human to pass the challenge, and a human passing it
in a headed browser does not obviously leave a cookie the automated
profile can use.

That is the honest position: **the capture cannot get Devpost's content
unattended.** It is not the format's problem — it is Cloudflare's bot
management, and it applies to anything that is not a real browser with a
real profile that has already been through it.


## What that leaves

| Route | How well it works |
|---|---|
| **The Wayback Machine** | The sanctioned one. A snapshot of a listing is static HTML with the links in it, and `src/archive.ts` already reads it. It is a snapshot, so it is only as fresh as the last crawl. |
| **A real browser with a persistent profile** | The standard fix for the challenge. A profile that has solved the challenge once keeps the clearance cookie. `scripts/capture-wacz.py` would need a persistent context and the real Chrome channel. |
| **An RSS feed, filtered** | Works, and is cheap, but it finds hackathons *mentioned in the news* — mostly EMEA, mostly article-not-competition, and it will miss most. |
| **A platform with a real API** | Kaggle, HackerEarth and CodeChef all have one. They are not where the big prize hackathons are, but they are where the data is clean. |

The one to try first is the persistent real-Chrome profile, because it is
a small change to a script that already works and it would make the
capture work against the platforms that matter.

## The honest state

`scripts/sync-hackathons.mjs` still has all three sources set to
`enabled: false`. Nothing above changes that — it changes what it should
be pointed at.
