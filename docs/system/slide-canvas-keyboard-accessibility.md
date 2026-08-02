---
type: "adr"
status: "accepted"
last_updated: "2026-08-02"
description: "Architecture decision record for slide canvas keyboard accessibility, roving focus, selection shortcuts, keyboard manipulation, and release-gate evidence boundaries."
---

# 2. Canvas keyboard accessibility for the slide editor

- **Status:** Accepted — direct `SlideEditor` interaction tests cover R1–R3 and
  arbitrary keyboard connector endpoint routing
- **Date:** 2026-06-23
- **Epic:** #517 — Release Gate Automation and Critical Flow E2E Coverage
- **Issue:** #522
- **Supersedes:** —
- **Superseded by:** —

## Context

The presentation slide editor stage (`src/components/presentation/slide-editor.tsx`
plus the shared Deck canvas) is the primary authoring surface for decks. It is
pointer-first: nodes are moved and resized by dragging, and connectors are drawn
by targeting node anchors. The release gate has long tracked a deferred-risk
item for this surface —
`docs/operations/release-gate.md` row **AC-5 "Canvas drag/resize keyboard
parity" (Owner: D / deferred)** — without a written decision recording exactly
which keyboard interactions are required for the next accessibility bar and
which limitations are accepted, with rationale and ownership.

This ADR records that decision so the gate references a concrete, time-bounded
plan rather than an open-ended "deferred" marker.

### Current keyboard support (verified in code)

The canvas already supports a non-trivial keyboard model:

- **Focus.** Every element renders as `role="button"`, `tabIndex={0}`,
  `aria-pressed={selected}` with an accessible name derived from node content
  and type. Native **Tab** moves focus across elements.
  - Current source anchors: `src/components/presentation/slide-canvas.tsx`,
    `src/components/presentation/use-stage-focus-controller.ts`,
    `src/components/presentation/slide-canvas-render.test.ts`.
- **Select.** **Space** selects the focused element; **Shift+Space** toggles it
  into the multi-selection; **Enter** activates it (enters a group, else inline
  edit).
  - Current source anchors: `src/components/presentation/slide-editor.tsx`,
    `src/components/presentation/selection-model.ts`,
    `src/components/presentation/selection-traversal.ts`.
- **Move.** With an element selected, **Arrow** keys nudge it by `1%`;
  **Shift+Arrow** nudges by `5%`.
  - Current source anchors: `src/components/presentation/slide-editor.tsx`,
    `src/lib/presentation/editor-commands.ts`,
    `src/lib/presentation/selection-geometry.ts`.
- **Rotate.** With an element selected, **Shift+[ / ]** rotates it by `1°`
  (`{`/`}` keys in `event.key`), with a live announcement.
  - Current source anchors: `src/components/presentation/slide-editor.tsx`,
    `src/lib/presentation/canvas-keyboard-rotate.ts`,
    `src/components/presentation/slide-editor-toolbar-command-surface.failures.test.ts`.
- **Delete.** **Delete** / **Backspace** removes the selected element(s).
  - Current source anchors: `src/components/presentation/slide-editor.tsx`,
    `src/components/presentation/slide-editor-toolbar-delete.test.ts`.
- **Slide navigation.** **Arrow Left/Right** pages between slides when no
  selected element consumes the arrow.
  - Current source anchor: `src/components/presentation/slide-editor.tsx`.
- **Editor shortcuts.** Escape, undo/redo, duplicate, new slide, select-all,
  copy/cut/paste, group/ungroup are all keyboard-driven.
  - Current source anchors: `src/components/presentation/slide-editor.tsx`,
    `src/lib/shortcuts/catalog-canvas.ts`.
- **Bullets.** **Tab** / **Shift+Tab** changes bullet indent while editing text.
  - Current source anchors: `src/components/presentation/inline-text-editor.tsx`,
    `src/lib/presentation/rich-text.ts`.

### Closed keyboard gaps (verified in code)

- **Keyboard resize is now implemented.** The original gap was closed by the
  R1 work below; current resize behavior lives in the slide editor keyboard
  handler and Deck mutation helpers rather than a standalone legacy stage file.
  - Current source anchors: `src/components/presentation/slide-editor.tsx`,
    `src/lib/presentation/editor-commands.ts`,
    `src/lib/presentation/selection-geometry.ts`.
- **Free-draw keyboard connector authoring is implemented.** Keyboard users can
  create a connector between two selected connectable elements, cycle bound
  endpoint anchors, and press **Enter** on a connector to edit either endpoint.
  **Arrow** / **Shift+Arrow** detaches and moves the active endpoint by `1%` /
  `5%`, **Tab** switches endpoints, and **Enter** or **Escape** exits the mode.
  - Current source anchors: `src/components/presentation/stage-keyboard-interactions.ts`,
    `src/components/presentation/use-stage-gesture-controller.ts`,
    `src/components/presentation/stage-keyboard-interactions.test.ts`,
    `src/components/presentation/slide-editor-keyboard-command-path.test.ts`.
- **Traversal and announcement paths are directly covered.** R2/R3 added
  reading-order traversal, focus restoration, and stage announcements;
  `slide-editor-keyboard-command-path.test.ts` now drives those paths through
  the real editor root and verifies that delayed selection messages cannot
  overwrite newer operation results.
  - Current source anchors: `src/components/presentation/selection-traversal.ts`,
    `src/components/presentation/use-stage-focus-controller.ts`,
    `src/components/presentation/use-stage-interaction-controller.ts`.

## Decision

For the **next accessibility bar** we split the gaps into required work and an
initially accepted connector limitation. All of that work is now delivered, and
the release gate's AC-5 item points at this ADR and its automated evidence.

### Required before the next accessibility bar

