---
type: "architecture"
status: "current"
last_updated: "2026-07-03"
description: "The document editor pairs a Lexical rich-text surface with visual blocks and document table editing, plus context-aware surfaces such as floating toolbars, a mobile bottom sheet, insert menus, and per-visual editing popovers. This document explains how those pieces fit together and how to extend them safely."
---

# Document Editor Architecture

The document editor pairs a Lexical rich-text surface with **visual blocks**
(flowcharts, mind maps, charts, …), document **table editing**, and a set of
**context-aware surfaces** (floating text/table toolbars, a mobile bottom
sheet, a `+`/`/` insert menu, and a per-visual editing popover). This document
explains how those pieces fit together and how to extend them safely.

## Overview & goals

The editor is built around three ideas:

1. **One place derives selection state.** Every contextual surface reads the
   same read-only [`EditorContextSnapshot`](../../src/lib/lexical/editor-context.tsx)
   instead of running its own `selectionchange` listener or rect math.
2. **Tools are data, not bespoke components.** Each editing affordance
   (bold, "Heading 2", "Insert flowchart") is a declarative
   [`EditorTool`](../../src/lib/lexical/tool-registry.ts) entry. Surfaces render
   the subset of tools whose `when()` predicate matches the current snapshot.
3. **Chrome and content are separate.** App chrome is themed with the `--ds-*`
   design-system tokens; visual _content_ colors live in the `Visual` payload
   and are independent of the chrome.

The result: adding a formatting tool, a visual kind, or a theme is a small,
local change — usually one object literal — and never requires touching a
surface's rendering or selection logic.

## Architecture

```mermaid
flowchart TD
  subgraph editor["Lexical editor (contentJson = source of truth)"]
    state["EditorState / selection"]
  end

  state -->|"read-only derivation"| ctx["EditorContextProvider<br/>readSelectionDescriptor()"]

  ctx -->|"useEditorContext() snapshot"| resolver["useEditingSurface()<br/>resolveEditingSurface()<br/>→ { mode, group }"]
  inputs["pointer · selection"] -->|runtime inputs| resolver

  resolver -->|"mode=float · text"| toolbar["FloatingTextToolbar"]
  resolver -->|"mode=float · table"| tableToolbar["FloatingTableToolbar"]
  resolver -->|"mode=sheet"| sheet["MobileEditingSheet"]

  ctx -->|snapshot| menu["Insert menu (+ / /)"]
  ctx -->|snapshot| vpop["VisualContextPopover"]

  registry["ToolRegistry<br/>toolsFor(group, ctx)"]
  registry --> toolbar
  registry --> sheet
  registry --> menu

  toolbar -->|"tool.run(editor, ctx)"| cmds["Lexical commands / editor.update()"]
  tableToolbar -->|"runDocumentTableControl(editor, action)"| cmds
  sheet -->|"tool.run(editor, ctx)"| cmds
  menu -->|"tool.run(editor, ctx)"| cmds
  vpop -->|"transform(visual) → node.setVisual()"| cmds
  cmds --> state

  ui["src/components/ui/ primitives<br/>(Surface, Button, FloatingSurface, …)"] -.renders.-> toolbar
  ui -.renders.-> tableToolbar
  ui -.renders.-> sheet
  ui -.renders.-> menu
  ui -.renders.-> vpop
```

**Selection flows one way** (editor → snapshot → surfaces); **mutations flow
back through Lexical** (surface → command/`editor.update()` → editor state).

### EditorContext — the one derivation point

[`src/lib/lexical/editor-context.tsx`](../../src/lib/lexical/editor-context.tsx)
owns all selection derivation.

- `EditorContextProvider` subscribes **once** to Lexical's update lifecycle
  (`registerUpdateListener` + `SELECTION_CHANGE_COMMAND` + the DOM
  `selectionchange` event for native-range rects), computes an
  `EditorContextSnapshot`, and exposes it via React context.
- `useEditorContext()` returns the current snapshot. Surfaces call this and
  nothing else — they never read `$getSelection()` themselves.
- `readSelectionDescriptor()` is the pure derivation: run inside an
  `editorState.read(...)` it returns the rect-free subset of the snapshot. It is
  exported so the logic can be unit-tested headlessly; the provider calls it
  identically.

Key `EditorContextSnapshot` fields (authoritative type:
[`selection-snapshot.ts`](../../src/lib/lexical/selection-snapshot.ts)):

