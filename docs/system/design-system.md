---
type: "design"
status: "current"
last_updated: "2026-07-04"
description: "TextIQ app chrome uses the --ds-* tokens in src/app/globals.css as the source of truth. Visual-content palettes and themes remain separate in src/lib/visual/themes.ts."
---

# Design System Boundary

TextIQ app chrome uses the `--ds-*` tokens in `src/app/globals.css` as the
source of truth. Visual-content palettes and themes remain separate in
`src/lib/visual/themes.ts`.

## Source Anchors

| Area                     | Source                                                      |
| ------------------------ | ----------------------------------------------------------- |
| Global tokens            | `src/app/globals.css`                                       |
| UI class tokens          | `src/components/ui/tokens.ts`                               |
| UI primitives            | `src/components/ui/`                                        |
| App shell view model     | `src/lib/app-shell/view-model.ts`                           |
| App shell navigation     | `src/lib/app-shell/navigation.ts`                           |
| App shell chrome/theme   | `src/lib/app-shell/chrome.ts`, `src/lib/app-shell/theme.ts` |
| Header visibility gate   | `src/lib/app-shell/header-gate.ts`                          |
| Right-surface reducer    | `src/lib/right-surface-coordinator.ts`                      |
| Anchored float geometry  | `src/lib/anchored-position.ts`                              |
| Pointer/viewport helpers | `src/lib/pointer.ts`, `src/lib/mobile-viewport.ts`          |

## Layers

- `src/app/globals.css` owns app-chrome tokens, the Tailwind `@theme` bridge,
  base typography/prose, layout utilities, dark-mode overrides, and semantic
  z-index utilities.
- `src/components/ui/tokens.ts` owns reusable class tokens such as focus rings,
  gutter buttons, menu/panel chrome, and toolbar control states.
- `src/components/ui/` owns reusable primitives for toolbar buttons, panel
  surfaces, popover sections, field rows, icon action clusters, and status pills.
- Feature components compose these primitives with local layout only.

## App Shell And Responsive Surfaces

The app shell owns navigation, header visibility, account/workspace chrome, and
global utility slots such as keyboard shortcuts. Shell view models are derived
in `src/lib/app-shell/` so pages and components receive UI-ready state instead
of duplicating navigation or account logic.

Right-side editor surfaces are mutually exclusive. The pure
`rightSurfaceReducer` records when the slide editor is open, and
`shouldSuppressFloatPopover` hides the floating visual popover while the slide
editor owns the right side of the screen. This prevents large editor overlays
from competing with contextual popovers.

Floating surfaces use `computeAnchoredPosition` for DOM-free placement. It
implements flip/shift/clamp behavior from plain rects and viewport sizes so the
text toolbar, visual popover, and future anchored surfaces can share the same
collision rules.

Pointer and viewport helpers are shared runtime utilities:

- `queryIsPointerFine` defaults to `true` on the server so first paint shows the
  full control set, then narrows after client pointer detection.
- `queryIsPointerCoarse` and `queryIsWideViewport` keep coarse-pointer and wide
  viewport decisions out of individual components.
- `resolveMobileViewportSize` and `mobileViewportCssVars` expose visual viewport
  dimensions and offsets as CSS variables for mobile browser chrome.

## Guardrails

Run `npm run design-system:check` before UI refactors. It is also part of
`npm run lint`.

The check rejects:

- raw numeric z-index utilities like `z-10` or `z-[999]`; use semantic utilities
  from the Tailwind bridge, such as `z-raised`, `z-canvas`, `z-dropdown`,
  `z-panel`, `z-modal`, `z-menu`, or `z-toast`;
- raw arbitrary hex color classes in feature components, such as
  `bg-[#ffffff]`; add or reuse a semantic token/theme utility instead.

Pick the z tier by **what the surface is**, not by "what it must beat":
canvas/selection-anchored editing overlays use `canvas`; side panels use `panel`;
dialogs use `modal`; menus opened from inside a panel/dialog use `menu`; and
`tooltip` is reserved for the `Tooltip` primitive. The full ordering and the
migration status live in [z-order-plan.md](z-order-plan.md).

Raw palette values are allowed only in token/theme-owned files and visual-content
theme definitions.

High-contrast and forced-colors support is part of the chrome token contract:
critical editor affordances must keep visible outlines, borders, or system-color
fills when `forced-colors: active` disables shadows and translucent surfaces.

## Invariants

1. App chrome uses `--ds-*` tokens; visual content themes stay separate.
2. Shared primitives live under `src/components/ui/`; feature components compose
   them rather than redefining chrome styles.
3. Floating surface geometry is computed through shared helpers, not ad hoc DOM
   math in each component.
4. Right-side surfaces coordinate through the shared reducer before rendering
   competing overlays.
5. Pointer and viewport SSR defaults prefer complete controls on first paint and
   progressively adapt after mount.
6. Forced-colors/high-contrast modes use system colors for app/editor chrome
   tokens, with explicit outlines for focus, selection frames, handles, guides,
   filmstrip active states, mobile sheets, diagnostics, and present-mode HUDs.

## Primary Tests

- `scripts/check-design-system.test.mjs`
- `src/lib/app-shell/view-model.test.ts`
- `src/lib/app-shell/navigation.test.ts`
- `src/lib/app-shell/header-gate.test.ts`
- `src/lib/app-shell/theme.test.ts`
- `src/lib/right-surface-coordinator.test.ts`
- `src/lib/anchored-position.test.ts`
- `src/lib/pointer.test.ts`
- `src/lib/mobile-viewport.test.ts`
