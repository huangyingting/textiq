---
type: "architecture"
status: "current"
last_updated: "2026-07-02"
description: "This document describes the runtime architecture of the slide editor. It is about interaction and UI ownership, not the persisted deck schema. For the JSON contract, see ../data-model/deck.md. For detailed stage hit-testing, hover preselection, overlap handling, connector targeting, and pointer state rules, see slide-stage-interactions.md."
---

# Slide Editor Runtime

This document describes the runtime architecture of the slide editor. It is
about interaction and UI ownership, not the persisted deck schema. For the JSON
contract, see [../data-model/deck.md](../data-model/deck.md). For detailed
stage hit-testing, hover preselection, overlap handling, connector targeting,
and pointer state rules, see
[slide-stage-interactions.md](slide-stage-interactions.md).

## Source Files

| Area                | Source                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Route page          | [`src/app/app/documents/[id]/slides/page.tsx`](../../src/app/app/documents/%5Bid%5D/slides/page.tsx)                                           |
| Route controller    | [`src/app/app/documents/[id]/slides/slide-editor-route-client.tsx`](../../src/app/app/documents/%5Bid%5D/slides/slide-editor-route-client.tsx) |
| Editor shell        | [`src/components/presentation-vnext/slide-editor-vnext.tsx`](../../src/components/presentation-vnext/slide-editor-vnext.tsx)                   |
| Deck toolbar        | [`src/components/presentation-vnext/toolbar/deck-toolbar.tsx`](../../src/components/presentation-vnext/toolbar/deck-toolbar.tsx)               |
| Read-only canvas    | [`src/components/presentation-vnext/slide-canvas.tsx`](../../src/components/presentation-vnext/slide-canvas.tsx)                               |
| Node renderer       | [`src/components/presentation-vnext/slide-node-renderer.tsx`](../../src/components/presentation-vnext/slide-node-renderer.tsx)                 |
| Inspector           | [`src/components/presentation-vnext/inspector/inspector-shell.tsx`](../../src/components/presentation-vnext/inspector/inspector-shell.tsx)     |
| Context toolbar     | [`src/components/presentation-vnext/toolbar/context-toolbar.tsx`](../../src/components/presentation-vnext/toolbar/context-toolbar.tsx)         |
| Filmstrip           | [`src/components/presentation-vnext/filmstrip/filmstrip.tsx`](../../src/components/presentation-vnext/filmstrip/filmstrip.tsx)                 |
| Stage fit           | [`src/lib/presentation-vnext/stage-fit.ts`](../../src/lib/presentation-vnext/stage-fit.ts)                                                     |
| Stage chrome        | [`src/lib/presentation-vnext/stage-chrome.ts`](../../src/lib/presentation-vnext/stage-chrome.ts)                                               |
| Stage guides        | [`src/lib/presentation-vnext/stage-guides.ts`](../../src/lib/presentation-vnext/stage-guides.ts)                                               |
| Selection geometry  | [`src/lib/presentation-vnext/selection-geometry.ts`](../../src/lib/presentation-vnext/selection-geometry.ts)                                   |
| Deck commands       | [`src/lib/presentation-vnext/editor-commands.ts`](../../src/lib/presentation-vnext/editor-commands.ts)                                         |
| Document derivation | [`src/lib/presentation-vnext/document-slide-plan.ts`](../../src/lib/presentation-vnext/document-slide-plan.ts)                                 |
| Source links        | [`src/lib/presentation-vnext/source-links.ts`](../../src/lib/presentation-vnext/source-links.ts)                                               |
| Presence state      | [`src/lib/presentation-vnext/slide-editor-collaboration-state.ts`](../../src/lib/presentation-vnext/slide-editor-collaboration-state.ts)       |
| Open/save state     | [`src/components/editor/use-slide-editor-open.ts`](../../src/components/editor/use-slide-editor-open.ts)                                       |
| Autosave scheduler  | [`src/lib/presentation-shared/slide-autosave-scheduler.ts`](../../src/lib/presentation-shared/slide-autosave-scheduler.ts)                     |

## Ownership Model

`SlideEditorVNext` is the editing surface. The canonical `/slides` route owns
open/save state for full-page editing; the legacy document-page overlay hook is
not the primary editor lifecycle. Together the route controller and editor own:

