# Version History

Every version this project has ever been through, in order, with the state of
`scripts/tier1-check.mjs` at that commit. The checker is run against each
historical tree so this table is derived from the code, not remembered.

Regenerate the checker column by running the checker against each commit; the
numbers below were produced with:

```bash
for c in $(git log --reverse --format=%h); do
  d=$(mktemp -d); git archive "$c" | tar -x -C "$d"
  echo "$c $(node scripts/tier1-check.mjs "$d" | tail -1)"
  rm -rf "$d"
done
```

## The arc

| commit | date | FAIL | WARN | version | what happened |
|---|---|---|---|---|---|
| `dd54eef` | 2026-09-27 | 3 | 0 | — | `chore: initialize think space` — space marker only, no application code |
| `eda3a6c` | 2026-09-27 | 3 | 2 | — | `deploy: snapshot working tree` — the original generated app, **4 real files, ~53 KB** |
| `d9a5505` | 2026-10-16 | 3 | 2 | — | `refactor: move app to repo root, add README and .gitignore` |
| `9df1887` | 2026-10-16 | 3 | 2 | — | `docs: add cross-linked software inventories (SBOM, features, architecture)` |
| `e1b24f4` | 2026-10-16 | 3 | 2 | — | `fix(security): pin CDN deps with SRI; add self-ticking readiness checklist` |
| `373e321` | 2026-10-16 | 3 | 2 | **`v1.0.0`** | `feat: add CI gates, release automation, security policy, chaos seed data` |
| `f6d4a41` | 2026-10-16 | 2 | 2 | — | `fix: name the Worker and install deps so the CI bundle gate can pass` |
| `f7053bc` | 2026-10-17 | 2 | 2 | — | `feat: compile the front end, surface request errors, make demo data opt-in` |
| `db911f5` | 2026-10-17 | 0 | 2 | — | `fix: add Worker entrypoint so the Durable Object API actually serves` |
| `26601b5` | 2026-10-19 | 0 | 0 | — | `fix: wire the dead tag filter, escape LIKE wildcards, add a consistency gate` |
| `40cb715` | 2026-10-19 | 0 | 0 | pending | `docs: prepare the 1.0.1 release notes` |

## Releases

| tag | commit | state at tag | notes |
|---|---|---|---|
| `v1.0.0` | `373e321` | **3 FAIL, 2 WARN — the app could not serve its own API** | Published 2026-10-16. No attached assets. Superseded. |
| `v1.0.1` | `40cb715` | 0 FAIL, 0 WARN | First tag that contains the Durable Object binding fix. |

`v1.0.0` shipped `src/index.ts` exporting `App extends DurableObject` next to a
`wrangler.json` with no `name`, no `durable_objects` binding and no `migrations`
entry. The Durable Object was never constructed, so every `/api/*` route failed
at the edge. The fix is `db911f5`, which landed two commits *after* the tag.
`v1.0.1` is the first tag that includes it.

## Defect lifecycle

| defect | introduced | fixed | lives |
|---|---|---|---|
| `WORKER-NAME` | `dd54eef` | `f6d4a41` | — |
| `DO-BINDING` | `eda3a6c` | `db911f5` | — |
| `DO-MIGRATE` | `eda3a6c` | `db911f5` | — |
| `DEAD-FILTER` | `eda3a6c` | `26601b5` | — |
| `LIKE-ESCAPE` | `eda3a6c` | `26601b5` | — |

## The part worth remembering

The application was unrunnable from `eda3a6c` (2026-09-27) until `db911f5`
(2026-10-17) — **nineteen days and six commits**. Four of those six commits
added a README, a CycloneDX SBOM, a generated maturity checklist, CI gates and a
tag-driven release pipeline.

Every one of those gates passed. None of them could see the defect, because
each tested a *different* thing: docs were compared against generated output,
seed fixtures were validated, the front end was compiled, the Worker was
bundled. The defect lived in the space *between* two files that were each
individually valid.

`scripts/tier1-check.mjs` exists to close that gap, and it now runs as CI job
four. Had it existed on 2026-09-27, the very first push would have failed with
three fatal errors and none of the six commits above would have been needed.