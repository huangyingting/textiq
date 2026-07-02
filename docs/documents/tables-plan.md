---
type: "plan"
status: "completed"
last_updated: "2026-07-02"
description: "Document table authoring controls are implemented, including row/column controls and explicit caption editing metadata."
---

# Document Table Authoring Controls Plan

First-class document table infrastructure is implemented. `@lexical/table` is
registered, simple table insertion works, table blocks extract as
`DocumentTableBlock`, and table content participates in plain text, search,
export, source references, staleness, AI deck context, deterministic slide
derivation, and vNext source refresh.

This plan records the completed document-editor table authoring controls.

## Completed Work

| Slice               | Work                                                                                                                 | Exit criteria                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Row/column controls | Added document-editor UI for inserting and deleting table rows and columns, using Lexical table primitives.          | Users can add/remove rows and columns without editing serialized content or reimporting tables. |
| Caption editing     | Added an explicit caption editing surface for document tables and persisted captions through table block extraction. | Users can set, update, clear, autosave, and re-open a table caption from the editor UI.         |

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
