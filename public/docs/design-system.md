# TaskMaster Pro — Design System

## Overview

TaskMaster Pro uses a **Tailwind CSS**-based design system with custom brand tokens.
All components are built with Tailwind utility classes and follow a consistent
visual language.

## Design Tokens

Design tokens are defined in two places:
- `tailwind.config.cjs` — Tailwind theme configuration
- `src/tailwind.css` — CSS custom properties (brand tokens, animations)
- `docs/design-tokens.json` — Machine-readable token definitions

### Color Palette

#### Brand (Purple)
| Token | Hex | Usage |
|---|---|---|
| `brand-50` | `#EEF0FB` | Lightest tint — hover backgrounds |
| `brand-100` | `#DDE0F7` | Light tint — subtle backgrounds |
| `brand-200` | `#B9C0EF` | Light — borders, dividers |
| `brand-500` | `#7B85DC` | Mid — secondary text, icons |
| `brand-600` | `#5E6AD2` | **Primary** — buttons, links, active states |
| `brand-700` | `#4A56C0` | Dark — hover on primary |
| `brand-800` | `#3A45A8` | Darker — pressed states |
| `brand-900` | `#2A3284` | Darkest — headings on light bg |

#### Neutral (Slate)
| Token | Light mode | Dark mode | Usage |
|---|---|---|---|
| `neutral-50` | `#F8FAFC` | — | Page background |
| `neutral-100` | `#F1F5F9` | — | Card background |
| `neutral-200` | `#E2E8F0` | — | Border, divider |
| `neutral-300` | `#CBD5E1` | — | Disabled border |
| `neutral-400` | `#94A3B8` | — | Placeholder text |
| `neutral-500` | `#64748B` | — | Secondary text |
| `neutral-600` | `#475569` | — | Body text |
| `neutral-700` | `#334155` | — | Heading text |
| `neutral-800` | — | `#1E293B` | Card background (dark) |
| `neutral-900` | — | `#0F172A` | Page background (dark) |
| `neutral-950` | — | `#0A0E1A` | Deepest background (dark) |

#### Semantic
| Token | Hex | Usage |
|---|---|---|
| `success` | `#16A34A` | Success states, completed items |
| `warning` | `#F59E0B` | Warning states, urgent priority |
| `danger` | `#DC2626` | Error states, delete actions |
| `info` | `#2563EB` | Info states, links |

#### Priority
| Token | Hex | Usage |
|---|---|---|
| `low` | `#16A34A` | Low priority badge |
| `medium` | `#2563EB` | Medium priority badge |
| `high` | `#F59E0B` | High priority badge |
| `urgent` | `#DC2626` | Urgent priority badge |

### Typography

| Token | Value | Usage |
|---|---|---|
| `sans` | Inter | Primary UI font |
| `mono` | JetBrains Mono | Code, timestamps, counts |

| Size | Value | Usage |
|---|---|---|
| `xs` | 0.75rem (12px) | Badges, captions |
| `sm` | 0.875rem (14px) | Body text, labels |
| `base` | 1rem (16px) | Default |
| `lg` | 1.125rem (18px) | Section headings |
| `xl` | 1.25rem (20px) | Page titles |
| `2xl` | 1.5rem (24px) | Hero headings |

### Spacing

Standard Tailwind spacing scale (0.25rem = 4px increments).

### Border Radius

| Token | Value | Usage |
|---|---|---|
| `sm` | 0.25rem (4px) | Small elements |
| `md` | 0.375rem (6px) | Inputs, buttons |
| `lg` | 0.5rem (8px) | Cards, modals |
| `xl` | 0.75rem (12px) | Large cards |
| `full` | 9999px | Pills, avatars |

### Shadows

| Token | Value | Usage |
|---|---|---|
| `xs` | 0 1px 2px 0 rgba(0,0,0,0.05) | Subtle elevation |
| `sm` | 0 1px 3px 0 rgba(0,0,0,0.1) | Cards, buttons |
| `md` | 0 4px 6px -1px rgba(0,0,0,0.1) | Modals, dropdowns |
| `lg` | 0 10px 15px -3px rgba(0,0,0,0.1) | Floating panels |

### Animations

