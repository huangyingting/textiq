---
type: "plan"
status: "active — shell collapse pending"
last_updated: "2026-07-02"
description: "Remaining P0 plan to finish shrinking SlideEditorVNext. Controller, descriptor, overlay, focus registry, and inline text slices are implemented; table direct-edit ownership and final shell collapse remain pending."
---

# vNext Editor Decomposition Plan

## Priority And Goal

**Priority:** P0.

Finish shrinking `SlideEditorVNext` into a composition shell that wires owned
controllers and descriptors without owning stage edit state. Behavior must
remain unchanged unless a slice explicitly records a product decision.

The major extraction slices are implemented: current-object descriptors,
`useStageInteractionController`, overlay extraction, focus/geometry registry,
inline text adapter, and source/diagnostic review descriptors. The production
shell is still about 5.5k lines, so the plan remains active.

## Remaining Work

| Slice                   | Work                                                                                                                               | Exit criteria                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Table direct edit owner | Move remaining table direct-edit state and handlers out of the canvas render surface into an owned controller or overlay boundary. | `SlideCanvasVNext` can stay render-focused; table editing dispatches command payloads through an owner. |
| Final shell collapse    | Delete obsolete editor-local state and inline handlers after the equivalent controller/component tests exist.                      | `SlideEditorVNext` is primarily composition, callback wiring, and region layout.                        |
| Coverage handoff        | Replace any remaining shell-only assertions for moved behavior with focused controller, overlay, adapter, or component tests.      | Refactors can validate the touched owner without mounting the full editor shell.                        |

## Current Boundary Requirements

- Stage gestures still dispatch through `editor-commands.ts`.
- Toolbar, popover, inspector, source review, and diagnostics actions continue
  to derive from shared descriptors.
- Present/export output remains read-only and independent of editor-only overlay
  state.
- Focus restoration and live messages continue to use registered stage and UI
  elements rather than ad hoc DOM queries as the source of truth.

## Out of scope

- No DeckV7 schema changes.
- No legacy v6 bridge, conversion layer, or flat `groupId` element model.
- No visual redesign of the editor chrome.
- No wholesale port of the legacy stage editor.
- No required single-gesture connector draw; that remains an optional UX
  improvement after the state machine exists.
- No change to AI generation defaults; faithful document-derived generation
  remains the recommended default unless product decides otherwise.

## Acceptance checks

- `SlideEditorVNext` becomes a composition shell: it renders regions and passes
  controllers/actions, but no longer owns pointer state, focus querying, or
  inspector command derivation.
- Stage interaction behavior remains compatible with current selection,
  deterministic select-under/layer fallback, double-click text edit, and
  connector behavior.
- Inspector preserves compatible panels when the selected node changes; it does
  not close panels merely because selection changed.
- Toolbar, popover, and inspector actions are derived from one current-object
  command surface.
- Present/export output remains read-only and does not depend on editor-only
  overlay state.
- Tests move from React-internals mocking toward controller, component, and
  behavior acceptance coverage.

## Verification

Run the smallest checks for touched files in each implementation slice:

```bash
npx prettier --write <touched files>
npx eslint <touched lintable files>
npm run test:unit -- <focused presentation test files>
npm run test:presentation
npm run typecheck
```

Use `npm run typecheck` when controller extraction touches shared props, command
contracts, or generated Next types. Broaden beyond `npm run test:presentation`
only when a slice changes shared document, visual, export, or public-render
contracts.