- the current deck value exposed to the parent through `onDeckChange`;
- undo/redo history;
- selected slide and selected node ids;
- undo/redo deck snapshots and focus restoration targets;
- debounced full-deck autosave state (`dirty/saving/error`);
- source-link staleness and review actions;
- mobile vs desktop placement of the inspector.

Child components are controlled. They receive slide/node state plus callbacks
and never mutate `Deck` objects directly.

## Route Ownership

The canonical authenticated slide editor URL is
`/app/documents/[id]/slides`. The document editor toolbar links to that route;
the document page does not own a slide-editor overlay lifecycle.

The slides route keeps the same owning document and persisted deck fields:

- `Document.contentJson` is the saved source used for deterministic derivation
  and source review.
- `Document.deckJson` is the editable DeckV7 payload.
- `Document.deckRevisionToken` is used for optimistic save conflict detection.

Route open behavior is deterministic and credit-free:

1. Open saved valid DeckV7 when present.
2. If no deck is saved, derive a faithful baseline from the latest saved
   `contentJson`.
3. If the saved document content has no usable blocks, open a blank DeckV7.
4. Invalid non-empty deck JSON opens recovery instead of silently overwriting
   with a blank deck.

`Regenerate` in the slides route means deterministic whole-deck re-derive from
the latest saved server `contentJson`. It does not call AI, spend credits, or
read unsaved Lexical state from the document route. Regenerate replaces the
current deck immediately, pushes the previous deck into undo history, and saves
through the same DeckV7 CAS path.

AI deck generation is not part of the canonical slides route first version. If
AI proposal/rewrite returns later, it should be an explicit command distinct
from deterministic Regenerate.

## Current Object Model

The editor always has one current object:

```text
current object = selected node(s) ?? current slide
```

Deck-level controls never participate in selection. They stay in the top
toolbar. When the node selection is empty, the slide itself is the current
object and the canvas popover plus inspector target slide background, notes,
template provenance, deck-chrome override context, and slide actions. When one
node, a
group, or a multiset is selected, those surfaces target that selection.

## Surface Layout

The desktop editor is a current-object workflow:

| Surface        | Responsibility                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top toolbar    | Deck-level controls: theme, ratio, deck chrome, snap, source, regenerate, undo/redo, present/share, export, more, and close.                          |
| Canvas popover | Frequent verbs for the current object: slide verbs, element formatting, arrange, object actions.                                                      |
| Stage          | Direct manipulation of slide elements on a fixed-format canvas.                                                                                       |
| Inspector      | One active task panel (Slide/Text/Shape/Image/Adjust/Line/Arrange/Effects/Source/Notes/Layers) for the current object.                                |
| Bottom dock    | Rail toggle, notes, slide position, zoom, and non-routine status only: save attention, diagnostics, source issues, collaborators, mode, or selection. |
| Slide rail     | Select, duplicate, remove, and reorder slides.                                                                                                        |

On smaller surfaces, the inspector can render as a sheet while the stage remains
the same controlled editor surface. The bottom dock also compacts for narrow
viewports: rail toggle, Notes, and zoom stay reachable; source, save,
diagnostics, presence, and mode details collapse into a keyboard-reachable
status popover only when they carry useful information. The dock applies bottom
safe-area padding when pinned to the viewport edge.
Desktop and mobile status surfaces announce save state with live regions:
steady-state save labels are polite updates, and save failures are assertive.

## Command Surface Ownership

The editor uses one current-object command model across toolbar, canvas popover,
inspector, keyboard shortcuts, and stage gestures. Deck-level commands stay in
the top toolbar. Current-slide and current-node commands are routed through the
canvas popover and inspector so the active object has one visible owner at a
time.

Inspector continuity preserves compatible panels when selection changes. For
example, text-to-text and shape-to-shape selection changes keep the same panel;
multi-selection falls back to common arrange/source panels when object-specific
fields no longer apply. Panel changes should preserve focus only when the same
field remains valid, otherwise the panel heading receives focus and announces
the change.

Deck chrome has split ownership: deck-level chrome defaults live behind the
toolbar Deck chrome entrypoint, while slide-level overrides live in the slide
inspector and are labeled as overrides. Present, public render, and export all
resolve the same deck defaults plus slide overrides through the read-only
render path.

## Top Toolbar

The top toolbar is a compact deck-level command surface. It does not own deck
identity, routine save/diagnostic/presence state, or selected-object editing
commands; those live in the bottom dock or current-object surfaces. It uses
stable first-level text controls for deck setup and output, with icon buttons
for compact route/actions:

