---
Type: "plan"
Status: "completed"
Last updated: "2026-07-02"
description: "Completed P0 work that shrank SlideEditorVNext by extracting stage gesture handlers, geometry, and shell-owned layout wiring."
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
- 2026-07-02: Extracted editor chrome owners for inspector/add-slide/dialog
  regions, footer/status chrome, toolbar slide deletion, and editor stage-fit
  helpers. Moved shell-only assertions for those behaviors to focused owner
  tests.

## Completed Slices

| Slice                 | Work                                                                                                                                                 | Exit criteria                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Region layout cleanup | Reduced shell-owned responsive chrome wiring for inspector sheet, add-slide dialog, diagnostics review, footer status, and editor stage-fit helpers. | `SlideEditorVNext` primarily composes regions, passes callbacks, and owns only unavoidable shell refs. |
| Coverage handoff      | Replaced shell-only assertions for moved behavior with focused toolbar action, footer, stage-fit, and inspector-region owner tests.                  | Refactors can validate the touched owner without mounting the full editor shell.                       |

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
