# Components

## Ring vs. border

Cards and dialogs (base-nova "ring" components) use `ring-*` classes for their
outline — `border-*` color classes are silent no-ops on them (the outline is
drawn with `ring-1`, not a border). Everything else (banners, badges, plain
`<div>` boxes) uses regular `border-*` classes as normal.

Rule of thumb: **cards and dialogs use ring, everything else uses border.**

## Shared primitives (U0)

These exist so a given idea (a confidence disclosure, a system banner, an
empty state) has exactly one visual treatment across the app, even though
several features need it.

- **`confidence-pill.tsx` — `ConfidencePill`.** The one badge for "how sure
  are we about this number" (measured/modeled/derived/directional/not
  measured). Always text + icon, never color-only. The tier *vocabulary* and
  labels stay owned by each caller's own glossary (`maturity-glossary` /
  `analytics-glossary` / `exec-report-copy`) — this component only unifies
  the look.
- **`banner.tsx` — `Banner`.** The one presentation layer (on top of
  `ui/alert.tsx`) for system banners: tone (`info` / `warning` / `critical`),
  a title, optional body, optional action. Never dismissible — system
  banners aren't optional to see. Has a `persistent` mode for a full-width
  bar that must stay visible above/within the whole app shell (e.g. the
  impersonation banner) instead of the normal boxed-card look. Each concrete
  banner (`sync-staleness-banner.tsx`, `spend/budget-alert-banner.tsx`,
  `admin/impersonation-banner.tsx`) keeps its own file and its own logic for
  *when* to render and *what* to say — only the chrome comes from `Banner`.
- **`empty-state.tsx` — `EmptyState`.** The one "nothing here yet" block.
  `variant="default"` is the centered card look for whole-page/section empty
  states. `variant="inline"` is the compact left-aligned dashed box used
  inside companion cards when a sub-section (not the whole card) has nothing
  to show yet.

## When to use which

| Need | Use |
| --- | --- |
| Label a number's confidence tier | `ConfidencePill` |
| A system-level notice above page content (stale sync, budget crossed, impersonation) | `Banner` |
| A whole page/section has no data yet | `EmptyState` (`variant="default"`) |
| A card has a sub-section with nothing to show yet | `EmptyState` (`variant="inline"`) |
