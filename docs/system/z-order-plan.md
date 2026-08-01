---
type: "plan"
status: "completed — semantic layer migration and browser regression coverage landed"
last_updated: "2026-08-01"
description: "A single, semantic z-order system for TextIQ app chrome. Adds a canvas/editing-overlay layer and a nested-menu layer so selection-anchored surfaces (context toolbar) stop covering side panels and dialogs, and menus opened inside panels/dialogs stop being clipped behind them."
---

# Z-Order System Plan

## Priority And Goal

**Priority:** P2 (correctness of overlay stacking; user-visible layering bugs).

Establish one predictable, documented z-order system so every overlay has a
single semantic home. Fix the class of bugs where a canvas-anchored editing
surface paints over a side panel or dialog, and where a menu opened from inside
a panel/dialog is clipped behind it.

## Reported Symptom

The slide **context toolbar** floats above the **inspector / diagnostics
panel**. The same inversion can occur for any canvas-anchored overlay because
they were all pushed to the top layer.

Root cause: the context toolbar renders through
[`FloatingSurface`](../../src/components/ui/floating-surface.tsx) with
`layer="tooltip"` (the top tier, z-index `90`), portaled to `document.body`. The
desktop inspector is an in-flow `<aside>`
([`inspector-shell.tsx`](../../src/components/presentation/inspector/inspector-shell.tsx))
with **no** stacking layer. A positioned/portaled overlay at any `z > 0` paints
over in-flow content, so the toolbar wins globally.

## Current System (as-is)

There are **two independent z scales** that must never be compared to each
other:

1. **Global chrome scale** — `--z-index-*` in
   [`globals.css`](../../src/app/globals.css) (auto-generates Tailwind `z-*`
   utilities), surfaced as the `UI_LAYER` map in
   [`tokens.ts`](../../src/components/ui/tokens.ts) and consumed by
   `FloatingSurface`/`Popover` `layer` props.

   | Token      | Value | Intended use                                |
   | ---------- | ----- | ------------------------------------------- |
   | `raised`   | 10    | in-content floats (badges, gutter, HUD)     |
   | `sticky`   | 20    | sticky in-page toolbars                     |
   | `header`   | 30    | global site header                          |
   | `dropdown` | 40    | header/toolbar-anchored menus & popovers    |
   | `overlay`  | 50    | full-screen scrims behind drawers/sheets    |
   | `panel`    | 60    | drawers & side panels (inspector, comments) |
   | `modal`    | 70    | centered dialogs & fullscreen present       |
   | `toast`    | 80    | transient toasts                            |
   | `tooltip`  | 90    | tooltips — always on top                    |

2. **Stage-internal scale** — `STAGE_CHROME_Z_INDEX` (1–2500) in
   [`stage-chrome.ts`](../../src/lib/presentation/stage-chrome.ts) for selection
   frames, handles, guides, marquee, and the inline editor. These large numbers
   are safe **only** because the stage root establishes an isolated stacking
   context (`isolate` / `z-0`), so they never escape to compete with the global
   scale. This invariant is currently undocumented.

## Root Causes

1. **No home for canvas/editing overlays.** Selection-anchored surfaces (context
   toolbar, floating text toolbar, visual popover, stage context menu) have no
   semantic layer. They should sit above the canvas/inline chrome but **below**
   side panels and dialogs. Lacking that, the context toolbar was set to
   `tooltip` (top tier), inverting the hierarchy.
2. **Side panels do not claim a stacking layer.** The desktop inspector is
   in-flow with no `z`, so it cannot win against any positioned overlay even when
   they overlap spatially.
3. **Nested overlays have no rule.** A menu/popover opened from inside a
   `panel`(60) or `modal`(70) must clear its opener, but the only menu tier is
   `dropdown`(40) — below both. This forces ad-hoc jumps to `tooltip`(90) (e.g.
   [`select-menu.tsx`](../../src/components/ui/select-menu.tsx)).
4. **`tooltip` is overloaded.** It is used both for real tooltips and as a
   "get above everything" escape hatch, so genuine tooltips and editing surfaces
   collide.
5. **The stage isolation invariant is implicit.** Nothing documents or guards
   that `STAGE_CHROME_Z_INDEX` only works because the stage is isolated.

## Proposed System (to-be)

Insert **two** new tiers; keep all existing values (no renumbering). Ordering
becomes:

