# Start here

## Where this is

```
C:\Users\Admin\Documents\taskmaster-pro
```

**Run every command from inside that folder.** `npm` looks for `package.json`
in the current directory, so running it from `C:\Users\Admin` fails with
`ENOENT ... Could not read package.json`.

```powershell
cd C:\Users\Admin\Documents\taskmaster-pro
```

## First run on a new machine

```powershell
cd C:\Users\Admin\Documents\taskmaster-pro
npm install
npm install-scripts approve esbuild
npm install
```

The second `npm install` is needed because esbuild downloads its platform
binary in a post-install script, and npm blocks install scripts by default in
this environment.

## The three things you can run

| Command | What it gives you |
|---|---|
| `npm run dev` | The app on http://localhost:8787 |
| `npm run storybook:serve` | Every component in isolation on http://127.0.0.1:8821/storybook.html |
| `npm test` | The API test suite, 36 checks against the real routes |

There are two more checks you can run:

```powershell
node --experimental-strip-types scripts/test-bugfixes.mjs   # 144 route checks
python scripts/verify-ui.py                                 # 27 checks in a real browser
```

`verify-ui.py` needs a server on port 8821 (`npm run storybook:serve`) and
Playwright (`pip install playwright`). It drives the browser: it opens the
Add Hackathon form, reads the populated settings, ticks a selection box in
both lists, and reloads the page with every external request blocked to
prove the app works offline.

## The component library

`npm run storybook:serve` then open:

**http://127.0.0.1:8821/storybook.html**

Thirteen stories, each one component shown in isolation with every variant and
state. It imports the real components from `src/components`, so what you see is
what ships.

## Rebuilding the design system handbook

```powershell
npm run storybook:build               # rebuild the component library bundle
python scripts/capture-storybook.py   # regenerate the component pixel samples
python scripts/capture-views.py       # regenerate the screen pixel samples
python scripts/build-handbook.py      # rebuild the PDF
```

Output: `TaskMaster_Pro_Design_System_Handbook.pdf` — 22 pages with the real
component and screen samples embedded, in `C:\Users\Admin\Documents`.

The capture scripts publish into `docs/samples` and `docs/samples/views`.
They clear those folders first, so a renamed or dropped component does not
leave a stale sample behind, and they skip the components that cover the
viewport rather than cropping them.

## The Yahoo application

Mail is fetched with the Yahoo Mail API, and the app does it itself,
inside the Worker.

1. Register an application at `developer.yahoo.com/apps`, with the
   **Mail / Read** permission.
2. Put the client id, the client secret and the refresh token into
   **Settings → Email**.
3. Press **Test connection**. It lists your mailboxes, or tells you what
   went wrong.

The secrets are write-only. The API hands back a mask, never the value,
so the screen shows that a secret is set and sends a new one only when
you type it.

## Capturing a competition page as a WACZ

A capture records the traffic that made a page, not a picture of it, so
the API calls survive with it. The archive lands in `captures/`, and the
app reads it, extracts the deadline, prize and rules, and keeps the raw
HTML for the compiler pipeline.

```powershell
pip install warcio                                  # to validate the result
python scripts/capture-wacz.py --url https://devpost.com/hackathons/your-hackathon --name "Your Hackathon"
```

Or, with the pages listed in **Settings → Capture** and queued from
there, with no configuration file of your own:

```powershell
python scripts/capture-wacz.py --from-app
```

To check an archive without the app:

```powershell
python scripts/validate-wacz.py captures/Your-Hackathon.wacz
```

### The app as an MCP server

**The app speaks MCP itself**, at `POST /api/mcp`. Any MCP client can
connect to it — Claude Desktop, Cursor, VS Code, an agent, a script — and
work with the competitions, the inbox and the capture queue. There is
nothing to install and no sidecar.

```jsonc
// in ~/.config/opencode/opencode.jsonc
"taskmaster": {
  "type": "remote",
  "url": "http://127.0.0.1:8787/api/mcp",
  "enabled": true,
  "timeout": 60000
}
```

