---
type: "adr"
status: "accepted with release-gate caveat"
last_updated: "2026-07-04"
description: "Architecture decision record for slide canvas keyboard accessibility, roving focus, selection shortcuts, keyboard manipulation, and release-gate evidence boundaries."
---

# 2. Canvas keyboard accessibility for the slide editor

- **Status:** Accepted with release-gate caveat — R1–R3 behavior exists in presentation
  source, but AC-5 remains deferred until direct `SlideEditor` keyboard
  interaction tests are wired into release-gate evidence
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

### Remaining keyboard caveats (verified in code)

- **Keyboard resize is now implemented.** The original gap was closed by the
  R1 work below; current resize behavior lives in the slide editor keyboard
  handler and Deck mutation helpers rather than a standalone legacy stage file.
  - Current source anchors: `src/components/presentation/slide-editor.tsx`,
    `src/lib/presentation/editor-commands.ts`,
    `src/lib/presentation/selection-geometry.ts`.
- **Free-draw keyboard connector authoring remains deferred.** Keyboard users can
  create a connector between two selected connectable elements and cycle
  endpoint anchors, but arbitrary free-draw connector routing remains pointer
  only and is tracked by A1.
  - Current source anchors: `src/components/presentation/stage-keyboard-interactions.ts`,
    `src/lib/presentation/connector-geometry.ts`.
- **Traversal and announcement gaps are now narrowed.** R2/R3 added reading-order
  traversal, focus restoration, and stage announcements; direct end-to-end
  `SlideEditor` keyboard interaction coverage remains the release-gate caveat.
  - Current source anchors: `src/components/presentation/selection-traversal.ts`,
    `src/components/presentation/use-stage-focus-controller.ts`,
    `src/components/presentation/use-stage-interaction-controller.ts`.

## Decision

For the **next accessibility bar** we split the gaps into **required** work
(blocks the next a11y sign-off) and **accepted** limitations (documented,
deferred with rationale and a revisit point). The release gate's AC-5 item is
re-pointed at this ADR.

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
traverse deterministically, and keep their place after every edit.

### Accepted limitations (deferred with rationale)

- **A1 — Keyboard connector drawing/reattachment.** 🟡 **Partially implemented**
  (#534). The accessible interim path now ships: with exactly two connectable
  elements selected, **C** inserts a connector with default endpoints bound to
  both (facing anchors via `buildConnectorBetween`); with a connector selected,
  **C** / **Shift+C** cycle its end / start endpoint among the candidate anchors
  (`cycleEndpointAnchor`). **Still deferred:** free-draw connector authoring
  with arbitrary routing remains pointer-only and is tracked in #1574. **User
  impact:** keyboard users can connect and rebind elements but cannot free-draw
  an arbitrary path; mitigated by default-endpoint insertion + anchor cycling +
  nudging.
  These limitations remain recorded as release-gate **AC-5** warnings (Part 3 of
  `docs/operations/release-gate.md`) until #1574 is closed.

### Ownership and timing

- **Owner:** Accessibility / QA (Ghost) with the Presentation surface owner.
- **Time-box:** R1–R3 shipped in the canvas keyboard accessibility wave
  (issues #530–#535), together with the A1 interim subset (connector
  create/reattach). Free-draw connector authoring (#1574) is revisited in a
  later wave; AC-5 stays an explicit, signed-off release warning for that
  remaining gap.

## Consequences

- The release gate's AC-5 item now points at this ADR; R1–R3 ship and AC-5 is a
  narrowed warning covering only the accepted A1 free-draw limitation (#1574).
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
  Broader direct `SlideEditor` keyboard interaction coverage for AC-5 is
  still pending.

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
5. **Keyboard connector create/reattach** — connect two selected elements and
   rebind endpoints to anchors via keyboard (#534 A1 — 🟡 interim subset shipped;
   free-draw tracked in #1574).
6. **In-product canvas keyboard shortcut help** — surface the keyboard model in
   the slide editor help overlay (#535 — ✅ shipped).
7. **Keyboard rotation for SlideEditor** — rotate selected nodes with
   **Shift+[ / ]** and announce the new angle (#1575 — ✅ shipped).

## Rollback

This ADR is documentation. If the required scope proves infeasible in the
targeted wave, the rollback is to keep AC-5 as an explicit, signed-off release
warning (Part 3 of the release gate) and re-time R1–R3 — no code change is
required to revert.
