# Component library

`src/storybook.jsx` renders every component in isolation, the way a Storybook
would. It imports the real components from `src/components`, so what you see is
what ships.

## Run it

```bash
npm run storybook:serve
# open http://127.0.0.1:8821/storybook.html
```

`storybook:serve` builds the bundle and starts a mock API server, so the
inbox primitives have realistic data to render against.

## Build only

```bash
npm run storybook:build
# writes public/assets/storybook.js
```

## Pixel samples

`docs/samples/` holds a two-times-resolution capture of each story, generated
by `scripts/capture-storybook.py`. The design system handbook
(`scripts/build-handbook.py`) embeds these, so the document always shows the
current code rather than a mock-up.

## Stories

| Story | Component | Shows |
|---|---|---|
| Button | `src/components/Button.jsx` | Four variants, three sizes, disabled and loading |
| Input | `src/components/Input.jsx` | Labels, placeholders, required marker, error state |
| Card | `src/components/Card.jsx` | Default and hover surfaces |
| Badge | `src/components/Badge.jsx` | Six semantic variants, two sizes |
| Banner | `src/components/Banner.jsx` | Error, success and warning, with retry and dismiss |
| EmptyState | `src/components/EmptyState.jsx` | Icon, title, description and action |
| Modal | `src/components/Modal.jsx` | Dialog over a dimmed backdrop |
| Email list row | `src/components/InboxPrimitives.jsx` | Unread state, platform badge, linked ticket, match confidence |
| Email detail panel | `src/components/InboxPrimitives.jsx` | Header, avatar, plain-text body, attachments |
| Inbox split view | `src/components/InboxPrimitives.jsx` | List beside the detail panel |
| Inbox skeleton | `src/components/InboxPrimitives.jsx` | Loading placeholders |