| Field                   | Meaning                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `kind`                  | `range` \| `collapsed` \| `empty-block` \| `visual` \| `table` \| `none` |
| `editable`              | mirrors `editor.isEditable()`                                            |
| `isCollapsed`           | whether the active range selection is collapsed                          |
| `blockType`             | `paragraph`/`h1`/`h2`/`h3`/`quote`/`bullet`/`number`                     |
| `activeFormats`         | `Set` of active inline formats (bold/italic/…/code)                      |
| `elementFormat`         | block alignment (`""` = inherited/left)                                  |
| `textColor`             | inline text color style (`""` when unset)                                |
| `highlightColor`        | inline highlight color style (`""` when unset)                           |
| `isLink`                | selection sits within a link                                             |
| `blockKey`              | **live, transient** key of the active block                              |
| `blockBid`              | **stable** durable `bid` of the active block                             |
| `blockText`             | text content of the active block                                         |
| `selectionText`         | text content of the active selection                                     |
| `selectionEndBlockKey`  | **live, transient** key of the range end block                           |
| `selectionEndBlockBid`  | **stable** durable `bid` of the range end block                          |
| `isEmptyBlock`          | active block has no text/content                                         |
| `selectedVisualId`      | **stable** id of a selected `VisualNode` (safe to persist)               |
| `selectedVisualNodeKey` | **live, transient** key of that node                                     |
| `selectedTableNodeKey`  | **live, transient** key of the active `TableNode`                        |
| `rects`                 | `selection` + `block` `DOMRect` snapshots for positioning                |

The provider is read-only: it never calls `editor.update()`, never touches Yjs,
and the only NodeKeys it exposes (`blockKey`, `selectedVisualNodeKey`) are
_live, transient_ keys meant for an immediate `editor.update()` — they are never
stored.

### ToolRegistry — data-driven tools

[`src/lib/lexical/tool-registry.ts`](../../src/lib/lexical/tool-registry.ts)
defines the `EditorTool` model and a small registry.

An `EditorTool` declares:

- `id`, `group`, `label`, optional `icon`/`shortcut`/`section`/`description`/`keywords`.
- `when(ctx)` — **pure**: is the tool visible for this snapshot?
- `isActive?(ctx)` — **pure**: is it currently toggled on?
- `control?: "button" | "color"`:
  - **button** tools provide `run(editor, ctx)` — mutate via Lexical
    commands / `editor.update()`.
  - **color** tools provide `value(ctx)` (read the current color from the
    snapshot) and `apply(editor, value)` (write an inline style via
    `$patchStyleText`).

`EditorToolGroup` partitions registry tools by surface: `text-format`,
`block-insert`, `visual-insert`, `visual-edit`, `visual-style`. This is
separate from `EditingSurfaceGroup` in
[`editing-surface.ts`](../../src/lib/lexical/editing-surface.ts), which adds
`overall` for document-level adjustments when no contextual selection owns the
surface.

Most text/insert/visual surfaces consume the registry through
`toolsFor(group, ctx)`, which returns the visible tools in registration order:

- [`floating-text-toolbar.tsx`](../../src/app/app/documents/%5Bid%5D/floating-text-toolbar.tsx)
  renders `toolsFor("text-format", ctx)` as icon buttons above a non-collapsed
  selection.
- [`insert-menu.tsx`](../../src/app/app/documents/%5Bid%5D/insert-menu.tsx)
  renders `toolsFor("block-insert", ctx)` and `toolsFor("visual-insert", ctx)`
  as grouped, filterable rows in the `+`/`/` menu.

Both surfaces are dumb renderers: they own positioning and keyboard handling but
delegate all behavior to `tool.run(...)` / `tool.apply(...)`.

Document table editing is not registry-driven because table controls need richer
table-local state (row/column counts, final-row/final-column guards, and header
row state) from [`table-controls.ts`](../../src/lib/lexical/table-controls.ts).
The desktop and mobile table surfaces still follow the same selection and
mutation rule: selection is derived once, and mutations flow back through
Lexical updates.

### Unified EditingSurface resolver

[`src/lib/lexical/editing-surface.ts`](../../src/lib/lexical/editing-surface.ts)
is the single, pure decision source for which contextual surface renders which
content. Shipped as part of epic #87 ("surface unification"), it replaces the
per-surface ad-hoc visibility checks that previously lived in
`FloatingTextToolbar` and `VisualContextPopover`.