Thirteen tools and one importer: `list_competitions`, `get_competition`,
`list_inbox`, `search_inbox`, `capture_manifest`, `add_to_manifest`,
`capture_all`, `capture_status`, `fetch_mail`, `feed_competitions`,
`read_feed`, `known_feeds`, `import_devpost` (pulls every open Devpost
hackathon straight into competitions), `get_settings`. The secrets come
back masked.

Quick check that it is alive, without configuring anything — the MCP
Inspector is the official playground, and it connects straight to the
endpoint:

```powershell
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8787/api/mcp --method tools/list
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8787/api/mcp --method tools/call --tool-name known_feeds
npx @modelcontextprotocol/inspector   # the web UI; put in the same URL
```

The official MCP TypeScript SDK (**1.32.1**) is the transport: real
Streamable HTTP, sessions, SSE, spec-strict protocol handling — the same
plumbing every blog post about "we implement MCP" ends up describing. The
tool definitions live in `src/mcp-tools.ts`; `src/mcp.ts` is a hand-rolled
lean transport kept as the fallback (flip one import in `src/index.ts`).

The SDK is bigger, and the numbers are measured, not vibes — wrangler's
own bundling, 2026-10-21: worker bundle 1601 KiB raw / **285 KiB
gzipped** with the SDK against 953 KiB / 165 KiB hand-rolled (+120 KiB
compressed). Both fit deploy limits; the price is honesty in the README,
not a broken build.

One warning for custom clients: the SDK transport is spec-strict. A POST
without `Accept: application/json, text/event-stream` is answered
**HTTP 406** — the lean server accepted anything, and the test suite
caught the difference when it was switched over.

### The competitions on a calendar

**`GET /api/calendar.ics`** is a valid RFC 5545 calendar of every open
competition. It is the one path that needs no account, no token and no
click: iPhone Settings → Calendar → Add Calendar → Subscribe, then paste
the URL. Outlook: File → Add calendar → From internet. Google Calendar:
the "+" → From URL. The events refresh on their own.

**`GET /api/hackathons/simple`** is the JSON behind it, and only the
fields a subscriber needs: `{id, title, start, end, prize, url,
eligibility}`.

**Settings → Calendar** holds a four-step wizard (where, sign in, which,
check) that walks through putting a chosen set on a calendar. Two of its
four paths are marked **(i)** — experimental, new, and they can change:

| Path | State | What it needs |
|---|---|---|
| Subscribe to the feed | stable | Nothing but the URL |
| Download the .ics file | stable | Nothing |
| Push to Microsoft Outlook **(i)** | experimental | An OAuth token with `Calendars.ReadWrite` — the flow is not wired up yet |
| Push to CalDAV **(i)** | experimental | A server URL and a write-capable account — the write is not wired up yet |

The experimental paths answer honestly: `POST /api/calendar/push` returns
**HTTP 501** with the list of events it *would* write and a plain sentence
saying what is missing. Nothing pretends to work.

```powershell
curl http://127.0.0.1:8787/api/calendar.ics
curl http://127.0.0.1:8787/api/hackathons/simple
```

### The reader's time zone

**The profile carries an IANA zone** (`Europe/Dublin`), and everything
that needs a clock uses it: the digest's time, the "today" filter, the
days left on a deadline, and the eligibility engine's idea of now. Set
it in **Settings → Profile**, or press **"Use this device"** and the
browser's own zone is taken.

```powershell
npm run test:timezone     # 42 checks, including every daylight-saving edge
```

**The arithmetic is in `src/timezone.ts`**, on `Intl` — the Workers
runtime ships the full zone database, so there is no table to maintain
and no library to install. The parts that are easy to get wrong, and are
therefore tested:

- **Finding "08:00 local"** is not adding eight hours to UTC. It is
  finding the instant whose *local* time is 08:00, which moves with
  daylight saving.
- **A local time that does not exist** (the hour that vanishes on a
  spring-forward morning) still resolves to a real instant.
- **A local time that happens twice** (the hour that repeats on a
  fall-back evening) resolves to the *first* one, like every calendar.
- **Counting days** is a calendar difference, not hours divided by 24.
  A deadline that closes tonight is 0 days left, in Auckland and in
  Los Angeles alike.

**Two bugs this fixed, which affected every reader outside UTC:**

