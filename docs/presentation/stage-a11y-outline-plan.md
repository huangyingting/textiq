---
type: "plan"
status: "active — P2 audit, awaiting leaf-issue scheduling"
last_updated: "2026-07-02"
description: "Audits the vNext slide stage content-first accessibility gap and plans a screen-reader deck outline with per-node narration."
---

# Stage Accessibility Outline Plan

## Priority And Goal

**Priority:** P2.

**Goal:** define the content-first semantics the vNext presentation stage should
expose to screen-reader users without reworking the shipped keyboard editing
model. The target experience is an accessible deck outline / reading-order view
that lets users understand slide structure before or while using the interactive
canvas.

## Current State

The stage currently exposes an interaction-first editing surface rather than a
content-first deck outline.

- `SlideCanvasVNextProps` is organized around editing actions and focus state:
  selection, double-click, pointer-down, resize, crop, rotate, connector endpoint
  dragging, table cell editing, hover, selected slide state, roving focus, and the
  focus geometry registry are all first-class props
  (`src/components/presentation-vnext/slide-canvas.tsx:93-180`).
- The canvas renders background chrome, then user nodes, then foreground chrome;
  user nodes become interactive only when pointer editing is enabled, receive
  roving `tabIndex`, and are wired to pointer/focus/table-edit handlers
  (`src/components/presentation-vnext/slide-canvas.tsx:320-373`). There is no
  parallel structural list of slides or nodes in this render path.
- Node containers expose editing semantics: an interactive node is a `button`, or
  a `group` while table cells are being edited, with `aria-pressed`,
  `aria-disabled`, and an `aria-label` from `accessibleNodeName(node)`
  (`src/components/presentation-vnext/slide-node-renderer.tsx:1108-1128`).
- Table rendering uses a visual `<table>` for content, but editable cells become
  `contentEditable` focus targets with `role="textbox"` and position-only labels
  such as `Table cell row 1, column 1`
  (`src/components/presentation-vnext/slide-node-renderer.tsx:647-730`).
- Image and visual placeholders have basic fallback labels when media is missing,
  such as alt text, visual id, or placeholder text
  (`src/components/presentation-vnext/slide-node-renderer.tsx:548-565`,
  `src/components/presentation-vnext/slide-node-renderer.tsx:768-780`).
- The shipped keyboard model already covers focus, select, move, resize, rotate,
  delete, duplicate, grouping, deterministic traversal, and place retention after
  edits (`docs/system/slide-canvas-keyboard-accessibility.md:116-118`).
- The accepted limitation recorded for connector drawing is free-draw connector
  authoring: keyboard users can create/rebind via `C` / `Shift+C`, while arbitrary
  free-draw routing is pointer-only
  (`docs/system/slide-canvas-keyboard-accessibility.md:122-133`). Issue #1574 is
  closed and connector free-draw authoring is explicitly out of scope for this
  spike.

## Content-First Semantics Gap Audit

The current DOM is suitable for editing gestures, but it does not answer the
screen-reader-first questions a slide deck raises:

1. **Where am I in the deck?** The stage has no accessible deck landmark or list
   that announces slide count, current slide position, slide title, or slide
   summary.
2. **What is the slide's reading order?** User nodes are rendered in canvas
   layering order and navigated through the editing focus model. That order may
   not match a content reading order, and it is not presented as a stable ordered
   outline.
3. **What does each node mean as content?** Interactive node labels are derived
   for editing focus, but the stage does not expose a richer narration containing
   node role, content preview, alt text, table dimensions, chart/visual identity,
   connector relationship, or decorative/chrome status.
4. **How are nodes related?** Groups, connectors, tables, and visuals are not
   narrated as relationships in a content outline. A connector can be selected or
   rebound, but the content-first story should say what it connects when that is
   knowable.
5. **What should be skipped?** Background and foreground deck chrome render
   around user nodes, but the outline needs explicit rules for decorative chrome,
   hidden nodes, locked nodes, placeholders, and empty shapes.
6. **What is the screen-reader mode boundary?** Editing controls and reading
   structure are currently mixed in the same stage. The plan should avoid
   replacing mature keyboard editing; instead, add a discoverable reading-order
   representation that can coexist with the canvas.

## Accessible Deck Outline / Reading-Order View Design

Add a screen-reader-oriented outline model that can be rendered as semantic DOM
near the stage, hidden visually when appropriate but available to assistive
technology. The outline should be generated from resolved slide render trees, not
from ad-hoc DOM scraping.

Recommended structure:

```text
Deck outline region
└─ Slide list
   ├─ Slide 1 of N: <slide title or fallback>
   │  └─ Node list, reading order
   │     ├─ Text: <preview>
   │     ├─ Image: <alt text or missing-alt warning>
   │     ├─ Table: <caption/title>, R rows by C columns
   │     ├─ Shape: <semantic role>, <text preview if present>
   │     ├─ Visual: <visual title/type>
   │     └─ Connector: connects <source label> to <target label>
   └─ Slide 2 of N: ...
```