```text
Theme | Ratio | Deck chrome | Snap || Source | Rebuild || More | Undo Redo | Present | Share | Export PPTX | Close
```

- **Theme** selects the active theme package: theme tokens, package templates,
  and the deck chrome baseline.
- **Deck chrome** opens global deck chrome controls for deck-level frame,
  header/footer, and shared chrome styling.
- **Slide ratio** changes the deck format through the ratio selector.
- **Rebuild** appears on the canonical slides route as a compact label for
  deterministic whole-deck regenerate from the latest saved document content.
  It then saves through the DeckV7 CAS path. It is not an AI command.
- **Snap** toggles snap-to-guides for canvas editing. It is visible in the deck
  toolbar because it affects the whole editing session.
- **More** contains low-frequency editor/deck utilities such as keyboard
  shortcuts, manual save, and diagnostics fallback access.
- **Present** and **Share** stay as icon-only deck-level route actions.
- **Export PPTX** stays first-level as the primary deck output action.
- **Close** is the fixed rightmost full-screen editor exit.
- **Insert actions** live in the current-object surfaces: slide templates come
  from the canvas popover/current-object commands, while text, image, shape,
  visual, connector, and table insertion are exposed through the canvas popover
  and inspector. Newly inserted objects become selected so those surfaces take
  over editing.
- **Design/style controls** own deck canvas size, slide kit style
  customization, presentation theme tokens, current-slide background,
  current-slide accent, clearing current-slide background/accent overrides, and
  applying the selected solid/gradient background or accent across the deck.
  Deck-level theme controls are reached from Slide kit and Deck chrome; selected
  object styling remains in the canvas popover and inspector.
- **Source** owns source-link review status, sync/review actions, selected-node
  refresh/unlink actions, and direct insertion of document blocks (text/table/
  visual) through `document-source-commands.ts`.
- **Save state**, **diagnostics**, **presence**, deck title, and current slide
  identity live in the bottom dock only when useful. Routine states such as
  "saved", "no diagnostics", "solo", "normal mode", and "no selection" are not
  rendered as persistent visible text. Save failures expose retry from status;
  manual save remains in More.
- **Shortcuts** opens from More. Zoom remains in the bottom dock.

Toolbar popovers that execute commands expose menu semantics
(`role="menu"`/`menuitem*`) and keyboard traversal so assistive technology gets
the same command contract as pointer users.

Fine-grained selected-element formatting stays out of the top toolbar. The
canvas popover and inspector continue to own text style, object-specific
editing, arrangement, effects, notes, layers, and detailed source review for the
current object.

## Stage Runtime

`SlideEditorVNext` renders `SlideCanvasVNext` and overlays editing chrome. The
stage is responsible for pointer/keyboard interaction only; deck mutations are
routed through `onDeckChange` callbacks and pure helpers in
`editor-commands.ts` / `source-links.ts` / `document-source-commands.ts`.

Current stage capabilities:

- select one or many nodes;
- marquee select;
- move, resize, and rotate nodes;
- drag connector endpoints and snap them to node anchors;
- snap boxes to guides/grid;
- inline-edit text elements, including paragraph/list text;
- create a text node by double-clicking empty canvas;
- copy/cut/paste/duplicate/delete selected nodes;
- group and ungroup elements;
- enter a group for member editing;
- hide advanced controls in simple mode.

Geometry is percentage-based (`LayoutBox.frame`) so the same deck renders consistently
at thumbnail, editor, present, and export sizes.

## Keyboard Accessibility