#### Inputs

The resolver takes two inputs — both gathered by the React bridge
[`useEditingSurface()`](../../src/app/app/documents/%5Bid%5D/use-editing-surface.ts):

| Input           | Source                                                 | Values                                           |
| --------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `pointerFine`   | `useIsPointerFine()` — `matchMedia("(pointer: fine)")` | `true` \| `false`                                |
| `selectionKind` | `selectionKindFromContext(useEditorContext().kind)`    | `"range"` \| `"visual"` \| `"table"` \| `"none"` |

`useIsPointerFine` defaults to `true` on the server (SSR) so the initial render
is fully populated; it resolves the real value on the first client render
(progressive enhancement).

#### Group

Before deciding the mode, the resolver maps `selectionKind` to a **content
group** via `groupForSelectionKind()`:

| `selectionKind` | `group`         | Surface content                                        |
| --------------- | --------------- | ------------------------------------------------------ |
| `"range"`       | `"text-format"` | Text formatting tools (`toolsFor("text-format", ctx)`) |
| `"visual"`      | `"visual-edit"` | Visual restyle controls (`VisualContextSection`)       |
| `"table"`       | `"table-edit"`  | Document table controls (`TableEditingSection`)        |
| `"none"`        | `"overall"`     | Document-level adjustments (`OverallAdjustmentsPanel`) |

The `group` is always returned even when `mode === "none"`, so callers know
what _would_ render.

`selectionKindFromContext()` maps the full `EditorContextKind` to the coarser
split: `"range"` → `"range"`, `"visual"` → `"visual"`, `"table"` → `"table"`,
and everything else (`"none"`, `"empty-block"`, `"collapsed"`) → `"none"`.
Text range selections inside table cells keep `"range"` priority; collapsed
carets or table selections inside a table become `"table"`.

#### Modes

`resolveEditingSurface()` returns one of three modes:

| Mode      | Where it renders                                                              |
| --------- | ----------------------------------------------------------------------------- |
| `"float"` | Anchored popover for text selections, selected visuals, or active tables      |
| `"sheet"` | Slide-up bottom sheet for text selections, selected visuals, or active tables |
| `"none"`  | No contextual surface; document-level controls live in the top chrome         |

#### Precedence rules (R1 → R3)

The resolver applies three rules in strict order, short-circuiting on the first
match:

| Rule   | Condition                                  | Result    |
| ------ | ------------------------------------------ | --------- |
| **R1** | `selectionKind === "none"`                 | `"none"`  |
| **R2** | text/visual/table context + fine pointer   | `"float"` |
| **R3** | text/visual/table context + coarse pointer | `"sheet"` |

Document-level adjustments are intentionally excluded from contextual surfaces;
they are opened from the top toolbar.

The function is total over its 2 × 4 = 8 input combinations and is
exhaustively covered by
[`editing-surface.test.ts`](../../src/lib/lexical/editing-surface.test.ts).

### Document table editing

Tables are document-authoring structures, not spreadsheet surfaces. The editor
does not provide formulas, sorting, filtering, fill handles, or a spreadsheet
selection model. Cell text remains ordinary Lexical rich text; table structure
is edited through contextual table controls.

Selection and surfaces:

- A collapsed caret or table selection inside a table derives `kind: "table"`
  and resolves to `group: "table-edit"`.
- A non-collapsed text range inside a table remains `kind: "range"`, so the
  text-format toolbar wins when the user selects cell text.
- Fine pointers render
  [`FloatingTableToolbar`](../../src/app/app/documents/%5Bid%5D/table-controls.tsx)
  anchored to the full table.
- Coarse pointers render the same table control content inside
  [`MobileEditingSheet`](../../src/app/app/documents/%5Bid%5D/mobile-editing-sheet.tsx).
- Focus inside the inline caption also counts as table context via
  [`use-active-table-caption.ts`](../../src/app/app/documents/%5Bid%5D/use-active-table-caption.ts).

The table controls expose:

- a read-only size indicator (`rows × columns`),
- first-row header toggle,
- add row below / delete row,
- add column right / delete column,
- a More menu containing confirmed Delete table.

