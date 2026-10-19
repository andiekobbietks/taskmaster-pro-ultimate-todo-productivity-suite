# Feature Catalogue — by Vertical Slice

A vertical slice is a feature that is complete through every layer: **UI →
API → storage**. A feature that exists at one layer and not the others is not
"half done", it is a *phantom* — the most expensive kind of incomplete, because
it looks like it works.

This catalogue is organised by slice rather than by layer, because the useful
question is not "which features are implemented?" (that is `features.json`) but
**"which slices can I actually ship, and which are advertised but hollow?"**

Derived from `docs/features.json` (31 features) and the eight live routes.
Regenerate the source of truth with `npm run docs:readiness`.

---

## Scoreboard

| # | slice | UI | API | storage | verdict |
|---|---|---|---|---|---|
| A | Task lifecycle | yes | yes | yes | **shippable** |
| B | Organisation (lists + tags) | partial | yes | yes | shippable, UI thin |
| C | Filtering & search | yes | yes | yes | **shippable** |
| D | Scheduling & prioritisation | yes | yes | yes | shippable, 1 phantom |
| E | Pomodoro | partial | yes | yes | **not shippable** |
| F | Stats | yes | yes | yes | **shippable** |
| G | Shell & feedback | partial | n/a | n/a | shippable, 1 phantom |
| H | Delivery & quality | n/a | n/a | n/a | CI strong, no tests |
| I | Trust & user control | **none** | **none** | **none** | **absent** |

---

## Slice A — Task lifecycle · shippable

Create, read, update, delete, complete.

| layer | implementation |
|---|---|
| UI | New Task modal, task card, edit, checkbox (`app.jsx:202`, `:243`) |
| API | `GET/POST/PATCH/DELETE /api/todos` |
| storage | `todos` table in the Durable Object's embedded SQLite |

`FEAT-001` implemented · `FEAT-002` implemented · `FEAT-003` implemented (1 gap) · `FEAT-004` **partial, 2 gaps** · `FEAT-005` implemented

**Gap:** delete does not confirm, and reports success when it removed nothing.
This is `G-SAFE-01`, a Beta blocker, and it is the only thing holding this slice
back from "done".

---

## Slice B — Organisation · shippable, UI thin

Lists and tags: the two ways a user groups their own tasks.

| layer | implementation |
|---|---|
| UI | sidebar list nav, list modal (`app.jsx:467`, `:788`), tag badges (`:630`) — **no tag filter control** |
| API | `GET/POST/DELETE /api/lists`, `?tag=`, `?listId=` on `/api/todos` |
| storage | `lists` table; `tags` JSON array in a TEXT column |

`FEAT-009` partial · `FEAT-010` **partial (API only)** · `FEAT-011` partial, 3 gaps · `FEAT-012` implemented · `FEAT-021` implemented

**The tag filter is the interesting one.** It was a phantom until `26601b5`:
`?tag=x` was accepted, documented in the README, and silently ignored. It is now
wired to `json_each` and verified at runtime. But there is still no UI for it —
which is why it is `partial`, not `implemented`, under this repo's own
definition. **The backend promises a capability the user cannot reach.**

---

## Slice C — Filtering & search · shippable

| layer | implementation |
|---|---|
| UI | search input (`app.jsx:340`), priority select (`:543`), status buttons (`:395-465`) |
| API | `?status` `?priority` `?search` `?tag` `?listId` on `GET /api/todos` |
| storage | `WHERE` clause assembled from bound parameters only |

`FEAT-013` **partial, 2 gaps** · `FEAT-007` implemented, 1 gap

**Fixed in `26601b5`:** search built its `LIKE` pattern from raw input, so
`100%` matched everything. Now escaped via `escapeLike()` with an explicit
`ESCAPE` clause, and `tier1-check.mjs` fails the build if that regresses.

**Still open:** no debounce (a request per keystroke) and no index, so every
keystroke is a full table scan.

---

## Slice D — Scheduling & prioritisation · shippable, one phantom

| layer | implementation |
|---|---|
| UI | pin toggle, priority badge, due badge, today filter, view tabs |
| API | `is_pinned`, `priority`, `due_date` on the todo row |
| storage | three columns; sort is `is_pinned DESC, due_date ASC, created_at DESC` |

`FEAT-006` implemented · `FEAT-007` implemented · `FEAT-008` partial, 3 gaps · `FEAT-018` implemented · `FEAT-019` **planned — phantom**

**`FEAT-019` "Upcoming"** renders as a tab and has a title ternary, but no
`setActiveTab('upcoming')` call exists anywhere in the codebase. Clicking it
does nothing. This is the second phantom and it survives because no gate can see
a control that is present in the DOM but wired to nothing.

---

## Slice E — Pomodoro · not shippable

