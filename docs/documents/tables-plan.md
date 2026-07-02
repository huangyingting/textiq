---
type: "plan"
status: "active — authoring controls pending"
last_updated: "2026-07-02"
description: "Remaining plan for document table authoring controls. Table parsing, extraction, projections, source references, and presentation mapping are implemented; row/column controls and caption editing remain pending."
---

# Document Table Authoring Controls Plan

First-class document table infrastructure is implemented. `@lexical/table` is
registered, simple table insertion works, table blocks extract as
`DocumentTableBlock`, and table content participates in plain text, search,
export, source references, staleness, AI deck context, deterministic slide
derivation, and vNext source refresh.

This plan now tracks only the remaining document-editor authoring controls.

## Remaining Work

| Slice               | Work                                                                                                                      | Exit criteria                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Row/column controls | Add document-editor UI for inserting and deleting table rows and columns, using Lexical table primitives where available. | Users can add/remove rows and columns without editing serialized content or reimporting tables. |
| Caption editing     | Add an explicit caption editing surface for document tables and persist it through the existing table block extraction.   | Users can set, update, clear, autosave, and re-open a table caption from the editor UI.         |
| Authoring tests     | Cover the remaining controls in focused editor/document tests.                                                            | Tests prove row/column mutation, caption persistence, undo/redo, and serialization round-trip.  |

## Constraints

- Keep document table schema independent from presentation `TableElement`.
- Do not add spreadsheet behavior: formulas, sort/filter, range operations,
  merged-cell editing, nested tables, or per-cell style panels.
- Do not infer captions from nearby paragraphs; captions must come from explicit
  table metadata or the caption editing surface.
- Preserve the current projection behavior for plain text, search, export, AI,
  source references, and presentation mapping.

## Validation

- `npm run test:subsystem -- documents`
- `npm run test:subsystem -- editor`
- `npm run test:subsystem -- import`
- `npm run test:subsystem -- presentation`
- `npm run typecheck`
- `npm run docs:check`
