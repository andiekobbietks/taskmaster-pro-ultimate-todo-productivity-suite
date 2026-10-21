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
node --experimental-strip-types scripts/test-bugfixes.mjs   # 110 route checks
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

### Driving the capture without running anything

There is an MCP server for the capture, registered in
`~/.config/opencode/opencode.jsonc` as `taskmaster-capture`. It gives
five tools:

| Tool | What it does |
|---|---|
| `capture_manifest` | What the app wants captured |
| `add_to_manifest` | Add a page to it |
| `capture_competition` | Capture one page and hand it to the app |
| `capture_all` | Queue the manifest and capture all of it |
| `capture_status` | What the app is holding |

So the capture can be driven by an agent rather than by a script you
remember to run. It needs the app running on port 8787. The server lives
in `~/.config/opencode/mcp/taskmaster-capture/`, and it takes `TM_API`
and `TM_REPO` from the environment.

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
