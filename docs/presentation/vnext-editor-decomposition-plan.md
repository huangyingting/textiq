---
type: "plan"
status: "active — final shell collapse pending"
last_updated: "2026-07-02"
description: "Remaining P0 work to finish shrinking SlideEditorVNext by extracting stage gesture handlers and reducing shell-owned layout wiring."
---

# vNext Editor Decomposition Plan

## Priority And Goal

**Priority:** P0.

Finish shrinking `SlideEditorVNext` into a composition shell that wires owned
controllers and descriptors without owning stage edit behavior.

## Remaining Work

| Slice                  | Work                                                                                                                                                                                            | Exit criteria                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Stage gesture handlers | Move remaining marquee, node drag/duplicate, resize, crop, rotation, connector endpoint, keyboard connector, and keyboard shortcut handlers behind owned controllers or narrower stage modules. | Stage gestures still dispatch `editor-commands.ts`, but the shell no longer owns gesture state or handler logic. |
| Stage geometry helpers | Move remaining stage overlay geometry helpers that are coupled to gesture handlers into the same owner as the gesture behavior.                                                                 | Geometry and snapping behavior can be tested without mounting the full editor shell.                             |
| Region layout cleanup  | Reduce shell-owned responsive chrome wiring for filmstrip, toolbar menus, footer status, inspector sheet, diagnostics review, and source review panels.                                         | `SlideEditorVNext` primarily composes regions, passes callbacks, and owns only unavoidable shell refs.           |
| Coverage handoff       | Replace shell-only assertions for moved behavior with focused controller, overlay, adapter, component, or browser tests.                                                                        | Refactors can validate the touched owner without mounting the full editor shell.                                 |

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