1. The "Today" filter compared the reader's tasks against **UTC's**
   date, so in the evening in California the Today tab showed
   yesterday.
2. The days-left on a deadline compared a **UTC midnight** against a
   local clock, so a deadline closing tonight read as tomorrow's.

**What is still UTC:** the competition deadlines themselves. Devpost
publishes a date, and that date is the organiser's — "closes on the
23rd" means the 23rd where they are. That is the right reading for a
deadline, and it is not a bug.

### Push notifications

**The app is installable and can push to a phone.** `public/manifest.webmanifest`
plus `public/sw.js` make it a PWA; the icons in `public/assets/` are generated
from the app's own mark by `npm run icons`.

**On iPhone this needs the Home Screen.** Apple supports Web Push for web apps
added to the Home Screen (iOS 16.4+), with no Apple Developer Program: iOS
16.4+ supports the Push API, the Notifications API and service workers for
Home Screen web apps. In a Safari tab there is no push manager, so the
Settings card says so instead of failing quietly.

**Sending a push is implemented from the spec, not from a library.** The
`web-push` npm package uses node's `https`, which does not exist in a
Worker, so `src/push.ts` does it on WebCrypto: RFC 8292 (VAPID signing) and
RFC 8291 (aes128gcm encryption). That is about 300 lines and keeps the
dependency tree at four packages.

**The test is the RFC's own example.** RFC 8291 Appendix A publishes every
value in the derivation chain, and Section 5 publishes the whole encrypted
body. RFC 8292 section 2.4 publishes a complete VAPID request. Both are
checked:

```powershell
npm run test:push              # both: 15 encryption checks, 11 VAPID checks
npm run test:push:encryption   # RFC 8291
npm run test:push:vapid        # RFC 8292
```

The encryption test checks the shared secret, both PRKs, the IKM, the
content key, the nonce, the 86-octet header, and then the **whole body byte
for byte** against the RFC's. The VAPID test checks the public key
encoding, the JWT header and body, and that the RFC's own signature
verifies against the RFC's public key — which is what proves the signature
is the raw `r||s` form a push service expects, not DER.

The vector in `scripts/rfc8291-vector.json` is extracted from the RFC text
by `scripts/extract-rfc-vector.mjs`, so nothing is transcribed by hand.

That test earned its keep twice: it caught that the additional data for the
content cipher must be **zero-length** (RFC 8188 §2.1) — the header is sent
in the body but is not authenticated. With the header as the AAD, the body
looked right and no push service could ever decrypt it.

**Setting it up:**

```powershell
npm run vapid     # writes .dev.vars (gitignored) and prints the public key
```

For a deployment, the same three values go in as secrets
(`npx wrangler secret put VAPID_PUBLIC_KEY`, and the private key and
subject). Losing the private key means every existing subscription has to
be re-made: a browser subscription is bound to the public key it was given.

**What is not finished:** the daily digest still has no time zone, so
`digest_time` is read as UTC, and the reminder content is not settled. The
Settings card is marked **(i)** until it is.

### Driving the capture

The capture needs a browser, so it cannot run in the Worker. There is a
second, small MCP server for that, registered as `taskmaster-capture`,
which lives in `~/.config/opencode/mcp/taskmaster-capture/`. It runs the
capture and posts the archive back to the app. It takes `TM_API` and
`TM_REPO` from the environment.

## Where the work goes next

`docs/ROADMAP.md` holds the to-do list, ordered by your journey rather
than by feature, split into Must / Should / Could / Won't, with the
critical path marked. Each item names the file and the line, so the first
move is an editor rather than a decision.

## Branches

| Branch | What it is |
|---|---|
| `main` | Everything, with the open core licence |
| `open-core` | Identical to main, kept in sync |
| `feat/hackathon-tracker` | Where the features were developed |

## Licence note

`src/components/InboxPrimitives.jsx` and `src/lib/email.js` are derived from
`cloudflare/agentic-inbox` (Apache-2.0) and are licensed under Apache-2.0.
See `NOTICE` and `THIRD-PARTY-LICENSES/Apache-2.0.txt`. Everything else is
under the open core licence in `LICENSE`.