Deleting the final row or final column is disabled. Deleting the whole table is
an explicit destructive action; it is not triggered by deleting the last row or
column. Table-specific keyboard shortcuts are intentionally absent in this pass.
The toolbar follows the standard toolbar accessibility pattern with roving
tabindex, arrow-key movement, Home/End, and Escape returning focus to the
editor.

Captions are semantic table state stored on `TableNode` by
[`table-caption-runtime.ts`](../../src/lib/lexical/table-caption-runtime.ts).
They serialize through `contentJson` as the table node's `caption` field, so
autosave, undo/redo, slide derivation, public render, and export all use the
same Lexical JSON path. In the editor DOM, caption editing is rendered as a
`figcaption` outside the actual `<table>` subtree so Lexical's internal
`TableObserver` continues to observe only rows/cells. Non-empty captions are
always visible; empty caption placeholders appear only while the table is active
or the caption input is focused. Captions are single-line values: pasted
newlines are normalized to spaces, and Enter/Escape blur the caption and return
focus to the editor.

### Shared UI primitives

[`src/components/ui/`](../../src/components/ui/) holds the surface primitives.
The barrel [`index.ts`](../../src/components/ui/index.ts) exports the primitives
used as shared editor chrome (`Surface`, `Button`/`IconButton`,
`SegmentedControl`, `FloatingSurface`, `Tooltip`, `Divider`, `Popover`,
`ColorPicker`, and token helpers); route-specific primitives such as `Dialog`,
`Switch`, `Skeleton`, and `Swatch` are imported directly from their files. They
consume the `--ds-*` chrome tokens, so every surface looks like one system in
both light and dark mode.

Shared control class strings (focus ring, gutter button, toggle states) live in
[`src/components/ui/tokens.ts`](../../src/components/ui/tokens.ts) and are
composed by shared chrome and editor toolbar components.

## Invariants (and why)

These are load-bearing. Breaking one quietly corrupts persistence or
collaboration.

1. **Tools mutate only through Lexical commands / `editor.update()` — never Yjs
   directly.** Yjs binding is driven by Lexical's collaboration plugin; writing
   to Yjs out of band desyncs the CRDT. Standard Lexical mutations (including
   `$patchStyleText`, which serializes into the `TextNode` style) are
   collab-safe. `when`/`isActive`/`value` stay pure so they are render-safe and
   unit-testable without a browser.