| Token        | Value  | Intended use                                                                                                               |
| ------------ | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `raised`     | 10     | in-content floats (badges, gutter, HUD)                                                                                    |
| `sticky`     | 20     | sticky in-page toolbars                                                                                                    |
| `header`     | 30     | global site header                                                                                                         |
| **`canvas`** | **35** | **canvas/selection-anchored editing overlays: context toolbar, floating text toolbar, visual popover, stage context menu** |
| `dropdown`   | 40     | header/toolbar-anchored menus & popovers                                                                                   |
| `overlay`    | 50     | full-screen scrims behind drawers/sheets                                                                                   |
| `panel`      | 60     | drawers & side panels (inspector, comments)                                                                                |
| `modal`      | 70     | centered dialogs & fullscreen present                                                                                      |
| **`menu`**   | **75** | **menus/popovers opened from within a panel/modal (must clear their opener)**                                              |
| `toast`      | 80     | transient toasts                                                                                                           |
| `tooltip`    | 90     | tooltips only — reserved for `Tooltip`                                                                                     |

Rules:

- **`canvas` < `panel` < `modal`.** A selection-anchored overlay never covers a
  side panel or dialog.
- **`menu`(75) > `modal`(70).** A menu opened from inside a dialog/panel clears
  it, without borrowing `tooltip`.
- **`tooltip`(90) is reserved** for the `Tooltip` primitive.
- **Stage-internal `STAGE_CHROME_Z_INDEX` stays local** and must remain inside
  the isolated stage stacking context; it is never compared to the global scale.

## Migration

| Step | Change                                                                                              | Files                                                |
| ---: | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
|    1 | Add `--z-index-canvas: 35` and `--z-index-menu: 75` to `@theme`; add `canvas`/`menu` to `UI_LAYER`. | `globals.css`, `tokens.ts`                           |
|    2 | Context toolbar `layer="tooltip"` → `layer="canvas"`.                                               | `floating-toolbar.tsx`                               |
|    3 | Desktop inspector aside establishes a stacking layer (`relative z-panel`) so it wins over `canvas`. | `inspector-shell.tsx`                                |
|    4 | Audit floating text toolbar / visual popover; move canvas-anchored surfaces to `canvas`.            | document editor + presentation floats                |
|    5 | Menus opened from within panels/dialogs: `z-tooltip`/`z-dropdown` → `z-menu`.                       | `select-menu.tsx`, panel/dialog-hosted popovers      |
|    6 | Reserve `tooltip` for `Tooltip`; document the stage isolation invariant.                            | `tooltip.tsx`, `stage-chrome.ts`, `design-system.md` |

## Governance

- Keep the `raw-z-index` guardrail in
  [`check-design-system.mjs`](../../scripts/check-design-system.mjs); extend its
  guidance to mention `z-canvas`/`z-menu`.
- `FloatingSurface`/`Popover` already constrain `layer` to the `UILayer` union;
  add `canvas`/`menu` there so misuse stays a type error.
- Document layer selection in
  [`design-system.md`](design-system.md): pick the tier by **what the surface
  is**, not by "what it must beat".

## Phased Rollout

1. **Phase 1 (landed): additive tokens.** Added `canvas`/`menu` to the scale and
   `UI_LAYER`.
2. **Phase 2 (landed): canvas and panel ownership.** Context, text, table,
   insert, visual-generation, visual-context, and stage-context surfaces use
   `canvas`; desktop/mobile inspectors claim `panel`.
3. **Phase 3 (landed): nested menus.** Shared select menus and color pickers
   hosted by a panel or modal use `menu`, including the mobile text-format
   sheet, embedded visual controls, and export dialog.
4. **Phase 4 (landed): tooltip reservation and regression coverage.** Color
   pickers no longer borrow `tooltip`; focused component tests pin semantic
   layer assignments, and the required deterministic browser profile verifies
   the mobile sheet picker is topmost and independently dismissible.

## Risks

- **Stacking-context traps.** `isolate`, `transform`, `filter`, and `opacity`
  create local stacking contexts that clamp descendant `z-index`. Each migrated
  surface must be a `document.body` portal (as `FloatingSurface`/`Popover` are)
  or live in the same context as what it must beat.
- **Spatial vs. stacking overlap.** The inspector fix depends on the panel owning
  a stacking layer; verify the desktop grid column, not just the mobile sheet.
