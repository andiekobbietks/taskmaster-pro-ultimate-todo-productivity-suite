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

## The component library

`npm run storybook:serve` then open:

**http://127.0.0.1:8821/storybook.html**

Eleven stories, each one component shown in isolation with every variant and
state. It imports the real components from `src/components`, so what you see is
what ships.

## Rebuilding the design system handbook

```powershell
npm run storybook:build          # rebuild the component library bundle
python scripts/capture-storybook.py   # regenerate the pixel samples
python scripts/build-handbook.py       # rebuild the PDF
```

Output: `TaskMaster_Pro_Design_System_Handbook.pdf` — 17 pages with the real
component samples embedded.

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