The canvas is fully keyboard operable (see
[slide canvas keyboard accessibility](../system/slide-canvas-keyboard-accessibility.md);
issues #530–#535). Pure
selection, geometry, stage-fit, and stage-guide helpers live under
`src/lib/presentation-vnext/` and `src/components/presentation-vnext/`; the
editor shell keeps thin wiring around those helpers.

- **Move:** Arrow nudges the selection by `1%`, Shift+Arrow by `5%`.
- **Resize:** Alt+Arrow resizes by `1%`, Alt+Shift+Arrow by `5%` — Right/Down
  grow the right/bottom edge, Left/Up shrink them (`resizeBoxByStep`, applied via
  `updateNodeLayouts`).
- **Traversal:** Tab / Shift+Tab select the next / previous element in a
  deterministic reading order (`orderedElementIds` + `nextElementId`) while a
  canvas element has focus (helpers in `selection-traversal.ts`), backed by a
  roving tabindex (the primary selection, or the first element in reading order,
  is the single Tab stop). Escape releases canvas focus so users are never
  trapped.
- **Focus restoration:** after move/resize the moved element keeps focus; after
  delete the next/previous survivor (or the stage container) is focused
  (`focusTargetAfterDelete`); after duplicate the new copy; after group the group
  primary. Driven by an imperative `focusRequest` prop into the stage.
- **Announcements:** a visually-hidden `aria-live="polite"` region in the stage
  announces selection, move, resize and delete results (`announce*` builders);
  focused elements show a distinct `focus-visible` ring.
- **Connectors (interim):** with two connectable elements selected, `C` inserts a
  default-endpoint connector; with a connector selected, `C` / `Shift+C` cycle its
  end / start endpoint anchor. Free-draw routing remains pointer-only and is
  tracked in #1574.
- **Help:** `?` (or View > Keyboard shortcuts) opens the shortcut help dialog
  (`canvasShortcutHelp` in `src/lib/presentation-shared/canvas-shortcut-help.ts`).

## Canvas Contract

`SlideCanvasVNext` is read-only. It renders the current
`ResolvedSlideRenderModel`, including theme-decoration layers, slide elements,
and deck chrome. The stage wraps it with editing affordances, but
rendering itself is shared with present/public viewers.

The editor can pass `hiddenElementIds` to hide elements during inline editing or
layer-list visibility toggles. The `editable` flag affects empty-image treatment
only; it does not make `SlideCanvasVNext` mutate state.

## Inspector Runtime

`InspectorShell` owns editing controls, not deck state. It is a task-panel
router that renders exactly one active panel at a time —
`Slide / Text / Shape / Image / Adjust / Line / Arrange / Effects / Source / Notes / Layers` — with
a compact in-panel switcher for moving between the panels available to the
current selection. The panel open state is persisted in local storage; wide
screens default open when no preference exists, while narrow screens use a
bottom sheet. `Layers` is a normal panel rather than a separate inspector mode.

The available panel set is computed from the selection by `availablePanels`
(`slide-panel-ui.ts`), which also powers the canvas toolbar `...` menu so the two
never drift. With no element selected the current object is the slide
(`Slide / Notes / Layers`); a single element exposes its kind-specific panels
(`Text`, `Shape`, `Image` + `Adjust`, or `Line`) plus `Arrange`,
`Effects`, and `Layers`, with `Source` only when the element has a `source`; a
multi-selection exposes `Arrange / Effects / Layers`. There is no fallback
routing: when the selection changes so the active panel no longer applies,
`SlideEditorVNext` closes the right panel instead of guessing a replacement.
The object-identity header names the current object but no longer exposes a
permanent `Name` input — element naming lives in `Layers`.

`InspectorShell` receives callbacks for every action:

- slide duplicate/remove;
- template apply/reapply;
- create/delete deck-local custom templates;
- update a deck-local custom template from the current slide;
- node patch/remove/duplicate;
- z-order, arrange, align, distribute, match-size;
- group/ungroup;
- hide/lock/rename layer-list operations;
- slide `localStyle.slide.background` and accent updates;
- image upload through the slide asset action when `documentId` is available.

Deck-level chrome is not edited in the right inspector. The top toolbar
`Deck chrome` popover owns global logo, footer, page number, watermark, border,
and safe-area configuration. Those controls update DeckV7 chrome state; normal
slide editing hit-testing, selection, clipboard, z-order, and layer-list
mutations operate only on slide child nodes.

The inspector must not infer missing context. If a workflow requires full source
document blocks or document id, those values are passed by `SlideEditorVNext`.

## Popover Runtime

The canvas popover is anchored to the current object: the selected union bbox for
node selections and the slide top edge when the slide is current. Text edit
mode keeps the popover anchored to the text bbox and hides object actions so a
caret edit cannot accidentally delete or reorder the whole node.

Single-node popovers expose frequent kind-specific verbs: text styling and
list controls, shape color, connector routing/dash/arrowheads, image replace and
crop bridge, and visual replace/restyle. Multi-select popovers expose alignment,
distribution, match-size, z-order, group/ungroup, duplicate, delete, and the
panel bridge.

## Mutation Flow

Most user actions flow through pure v7 helpers:

```text
UI event
  -> SlideEditorVNext handler
  -> editor-commands.ts / source-links.ts / document-source-commands.ts helper
  -> next DeckV7
  -> onDeckChange
  -> useSlideEditorOpen undo stack + autosave scheduler
  -> saveDeckJson (manual save or debounced autosave)
```

Source-link operations route through `refreshNodeSource`,
`refreshAllSafeSourceLinks`, `unlinkNodeSource`, and `relinkNodeSource`, then
use the same `onDeckChange` + autosave pipeline.

Node content updates write `node.content`; style overrides write
`node.localStyle`; source-link updates write `node.source`. Slide-level styling
updates write `slide.localStyle`; deck chrome updates write `deck.chrome` and
optional per-slide overrides under `slide.props.deckChrome`.

## Autosave And Conflict Handling

`useSlideEditorOpen` uses debounced full-deck saves (`saveDeckJson`) with
revision tokens:

1. Any deck edit calls `handleDeckV7Change`, marks dirty, and schedules autosave
   via `createSlideAutosaveScheduler`.
2. Autosave (or explicit Save) calls `persistDeckV7`, which writes the full deck
   through `deckPort.saveDeckJson`.
3. If save succeeds, the editor stores the returned revision token and clears
   dirty/error state.
4. If save conflicts, the editor surfaces `ConflictRecoveryDialogV7` with keep
   mine / use theirs / dismiss choices.

Conflict recovery has three user outcomes:

| Choice             | Behavior                                                     |
| ------------------ | ------------------------------------------------------------ |
| Keep my version    | Save the local deck against the server's latest token.       |
| Use server version | Fetch/accept the server deck and replace local editor state. |
| Dismiss            | Keep local unsaved changes and leave the editor dirty.       |

Presence is advisory only. It shows who has the deck open and which slide they
are viewing, but optimistic revision tokens are the conflict authority.

`saveDeckPatch` remains available only as a compatibility endpoint and currently
returns `{ ok: "fallback" }`; v7 runtime autosave does not enqueue or persist
`DeckPatch[]` records.

## Document Sync And Source Links

`SlideEditorVNext` receives `sourceBlockIndex` and can optionally use host-side
`onRefreshSource` logic. Source review uses `classifyDeckSourceLinks`,
`sourceReviewItems`, and `sourceLinkDiagnostics` to surface stale/orphan/unknown
links.

Node-level source operations are explicit and type-aware:

- `refreshNodeSource` / `refreshAllSafeSourceLinks` refresh text, table,
  visual, or image node content in place when compatible;
- `unlinkNodeSource` marks dependencies as unlinked without deleting content;
- `relinkNodeSource` rewires a node to a chosen source block;
- `dismissNodeSourceIssue` records dismissal metadata in `source.extra`.

Source-link controls support update, unlink, relink, and orphan removal. Source
refs must carry explicit `blockKind`.

## Invariants

1. `useSlideEditorOpen` owns open/save/autosave/revision-token state.
2. `SlideEditorVNext` owns interaction state and emits immutable `DeckV7` updates via `onDeckChange`.
3. `SlideCanvasVNext` is shared and read-only.
4. Node geometry stays in percentage `LayoutBox.frame` units.
5. Node content, local style, and source-link edits write DeckV7 node fields (`SlideNode.children`).
6. v7 autosave writes full deck snapshots through `saveDeckJson`.
7. Conflicts are resolved by revision token, not by presence.

## Primary Tests

- `src/lib/presentation-vnext/editor-commands*.test.ts`
- [`src/lib/presentation-vnext/source-links.test.ts`](../../src/lib/presentation-vnext/source-links.test.ts)
- [`src/lib/presentation-vnext/stage-chrome.test.ts`](../../src/lib/presentation-vnext/stage-chrome.test.ts)
- [`src/lib/presentation-vnext/slide-editor-collaboration-state.test.ts`](../../src/lib/presentation-vnext/slide-editor-collaboration-state.test.ts)
- [`src/components/presentation-vnext/slide-canvas-render.test.ts`](../../src/components/presentation-vnext/slide-canvas-render.test.ts)
- [`src/lib/presentation-shared/slide-autosave-scheduler.test.ts`](../../src/lib/presentation-shared/slide-autosave-scheduler.test.ts)
- [`e2e/slides-smoke.spec.ts`](../../e2e/slides-smoke.spec.ts)
