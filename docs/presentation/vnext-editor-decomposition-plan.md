---
Type: "plan"
Status: "active — region layout cleanup pending"
Last updated: "2026-07-02"
description: "Remaining P0 work to finish shrinking SlideEditorVNext by extracting stage gesture handlers and reducing shell-owned layout wiring."
---

# vNext Editor Decomposition Plan

## Priority And Goal

**Priority:** P0.

Finish shrinking `SlideEditorVNext` into a composition shell that wires owned
controllers and descriptors without owning stage edit behavior.

## Completed Work

- 2026-07-02: Extracted remaining stage gesture handlers into
  `use-stage-gesture-controller.ts` while keeping mutations routed through
  `editor-commands.ts`.
- 2026-07-02: Moved stage overlay geometry math into
  `stage-overlay-geometry.ts` with focused public unit coverage.

## Remaining Work

| Slice                 | Work                                                                                                                                                    | Exit criteria                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Region layout cleanup | Reduce shell-owned responsive chrome wiring for filmstrip, toolbar menus, footer status, inspector sheet, diagnostics review, and source review panels. | `SlideEditorVNext` primarily composes regions, passes callbacks, and owns only unavoidable shell refs. |
| Coverage handoff      | Replace shell-only assertions for moved behavior with focused controller, overlay, adapter, component, or browser tests.                                | Refactors can validate the touched owner without mounting the full editor shell.                       |

## Constraints

- No DeckV7 schema changes.
- No legacy v6 bridge, conversion layer, or flat `groupId` element model.
- No visual redesign of the editor chrome.
- No wholesale port of the legacy stage editor.
- No change to AI generation defaults unless product explicitly decides so.

## Verification

Run the smallest checks for each implementation slice:

```bash
npx prettier --write <touched files>
npx eslint <touched lintable files>
npm run test:unit -- <focused presentation test files>
npm run test:presentation
npm run typecheck
```