2. **Never persist NodeKeys.** `blockKey` and `selectedVisualNodeKey` are live
   keys, valid only within the current editor state. Anchor persistence uses the
   **stable** `visualId` instead (stored as a `Visual` row's `anchorBlockId`).
3. **`contentJson` is the single source of truth.** The serialized Lexical state
   is authoritative. The `Visual`/`VisualRevision` database rows are a _derived
   mirror_ of the `VisualNode`s inside it (see
   [Visual lifecycle](#visual-lifecycle)) — used for share/embed pages,
   thumbnails, and history, never read back as primary state.
4. **`--ds-*` chrome tokens are separate from visual-content `VisualStyle`.** The
   app's surfaces are themed with `--ds-*`
   ([`globals.css`](../../src/app/globals.css), exposed to Tailwind via
   `@theme inline` and flipped in the `prefers-color-scheme: dark` block).
   A visual's own colors live in its `VisualStyle` (baked into the `Visual`
   payload) and must not be wired to `--ds-*` — a visual looks the same
   regardless of the app's light/dark chrome.

## How-to: extending the editor

### Add a new text / format tool

Append an `EditorTool` with `group: "text-format"` to `TEXT_FORMAT_TOOLS` in
[`tool-registry.ts`](../../src/lib/lexical/tool-registry.ts). For a toggle, keep
`run` thin and dispatch a Lexical command:

```ts
{
  id: "format-subscript",
  group: "text-format",
  section: "inline",
  label: "Subscript",
  icon: Subscript,                 // from lucide-react
  when: onRangeSelection,          // existing helper: editable && kind === "range"
  isActive: (ctx) => ctx.activeFormats.has("subscript"),
  run: (editor) => toggleFormat(editor, "subscript"),
}
```

The tool appears in the floating toolbar automatically. For a color tool, set
`control: "color"` and provide `value(ctx)` + `apply(editor, value)` instead of
`run` (see `format-text-color`). If you track a new format in `isActive`, add it
to `EditorTextFormat` / `TEXT_FORMATS` in
[`editor-context.tsx`](../../src/lib/lexical/editor-context.tsx) so the snapshot
reports it.

### Add a new visual kind / blank template

1. Add the kind to `VISUAL_KINDS` in
   [`src/lib/visual/schema.ts`](../../src/lib/visual/schema.ts) and its uppercase
   form to `VISUAL_TYPES` (+ the `VISUAL_KIND_TO_PRISMA` /
   `PRISMA_TO_VISUAL_KIND` maps).
2. Add a `blank<Kind>()` builder returning a schema-valid `Visual` and register
   it in `BLANK_BUILDERS` in
   [`src/lib/visual/fixtures.ts`](../../src/lib/visual/fixtures.ts). `createBlankVisual(kind)`
   picks it up — this is the deterministic, non-AI seed.
3. Add presentational metadata (label, icon, description, keywords) to
   `VISUAL_KIND_META` in `tool-registry.ts`. The `visual-insert` tool set is
   generated from `VISUAL_KINDS`, so the new kind shows up in the insert menu
   with no further wiring.
4. If it renders, teach the renderer/layout
   ([`src/components/visual/`](../../src/components/visual/)) how to draw it.

### Add or change a theme

Append a `StyleTheme` to `STYLE_THEMES` in
[`src/lib/visual/themes.ts`](../../src/lib/visual/themes.ts). A theme is a
`ThemeColors` patch (palette + base colors only — typography is preserved by
`applyTheme`). `applyTheme`/`isThemeActive` resolve themes dynamically from this
registry, so the new chip appears in the visual popover with no other change.
Keep `nodeText`-on-`nodeFill` contrast at WCAG AA (≥4.5:1).

### Add a new visual restyle control

Whole-visual and per-node edits are **pure transforms** in
[`src/lib/visual/transforms.ts`](../../src/lib/visual/transforms.ts) (each takes a
`Visual` and returns a new one). Add or reuse a transform, then call it from
[`visual-context-popover.tsx`](../../src/app/app/documents/%5Bid%5D/visual-context-popover.tsx)
through `onChange(transform(visual, …))`:

```ts
onChange(setVisualStyle(visual, { background: value }));
```

`VisualCard` applies the returned `Visual` via `node.setVisual(next)` inside
`editor.update()`. Keep transforms pure (no React/Lexical imports, never mutate
the input) so they round-trip through `safeParseVisual` and stay testable.

## Visual lifecycle

```
insert (deterministic or AI)  →  edit / restyle (theme-first)  →  persist / version
        VisualNode in contentJson            node.setVisual()            mirrorVisualNodes
```

### Insert

- **Deterministic (non-AI).** A `visual-insert` tool dispatches
  [`INSERT_VISUAL_COMMAND`](../../src/lib/lexical/commands.ts) with
  `{ kind, afterNodeKey }`. The handler
  ([`insert-visual-plugin.tsx`](../../src/app/app/documents/%5Bid%5D/insert-visual-plugin.tsx))
  delegates to `$insertBlankVisualAfter`
  ([`insert-visual.ts`](../../src/lib/lexical/insert-visual.ts)), which builds a
  `VisualNode` from `createBlankVisual(kind)`, inserts it after the target
  block, and selects it as a `NodeSelection` — all in one `editor.update()`.
- **AI.** The visual popover's "variations" path calls `/api/generate` and
  applies a chosen candidate through the same `node.setVisual()` seam.

The `VisualNode` ([`visual-node.tsx`](../../src/lib/lexical/visual-node.tsx))
is a Lexical `DecoratorNode` that serializes `{ visual, visualId }` into
`contentJson` and renders via `VisualCard`.

### Edit / restyle (theme-first)

Selecting a card makes the snapshot `kind === "visual"` and surfaces the
[`VisualContextPopover`](../../src/app/app/documents/%5Bid%5D/visual-context-popover.tsx).
A one-click **theme chip** is the primary restyle path (`applyTheme`); per-color
pickers, per-node overrides, and kind switching are progressive disclosure. Each
edit is a pure transform from `transforms.ts`, committed via `node.setVisual()`
inside `editor.update()`.

### Persist / version

On the debounced autosave, the serialized state is written to `contentJson`, and
`mirrorVisualNodes`
([`actions.ts`](../../src/app/app/documents/%5Bid%5D/actions.ts)) walks it via
`collectVisualNodes`
([`visual-nodes.ts`](../../src/lib/lexical/visual-nodes.ts)) and upserts one
`Visual` row per node (keyed by `visualId` → `anchorBlockId`, ordered by
`orderIndex`). A changed payload snapshots a `VisualRevision` first (history);
removed nodes prune their rows. Every payload is re-validated with
`safeParseVisual` before it is written, so a tampered visual can never be
persisted. Real-time collaboration is layered on Lexical via Yjs/`y-websocket`
(see [collaboration-deployment.md](../operations/collaboration-deployment.md)); the database remains the
durable source of truth.

## Deck (slide) autosave and version semantics

The slide editor has a parallel autosave pipeline that is completely separate
from the Lexical `contentJson` path. Deck edits are persisted via
`saveDeckJson` (whole-deck snapshots) in `actions.ts`. The schema and
persistence contract are documented in
[Current Deck Model](../data-model/deck.md). The key points for editor
contributors are:

### Revision token (optimistic locking)

Every successful deck save returns a `revisionToken` (24-character opaque
string). The client stores this token and sends it as `clientToken` on the
next save. `saveDeckJson` performs an atomic compare-and-swap:

- `clientToken === stored token` → write accepted → new token returned.
- `clientToken !== stored token` → `{ ok: "conflict", serverRevisionToken }`
  → the editor opens the `ConflictRecoveryDialog`.
- `clientToken` absent / `null` → conflict.

### Patch saves (`saveDeckPatch`)

`saveDeckPatch(id, patches, clientToken)` accepts an array of `DeckPatch`
records, but patch replay is currently disabled in the presentation runtime. The action
returns `{ ok: "fallback" }` as a compatibility signal so callers can retry
with `saveDeckJson`.

### `DocumentVersion` snapshot policy

`DocumentVersion` snapshots are created **only after a confirmed write**:

| Event                              | Snapshot?                         |
| ---------------------------------- | --------------------------------- |
| Successful whole-deck save         | Yes (throttled: max 1 per 10 min) |
| Conflicted save (`ok: "conflict"`) | **No** (no write occurred)        |
| Patch fallback (`ok: "fallback"`)  | **No** (no write occurred)        |
| Pre-restore checkpoint             | Yes (forced — bypasses throttle)  |

This invariant ensures that a conflict storm (e.g., two tabs rapidly saving)
cannot create unbounded phantom version entries.

### Conflict recovery UX

When a conflict is detected:

1. `ConflictRecoveryDialog` opens with the local snapshot and server token.
2. **Keep my version:** re-saves with the server's current token (force write).
   On success, the editor's token ref is updated.
3. **Use server version:** fetches the latest server deck, replaces editor
   state, discards local changes.
4. **Dismiss:** closes the dialog; unsaved changes remain (conflict may recur).

Self-conflicts (same user, two tabs) are handled identically.

### Presence model

The shared slide editor presence model (`presentation/use-slide-presence.ts`) reuses the Yjs
awareness channel to broadcast who has the deck open and which slide they are
viewing. Presence is advisory — it does not imply real-time merge. Conflicts
are handled by the revision-token CAS, not by presence locking. When the
awareness channel is unavailable the hook degrades gracefully (empty peers).

See [`use-slide-presence.ts`](../../src/lib/presentation/use-slide-presence.ts)
for the `SlidePresencePayload` shape and `useSlidePresence` hook API.

## Tests

Tests live next to the code they cover as `*.test.ts`, e.g.:

- [`editor-context.test.ts`](../../src/lib/lexical/editor-context.test.ts) — selection derivation
- [`text-formatting.test.ts`](../../src/lib/lexical/text-formatting.test.ts) — format commands at the document layer
- [`insert-visual.test.ts`](../../src/lib/lexical/insert-visual.test.ts) — deterministic insert in a headless editor
- [`visual-edit-roundtrip.test.ts`](../../src/lib/lexical/visual-edit-roundtrip.test.ts) — transform → `setVisual` → serialize round-trip
- [`transforms.style.test.ts`](../../src/lib/visual/transforms.style.test.ts), [`transforms.kind.test.ts`](../../src/lib/visual/transforms.kind.test.ts), [`schema.test.ts`](../../src/lib/visual/schema.test.ts), [`fixtures.test.ts`](../../src/lib/visual/fixtures.test.ts) — pure data layer

They run headlessly with `node --test` via `tsx` (no browser):

```bash
npm test
```
