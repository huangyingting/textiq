---
type: "plan"
status: "current"
last_updated: "2026-07-03"
description: "Design and implementation plan for document table editing surfaces, inline captions, and table-specific controls in the Lexical document editor."
---

# Document Table Editing Plan

This plan records the agreed design for table editing in the document editor.
Tables are document-authoring structures, not spreadsheet surfaces. The editor
should make common structure edits easy while keeping text editing, collaboration,
autosave, slide derivation, and export flowing through the existing Lexical
`contentJson` source of truth.

## Decisions

- Table editing is document table editing, not spreadsheet editing. Do not add
  formulas, sorting, filtering, fill handles, or a spreadsheet selection model.
- A table context appears when the caret or table selection is inside a table.
  Non-collapsed text selection inside a table still prioritizes text formatting.
- Table editing participates in the unified `EditingSurface` resolver as a
  `table-edit` group.
- Fine pointers use a floating toolbar anchored to the whole table. Coarse
  pointers use the existing mobile editing bottom sheet.
- The toolbar uses icon buttons with tooltips. Caption editing is not a toolbar
  input.
- The primary toolbar shows table size, header row toggle, add row below,
  delete row, add column right, delete column, and a More menu.
- Deleting the final row or final column is disabled. Deleting the whole table is
  a separate destructive action in the More menu with confirmation.
- Header row toggle is in the primary toolbar. It toggles only the first row;
  deleting the first row does not automatically promote the next row.
- Inline caption is semantic table state stored on `TableNode`, not a detached
  paragraph. Captions are single-line values.
- Captions with content are always visible. Empty caption placeholders are shown
  only while that table is active. Caption focus still counts as table context.
- Keyboard access uses the toolbar pattern: roving tabindex, arrow key movement,
  Home/End, and Escape returning focus to the editor. Caption input handles
  Enter/Escape separately.
- Table-specific keyboard shortcuts are out of scope for this pass.
- Projection, public render, and export read table rows/cells/caption from the
  existing Lexical JSON path. Do not add a parallel table metadata store.
- Table style work is limited to header row toggle in this pass; zebra striping
  and alignment controls are deferred.

## Phase 1: Table Editing Surface

Implement the table editing surface before inline caption work so desktop and
mobile render from the same decision source.

- Extend the editor selection snapshot with table context.
- Extend `resolveEditingSurface` with `table-edit` for fine-pointer floating and
  coarse-pointer sheet modes.
- Refactor table controls to render shared content in both the floating toolbar
  and mobile sheet.
- Replace text row/column buttons with icon buttons and tooltips.
- Add table size state.
- Disable delete row/column when the table has only one row/column.
- Add first-row header toggle.
- Add a More menu with confirmed Delete table.
- Add toolbar keyboard handling with roving tabindex.

## Phase 2: Inline Caption

Move caption editing from the toolbar into semantic inline table chrome.

- Render a native table caption tied to the selected `TableNode` caption field.
- Show caption text whenever it is non-empty.
- Show an empty caption placeholder only while the table is active or the caption
  field is focused.
- Keep caption single-line; normalize pasted newlines to spaces.
- Enter commits caption and returns focus to the editor. Escape blurs and returns
  focus to the editor.
- Keep caption persistence, undo/redo, autosave, projection, and export on the
  existing serialized `TableNode` caption path.

## Acceptance Checks

- A collapsed caret inside a table shows table-edit; a text range inside a table
  shows text-format.
- Desktop table-edit appears as a floating toolbar anchored to the full table.
- Mobile table-edit appears in the bottom sheet.
- Table size, header row toggle, row/column insert/delete, and Delete table work
  through Lexical updates and undo/redo.
- Delete row/column is disabled at one row/column.
- Inline caption persists in `contentJson`, survives round-trip, and is visible
  when non-empty.
- Empty caption placeholder appears only for the active table.
- Focus on the caption keeps table-edit active.
- Existing table caption projection/export tests continue to pass.