- **R1 — Keyboard resize parity.** ✅ **Implemented** (#530). A keyboard user can
  resize a selected element with **Alt+Arrow** (`1%`) / **Alt+Shift+Arrow**
  (`5%`), mirroring the nudge step model; Right/Down grow the right/bottom edge,
  Left/Up shrink them. Clamping (min size + canvas bounds) belongs in pure stage
  geometry helpers and applies through Deck node layout updates. Without this,
  keyboard-only users could not perform a core authoring action (WCAG 2.1.1
  Keyboard).
- **R2 — Deterministic selection traversal + focus restoration.** ✅
  **Implemented** (#531, #532). **Tab / Shift+Tab** select the next / previous
  element in a deterministic reading order (`orderedElementIds` +
  `nextElementId`) while a canvas element has focus, backed by a roving
  tabindex; **Escape** releases canvas focus so users are never trapped. Focus
  is restored to a sensible element after move / resize (the same element),
  delete (`focusTargetAfterDelete` → next/previous survivor, or the canvas
  container), duplicate (the new copy) and group (the group primary).
- **R3 — Selection/operation announcements.** ✅ **Implemented** (#533). A
  visually-hidden `aria-live="polite"` region in the stage announces selection,
  move, resize and delete results (pure `announce*` builders), and focused
  elements show a distinct `focus-visible` outline ring separate from the
  selection style.

A discoverable in-product **keyboard shortcut help dialog** (#535, opened with
`?` or the toolbar keyboard button) documents the full model; its content is the
pure `canvasShortcutHelp` helper in `src/lib/presentation/canvas-shortcut-help.ts`.

**User impact now:** keyboard-only and screen-reader users can focus, select,
move, **resize**, rotate selected nodes, delete, duplicate and group elements,
traverse deterministically, free-draw connector endpoints, and keep their place
after every edit.

### Connector parity completion

- **A1 — Keyboard connector drawing/endpoint editing.** ✅ **Implemented**
  (#534, follow-up to #1574). With exactly two connectable
  elements selected, **C** inserts a connector with default endpoints bound to
  both (facing anchors via `buildConnectorBetween`); with a connector selected,
  **C** / **Shift+C** cycle its end / start endpoint among the candidate anchors
  (`cycleEndpointAnchor`). Pressing **Enter** on a connector enters endpoint edit
  mode. The active endpoint starts at the connector end, **Tab** switches start
  and end, **Arrow** / **Shift+Arrow** moves the active endpoint by `1%` / `5%`,
  and **Enter** or **Escape** exits. The first movement converts a bound endpoint
  to a free point, preserves the opposite endpoint in slide coordinates,
  renormalizes the connector frame, clamps movement to the slide, restores
  focus, and announces every transition.

### Ownership and timing

- **Owner:** Accessibility / QA (Ghost) with the Presentation surface owner.
- **Time-box:** R1–R3 shipped in the canvas keyboard accessibility wave
  (issues #530–#535), followed by keyboard rotation (#1575) and free endpoint
  routing (the gap tracked by #1574). AC-5 now has automated command-path and
  pure-geometry evidence with no deferred keyboard portion.

## Consequences

- The release gate's AC-5 item now points at this ADR; R1–R3 and A1 ship, so the
  former connector warning is removed.
- R1–R3 are additive to the existing keyboard model and pure helper coverage for
  accessible names, nudge/step geometry, selection, and stage state. They do not
  change the persisted Deck schema.
- Automated a11y assertions continue to cover helper and render guarantees
  (`src/lib/a11y/a11y-helpers.test.ts`, `element-accessible-name.test.ts`,
  `src/components/presentation/selection-traversal.test.ts`,
  `src/components/presentation/slide-canvas-render.test.ts`,
  `src/lib/presentation/canvas-keyboard-rotate.test.ts`,
  `src/lib/presentation/canvas-shortcut-help.test.ts`,
  `src/components/presentation/slide-editor-toolbar-command-surface.failures.test.ts`).
  Direct `SlideEditor` coverage in
  `src/components/presentation/slide-editor-keyboard-command-path.test.ts`
  additionally verifies reading-order Tab traversal, keyboard move/resize and
  rotation, free connector endpoint routing, deletion focus restoration, and
  durable operation announcements. Pure connector geometry coverage verifies
  bound-to-free conversion, frame renormalization, and slide-bound clamping.

## Implementation issues (delivered)

The wave delivered these (status in parentheses):

1. **Keyboard resize for slide elements** — Alt+Arrow / Alt+Shift+Arrow resize
   the selected element box using the nudge step model (#530 R1 — ✅ shipped).
2. **Deterministic canvas selection traversal (roving tabindex + next/previous)**
   — Tab / Shift+Tab select next/previous without relying on raw DOM order
   (#531 R2 — ✅ shipped).
3. **Focus restoration after canvas mutations** — keep a sensible element focused
   after move/resize/delete/duplicate/group (#532 R2 — ✅ shipped).
4. **Selection and move/resize screen-reader announcements** — visible focus +
   `aria-live` updates for selection and operation results (#533 R3 — ✅ shipped).
5. **Keyboard connector create/endpoint editing** — connect two selected
   elements, cycle bound anchors, and free-draw either endpoint with keyboard
   movement (#534 A1 and the gap tracked by #1574 — ✅ shipped).
6. **In-product canvas keyboard shortcut help** — surface the keyboard model in
   the slide editor help overlay (#535 — ✅ shipped).
7. **Keyboard rotation for SlideEditor** — rotate selected nodes with
   **Shift+[ / ]** and announce the new angle (#1575 — ✅ shipped).

## Rollback

If endpoint edit mode regresses, remove the mode and restore AC-5 as an explicit
release warning while preserving the existing connector insertion and bound
anchor cycling paths. Do not change the persisted Deck schema for that rollback.