| Token | Value | Usage |
|---|---|---|
| `fadeIn` | 200ms cubic-bezier(0.16, 1, 0.3, 1) | Modals, banners |
| `scaleIn` | 250ms cubic-bezier(0.34, 1.56, 0.64, 1) | Cards, popups |

### Breakpoints

| Token | Value | Usage |
|---|---|---|
| `sm` | 640px | Mobile landscape |
| `md` | 768px | Tablet |
| `lg` | 1024px | Desktop |
| `xl` | 1280px | Large desktop |
| `2xl` | 1536px | Extra large |

## Dark Mode

Dark mode is toggled via the `dark` class on `document.documentElement`.
All components use Tailwind's `dark:` variant for dark mode styles.

| Surface | Light | Dark |
|---|---|---|
| Page background | `neutral-50` (#F8FAFC) | `neutral-950` (#0A0E1A) |
| Card background | `white` | `neutral-800` (#1E293B) |
| Sidebar background | `white` | `neutral-900` (#0F172A) |
| Body text | `neutral-600` (#475569) | `neutral-400` (#94A3B8) |
| Border | `neutral-200` (#E2E8F0) | `neutral-800` (#1E293B) |

## Component Library

Components are located in `src/components/`. Each component is a React functional component
that uses Tailwind utility classes and follows the design tokens above.

### Component Inventory

| Component | File | Description |
|---|---|---|
| `Button` | `Button.jsx` | Primary, secondary, ghost, danger variants |
| `Input` | `Input.jsx` | Text, number, email, password, url, time |
| `Select` | `Select.jsx` | Dropdown with options |
| `Card` | `Card.jsx` | Container with border and shadow |
| `Badge` | `Badge.jsx` | Status, priority, platform badges |
| `Modal` | `Modal.jsx` | Overlay + header + content + footer |
| `Banner` | `Banner.jsx` | Error, success, info, warning |
| `Toggle` | `Toggle.jsx` | Checkbox with label |
| `EmptyState` | `EmptyState.jsx` | Icon + title + description + action |
| `Spinner` | `Spinner.jsx` | Loading indicator |
| `Avatar` | `Avatar.jsx` | User avatar with initials |

### Component Props

#### Button
```jsx
<Button variant="primary" size="md" onClick={fn}>
  Click me
</Button>
```
- `variant`: "primary" | "secondary" | "ghost" | "danger"
- `size`: "sm" | "md" | "lg"
- `disabled`: boolean
- `loading`: boolean (shows spinner)

#### Input
```jsx
<Input
  type="text"
  label="Task Title"
  value={value}
  onChange={fn}
  placeholder="Enter title"
  required
/>
```
- `type`: "text" | "number" | "email" | "password" | "url" | "time" | "date"
- `label`: string (optional)
- `placeholder`: string
- `required`: boolean
- `error`: string (optional, shows error state)

#### Card
```jsx
<Card className="p-4">
  Content here
</Card>
```
- `className`: additional Tailwind classes
- `hover`: boolean (adds hover shadow)

#### Badge
```jsx
<Badge variant="success" size="sm">
  Open
</Badge>
```
- `variant`: "success" | "warning" | "danger" | "info" | "neutral" | "brand"
- `size`: "sm" | "md"

#### Modal
```jsx
<Modal isOpen={isOpen} onClose={fn} title="Create Task">
  <form>...</form>
</Modal>
```
- `isOpen`: boolean
- `onClose`: function
- `title`: string
- `size`: "sm" | "md" | "lg" | "xl"

## Usage

All components are imported from `src/components/`:

```jsx
import { Button, Input, Card, Badge, Modal } from './components';

function MyView() {
  return (
    <Card className="p-4">
      <Input label="Name" value={name} onChange={setName} />
      <Button variant="primary" onClick={handleSave}>Save</Button>
    </Card>
  );
}
```

## Storybook

Storybook configuration is in `.storybook/`. Run `npm run storybook` to view components in isolation.

## Files

- `docs/design-system.md` — This document
- `docs/design-tokens.json` — Machine-readable design tokens
- `src/components/` — Reusable component library
- `src/components/index.js` — Barrel exports
- `.storybook/` — Storybook configuration
- `tailwind.config.cjs` — Tailwind theme
- `src/tailwind.css` — CSS custom properties