| layer | implementation |
|---|---|
| UI | countdown widget, per-task increment button, new-task timer state |
| API | `estimated_pomodoros` and `pomodoro_count` accepted on create/update |
| storage | two columns on `todos` |

`FEAT-015` **partial, 4 gaps** · `FEAT-016` implemented · `FEAT-017` **stub — phantom**

**`FEAT-017` "Estimated pomodoros"** is the third phantom. The backend accepts
the field and stores it, but the New Task form never sends it — the evidence in
`features.json` notes it is "absent from the New Task form at 680-786". The
README advertises "estimated and completed pomodoro counts per task". A user
cannot estimate anything.

**This is the slice that most clearly fails the vertical test**: the README and
the data model both promise a timer-planning feature that the UI does not have.
Either build the form field or stop advertising it.

---

## Slice F — Stats · shippable

| layer | implementation |
|---|---|
| UI | productivity widget, sidebar counters (`app.jsx:395-465`) |
| API | `GET /api/stats` |
| storage | `COUNT`/`SUM` over the `todos` table |

`FEAT-014` implemented, 2 gaps

---

## Slice G — Shell & feedback · shippable, one phantom

| layer | implementation |
|---|---|
| UI | error banner, empty states, dark mode toggle, layout |
| API | n/a — client-side concern |
| storage | n/a |

`FEAT-020` partial, 2 gaps · `FEAT-023` implemented · `FEAT-024` **partial, 2 gaps** · `FEAT-025` implemented, 3 gaps · `FEAT-026` **planned — phantom**

**`FEAT-026` ⌘K** is a placeholder string with no keydown listener.

**`FEAT-024` is the quiet one.** Search is `hidden sm:block`, the sidebar is
`hidden lg:flex`, the timer is `hidden md:flex`. A responsive layout that hides
its navigation on small screens is not responsive — it is desktop-only with the
parts removed. `G-SCOPE-01`.

`FEAT-025` is the strongest work in the repo: all nine `fetch` call sites route
through one `api()` helper that rejects on non-2xx and surfaces the server's own
message with a retry.

---

## Slice H — Delivery & quality · CI strong, no tests

| layer | implementation |
|---|---|
| CI | `ci.yml` — build, Worker dry-run bundle, docs-sync gate, seed validation, **cross-file consistency** |
| release | `release.yml` — `v*` tag → GitHub Release, notes from `CHANGELOG.md` |
| tests | **none** |

`FEAT-022` implemented · `FEAT-029` **planned** · `FEAT-030` partial, 2 gaps · `FEAT-031` planned, 3 gaps

**`FEAT-029` is the uncomfortable one.** This repository has an unusually strong
CI story and zero automated tests. Every gate proves something about
*configuration*; none of them proves the application *works*. The tag filter
that lied for nineteen days would have been caught by a single test asserting
`?tag=x` returns only matching rows.

`FEAT-031` — `SELECT * FROM todos` with no `LIMIT`, no paging state in the
client. Fine at 31 features, not fine at 31,000 rows.

---

## Slice I — Trust & user control · absent

| layer | implementation |
|---|---|
| UI | **none** |
| API | **none** |
| storage | **none** |

`FEAT-027` planned · `FEAT-028` planned

**There is no authentication.** A grep across the repository for
`auth|bearer|token|session|cookie` returns one hit: the word "session" inside an
`alert()` string.

This is the slice that gates everything else, and the vertical view makes the
cost obvious: it is **0 of 3 layers**, not "most of one layer". Anyone holding
the URL has full read and write on every todo in the instance.

`SECURITY.md` says so plainly — *"a deployed instance must be treated as public
and untrusted"* — which is honest, and also means the app cannot be given to
anyone else yet.

---

## What the slice view changes

Judged feature-by-feature, the app looks like 24 of 31 usable. Judged by slice,
three conclusions appear that the flat view hides:

1. **Two of the three phantoms are UI-side, not backend-side.** `FEAT-017`
   (estimated pomodoros) and `FEAT-019` (Upcoming tab) both have working
   backends. The server honours the data; the interface simply never sends or
   wires it. "Implement the backend" would not have fixed either.

2. **Slice I is structurally absent, not partially built.** You cannot iterate
   toward auth by improving an existing slice, because there is no slice to
   improve — it starts at the UI.

3. **`FEAT-029` is the load-bearing gap.** The repo's own maturity model gives
   CI partial credit and tests zero. But the two defects that actually shipped
   were both logic errors that no configuration gate can see, and both are the
   kind a five-line test catches.

If one thing gets built next, make it the first automated test that asserts
`GET /api/todos?tag=x` returns only matching rows. It is cheap, it is the bug
that shipped, and it is the first example of the slice discipline paying for
itself.