Implementation follow-up should define a small outline adapter with these
properties:

- **Slide list:** expose deck position, current slide, slide title, and a concise
  slide summary. If only the active slide is mounted, the outline can initially
  render the active slide while the model API remains deck-capable.
- **Node list:** order nodes by the same reading-order field used by export or
  presentation narration once one exists; until then, use a documented fallback
  based on authored user-node order with chrome excluded.
- **Roles:** map nodes to content roles such as text, image, shape, table, visual,
  connector, group, or decorative. Do not reuse editing roles like `button` as
  the content role.
- **Labels:** expose one concise label per outline item, plus optional detail text
  for tables, connectors, and visuals.
- **Selection bridge:** when the editor canvas has a selected/focused node, mark
  the corresponding outline item as current or selected without moving focus away
  from the editing surface.
- **Mode boundary:** the outline is for reading and orientation. Editing actions
  remain in the canvas keyboard model and existing inspector/toolbar controls.

## Per-Node Accessible Names

Per-node names should be content-derived and deterministic. Proposed fallback
order:

| Node kind         | Accessible name source                                                         | Required checks                                                                                               |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Text              | Trimmed text preview from runs or plain text; truncate after a short sentence. | Empty text announces `Empty text box`; preserve reading order.                                                |
| Image             | Author-provided alt text.                                                      | Missing alt text announces `Image, missing alt text`; decorative images must be explicitly marked decorative. |
| Shape             | Shape role/type plus embedded text preview when present.                       | Empty decorative shapes should be skippable or announced as decorative only.                                  |
| Table             | Caption/title when available, then dimensions and first header labels.         | Editable cell labels should include header context when available, not only row/column numbers.               |
| Visual/chart      | Visual title, type, and source label; alt text if provided.                    | Missing visual description is flagged for authoring follow-up.                                                |
| Connector         | Connector type plus source and target node labels when endpoints resolve.      | Unbound endpoints announce `unbound start/end`; free-draw authoring remains out of scope.                     |
| Group             | Group label plus child count and summarized child roles.                       | Children remain discoverable in reading order unless the group is intentionally flattened.                    |
| Chrome/decorative | Explicit decorative label or omission from outline.                            | Background/foreground deck chrome should not pollute the content outline.                                     |

The existing `accessibleNodeName(node)` path can inform labels, but the outline
should have its own content semantics helper so editing labels and narration can
diverge when needed.

## Reduced-Motion And Focus-Visible Checks

Follow-up implementation should add release-gate checks for:

- **Reduced motion:** stage focus movement, selection transitions, outline-current
  updates, and any announce-on-selection behavior must respect
  `prefers-reduced-motion`. Motion used only to orient sighted keyboard users
  should have a non-motion alternative for screen-reader users.
- **Focus visible:** every keyboard-focusable stage node, table cell, outline
  entry, and mode-switch control must have a visible focus indicator with
  sufficient contrast in normal, selected, locked, grouped, and high-contrast
  states.
- **Announcement stability:** changing selection or entering table edit mode must
  not trigger repeated or stale live-region announcements.
- **Release-gate acceptance criteria:** add a content-first semantics checkpoint
  requiring a deck/slide outline, per-node content labels, missing-alt/missing
  visual-description warnings, reduced-motion conformance, and focus-visible
  verification before accessibility sign-off.

## Proposed Leaf Issues

Do not create these issues as part of the spike; schedule them as follow-ups.

1. **Build resolved slide outline adapter.** Convert `ResolvedSlideRenderTree`
   user nodes into a stable content outline with slide metadata, node roles,
   reading order, labels, and decorative/chrome filtering.
2. **Render accessible deck outline region.** Add semantic DOM for the active deck
   or active slide outline, including slide list and ordered node list, without
   disrupting the existing canvas keyboard interaction model.
3. **Implement per-node content narration helper.** Derive text previews, alt
   labels, table summaries, visual labels, connector relationships, and group
   summaries with deterministic fallbacks and missing-content warnings.
4. **Improve table cell accessible names.** When table edit mode is active,
   include row/column header context and cell content preview in cell labels while
   preserving current keyboard behavior.
5. **Add reduced-motion and focus-visible checks.** Cover stage node focus,
   outline focus/current states, selection changes, table edit mode, locked nodes,
   and high-contrast states.
6. **Update release-gate accessibility acceptance criteria.** Add explicit
   content-first semantics criteria and link focused component/a11y tests that
   prove the outline and narration behavior.

## Verification And Out Of Scope

**Verification for follow-ups:** use focused accessibility/component tests for the
outline adapter, rendered outline DOM, per-node names, table cell labels,
reduced-motion behavior, and focus-visible states. Update the release-gate
checklist when implementation lands.

**Out of scope:** reworking the shipped keyboard interaction model, changing
canvas pointer/keyboard editing semantics, export behavior, and free-draw
connector authoring. Connector create/reattach and free-draw limitations are not
part of this spike.
