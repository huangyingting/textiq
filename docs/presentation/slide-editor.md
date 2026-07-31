---
type: "architecture"
status: "current"
last_updated: "2026-07-31"
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

| Area                | Source                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route page          | [`src/app/app/documents/[id]/slides/page.tsx`](../../src/app/app/documents/%5Bid%5D/slides/page.tsx)                                             |
| Route controller    | [`src/app/app/documents/[id]/slides/slide-editor-route-client.tsx`](../../src/app/app/documents/%5Bid%5D/slides/slide-editor-route-client.tsx)   |
| Editor shell        | [`src/components/presentation/slide-editor.tsx`](../../src/components/presentation/slide-editor.tsx)                                             |
| Shell actions       | [`src/components/presentation/use-slide-editor-shell-controller.tsx`](../../src/components/presentation/use-slide-editor-shell-controller.tsx)   |
| Top toolbar         | [`src/components/presentation/slide-editor-top-toolbar.tsx`](../../src/components/presentation/slide-editor-top-toolbar.tsx)                     |
| Deck toolbar        | [`src/components/presentation/toolbar/deck-toolbar.tsx`](../../src/components/presentation/toolbar/deck-toolbar.tsx)                             |
| Read-only canvas    | [`src/components/presentation/slide-canvas.tsx`](../../src/components/presentation/slide-canvas.tsx)                                             |
| Node renderer       | [`src/components/presentation/slide-node-renderer.tsx`](../../src/components/presentation/slide-node-renderer.tsx)                               |
| Inspector           | [`src/components/presentation/inspector/inspector-shell.tsx`](../../src/components/presentation/inspector/inspector-shell.tsx)                   |
| Inspector panels    | [`src/components/presentation/inspector/`](../../src/components/presentation/inspector/)                                                         |
| Context toolbar     | [`src/components/presentation/toolbar/context-toolbar.tsx`](../../src/components/presentation/toolbar/context-toolbar.tsx)                       |
| Context controls    | [`src/components/presentation/toolbar/context-toolbar-primitives.tsx`](../../src/components/presentation/toolbar/context-toolbar-primitives.tsx) |
| Command palette     | [`src/components/presentation/slide-command-palette.tsx`](../../src/components/presentation/slide-command-palette.tsx)                           |
| Filmstrip           | [`src/components/presentation/filmstrip/filmstrip.tsx`](../../src/components/presentation/filmstrip/filmstrip.tsx)                               |
| Stage state         | [`src/components/presentation/use-stage-interaction-controller.ts`](../../src/components/presentation/use-stage-interaction-controller.ts)       |
| Stage targeting     | [`src/components/presentation/stage-targeting.ts`](../../src/components/presentation/stage-targeting.ts)                                         |
| Stage pointer       | [`src/components/presentation/stage-pointer-interactions.ts`](../../src/components/presentation/stage-pointer-interactions.ts)                   |
| Stage keyboard      | [`src/components/presentation/stage-keyboard-interactions.ts`](../../src/components/presentation/stage-keyboard-interactions.ts)                 |
| Stage fit           | [`src/lib/presentation/stage-fit.ts`](../../src/lib/presentation/stage-fit.ts)                                                                   |
| Stage chrome        | [`src/lib/presentation/stage-chrome.ts`](../../src/lib/presentation/stage-chrome.ts)                                                             |
| Stage guides        | [`src/lib/presentation/stage-guides.ts`](../../src/lib/presentation/stage-guides.ts)                                                             |
| Selection geometry  | [`src/lib/presentation/selection-geometry.ts`](../../src/lib/presentation/selection-geometry.ts)                                                 |
| Deck commands       | [`src/lib/presentation/editor-commands.ts`](../../src/lib/presentation/editor-commands.ts)                                                       |
| Document derivation | [`src/lib/presentation/document-slide-plan.ts`](../../src/lib/presentation/document-slide-plan.ts)                                               |
| Source links        | [`src/lib/presentation/source-links.ts`](../../src/lib/presentation/source-links.ts)                                                             |
| Presence state      | [`src/lib/presentation/slide-editor-collaboration-state.ts`](../../src/lib/presentation/slide-editor-collaboration-state.ts)                     |
| Open/save state     | [`src/components/editor/use-slide-editor-open.ts`](../../src/components/editor/use-slide-editor-open.ts)                                         |
| Autosave scheduler  | [`src/lib/presentation/slide-autosave-scheduler.ts`](../../src/lib/presentation/slide-autosave-scheduler.ts)                                     |
| Autosave queue      | [`src/lib/presentation/resilient-autosave-queue.ts`](../../src/lib/presentation/resilient-autosave-queue.ts)                                     |
| Clipboard payloads  | [`src/lib/presentation/clipboard/node-payload.ts`](../../src/lib/presentation/clipboard/node-payload.ts)                                         |

## Ownership Model

`SlideEditor` is the editing surface. The canonical `/slides` route owns
open/save state for full-page editing; the legacy document-page overlay hook is
not the primary editor lifecycle. Together the route controller and editor own:

- the current deck value exposed to the parent through `onDeckChange`;
- undo/redo history;
- selected slide and selected node ids;
- undo/redo deck snapshots and focus restoration targets;
- debounced full-deck autosave state (`dirty/saving/error`);
- durable latest-snapshot autosave recovery state (`offline/retrying/failed/conflict`);
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
- `Document.deckJson` is the editable Deck payload.
- `Document.deckRevisionToken` is used for optimistic save conflict detection.

Route open behavior is deterministic and credit-free:

1. Open saved valid Deck when present.
2. If no deck is saved, derive a faithful baseline from the latest saved
   `contentJson`.
3. If the saved document content has no usable blocks, open a blank Deck.
4. Invalid non-empty deck JSON opens recovery instead of silently overwriting
   with a blank deck.

`Regenerate` in the slides route means deterministic whole-deck re-derive from
the latest saved server `contentJson`. It does not call AI, spend credits, or
read unsaved Lexical state from the document route. Regenerate replaces the
current deck immediately, pushes the previous deck into undo history, and saves
through the same Deck CAS path.

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
inspector, keyboard shortcuts, stage gestures, and the `Cmd/Ctrl+K` command
palette. Deck-level commands stay in the top toolbar. Current-slide and
current-node commands are routed through the canvas popover and inspector so the
active object has one visible owner at a time. The palette resolves commands
from the same descriptors and inspector panel availability helpers, preserving
disabled reasons for commands that do not apply in the current selection or edit
mode.

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

## Inspector Organization

The inspector is a panel shell plus focused panels under
`src/components/presentation/inspector/`. `inspector-shell.tsx` owns panel
selection, focus handoff, and continuity; panel modules own one editing concern
such as slide settings, deck chrome overrides, node content, node geometry,
style binding, local overrides, diagnostics, source metadata, or layers. Panel
handlers route changes back through the same Deck command/update path as the
toolbar and canvas popover, so the inspector never writes persisted state
directly.

## Top Toolbar

The top toolbar is a compact deck-level command surface. It does not own deck
identity, routine save/diagnostic/presence state, or selected-object editing
commands; those live in the bottom dock or current-object surfaces. It uses a
compact icon-dense layout: the theme and ratio selects plus the Source and
Export controls keep minimal labels for disambiguation, while every other
control is an icon-only button:

```text
Theme | Ratio | Deck chrome | Snap || Source | Rebuild || More | Undo Redo | Present | Share | Export | Close
```

- **Theme** selects the active theme package: theme tokens, package templates,
  and the deck chrome baseline.
- **Deck chrome** opens global deck chrome controls for deck-level frame,
  header/footer, and shared chrome styling.
- **Slide ratio** changes the deck format through the ratio selector.
- **Rebuild** appears on the canonical slides route as a compact label for
  deterministic whole-deck regenerate from the latest saved document content.
  It then saves through the Deck CAS path. It is not an AI command.
- **Snap** toggles snap-to-guides for canvas editing. It is visible in the deck
  toolbar because it affects the whole editing session.
- **More** contains low-frequency editor/deck utilities such as keyboard
  shortcuts, manual save, and diagnostics fallback access.
- **Present** and **Share** stay as icon-only deck-level route actions.
- **Export** stays first-level and opens the PPTX, PDF, and PNG output menu.
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

Manual save, regenerate, present/share, and all export formats share one
synchronous toolbar-operation boundary. Duplicate or competing activation is
ignored before React rerenders; the toolbar exposes busy state and disables
every affected pointer and command-palette action until the operation settles.
Manual save reports failed action results, and save/present/share success is
announced only after the action result confirms it.
Ordinary thrown failures render dismissible toolbar feedback, while Next.js
redirect/not-found control flow escapes to the framework.

Fine-grained selected-element formatting stays out of the top toolbar. The
canvas popover and inspector continue to own text style, object-specific
editing, arrangement, effects, notes, layers, and detailed source review for the
current object.

## Stage Runtime

`SlideEditor` renders `SlideCanvas` and overlays editing chrome. The
stage is responsible for pointer/keyboard interaction only; deck mutations are
routed through `onDeckChange` callbacks and pure helpers in
`editor-commands.ts` / `source-links.ts` / `document-source-commands.ts`.
Stage interaction state is split out of the shell: `use-stage-interaction-controller.ts`
owns gesture drafts, focus/hover ids, keyboard connector mode, and live
announcements; `stage-pointer-interactions.ts`, `stage-targeting.ts`, and
`stage-keyboard-interactions.ts` own the focused pointer, semantic targeting,
and keyboard connector helpers that feed the command path.

Current stage capabilities:

- select one or many nodes;
- marquee select;
- move, resize, and rotate nodes;
- resize and rotate multi-selections through the combined selection bounds;
- drag connector endpoints and snap them to node anchors;
- snap boxes to guides/grid;
- inline-edit text elements, including paragraph/list text and list markers;
- create a text node by double-clicking true empty canvas;
- finalize double-clicks deterministically: node targets collapse to that node,
  editable text/table/group targets enter their edit context, locked nodes remain
  selected but do not enter edit, and multi-selection bounds/handles are inert;
- copy/cut/paste/duplicate/delete selected nodes;
- group and ungroup elements;
- enter a group for member editing;
- hide advanced controls in simple mode.

The Snap/Grid/Rulers/Guides toolbar controls own precision layout chrome.
Grid, ruler, and custom guide visibility plus custom percent guide positions are
stored per `documentId` in browser local storage, keeping the persisted Deck
schema and present/share/export rendering unchanged. Custom horizontal and
vertical guide lines feed the same pure stage-guide snap pipeline as transient
alignment guides, while grid/ruler overlays remain editor-only chrome.

Geometry is percentage-based (`LayoutBox.frame`) so the same deck renders
consistently at thumbnail, editor, present, and export sizes.

## Keyboard Accessibility

The canvas is fully keyboard operable (see
[slide canvas keyboard accessibility](../system/slide-canvas-keyboard-accessibility.md);
issues #530–#535). Pure
selection, geometry, stage-fit, and stage-guide helpers live under
`src/lib/presentation/` and `src/components/presentation/`; the
editor shell keeps thin wiring around those helpers.

- **Move:** Arrow nudges the selection by `1%`, Shift+Arrow by `5%`. Locked
  selected nodes are skipped by the mutation helpers, so mixed selections move
  only their unlocked members.
- **Resize:** Alt+Arrow resizes by `1%`, Alt+Shift+Arrow by `5%` — Right/Down
  grow the right/bottom edge, Left/Up shrink them (`resizeBoxByStep`, applied via
  `updateNodeLayouts`). Locked nodes are excluded from keyboard resize entries.
- **Enter:** a single selected node uses the keyboard equivalent of double-click:
  text enters inline edit, table enters table-cell edit, and group enters group
  editing. Locked nodes consume Enter but do not enter edit/group/table modes.
- **Escape:** active editors and nested contexts unwind before selection clears:
  inline editors own their own Escape handling, then table edit, group edit,
  selection, and finally the editor close request.
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
  (`canvasShortcutHelp` in `src/lib/presentation/canvas-shortcut-help.ts`).

The stage also exposes a content-first screen-reader outline alongside the
canvas. The outline is derived from the resolved render tree rather than the DOM
overlay and provides slide position, slide title/summary, deterministic reading
order, per-node narration, decorative filtering, and missing-content warnings.
It is an orientation surface only; editing remains in the canvas, inspector, and
toolbar controls.

## Canvas Contract

`SlideCanvas` is read-only. It renders the current
`ResolvedSlideRenderModel`, including theme-decoration layers, slide elements,
and deck chrome. The stage wraps it with editing affordances, but
rendering itself is shared with present/public viewers.

The editor can pass `hiddenElementIds` to hide elements during inline editing or
layer-list visibility toggles. The `editable` flag affects empty-image treatment
only; it does not make `SlideCanvas` mutate state.

## Inspector Runtime

`InspectorShell` owns editing controls, not deck state. It is a task-panel
router that renders exactly one active panel at a time —
`Slide / Text / Shape / Image / Adjust / Line / Arrange / Effects / Source / Notes / Layers` — with
a compact in-panel switcher for moving between the panels available to the
current selection. The panel open state is persisted in local storage; wide
screens default open when no preference exists, while narrow screens use a
bottom sheet. `Layers` is a normal panel rather than a separate inspector mode.

The available panel set is computed from the selection by `availablePanels`
(`src/lib/presentation/inspector-panel-ui.ts`), which also powers the canvas
toolbar `...` menu so the two never drift. With no element selected the current
object is the slide (`Slide / Notes / Layers`); a single element exposes its
kind-specific panels (`Text`, `Shape`, `Image` + `Adjust`, or `Line`) plus
`Arrange`, `Effects`, and `Layers`, with `Source` only when the element has a
`source`; a multi-selection exposes `Arrange / Effects / Layers`. Panel
continuity is resolved by `resolveInspectorPanelContinuity`: when the selection
changes it preserves a still-valid active panel, otherwise it routes to the
first available panel or the selection default.
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

The `Effects` panel edits opacity, blend mode, blur/glow/glass effects, and
shadow settings. Glow and shadow both expose opacity controls in addition to
their color and blur/offset controls; renderers consume those
`localStyle.effect.opacity` and `localStyle.shadow.opacity` values.

Deck-level chrome is not edited in the right inspector. The top toolbar
`Deck chrome` popover owns global logo, footer, page number, watermark, border,
and safe-area configuration. Those controls update Deck chrome state; normal
slide editing hit-testing, selection, clipboard, z-order, and layer-list
mutations operate only on slide child nodes.

The inspector must not infer missing context. If a workflow requires full source
document blocks or document id, those values are passed by `SlideEditor`.

## Popover Runtime

The canvas popover always anchors to the slide frame's top-center — the same
position the slide-selection toolbar uses — so the context toolbar sits in one
stable, predictable place regardless of what is selected (text, shape, element,
or slide). Text edit mode keeps the same anchor and hides object actions so a
caret edit cannot accidentally delete or reorder the whole node.

Single-node popovers expose frequent kind-specific verbs: text styling and
list controls, shape color, connector routing/dash/arrowheads, image replace and
crop bridge, and visual replace/restyle. Multi-select popovers expose alignment,
distribution, match-size, z-order, group/ungroup, duplicate, delete, and the
panel bridge.

## Clipboard Interoperability

Stage copy and cut serialize selected nodes to the versioned
`application/x-textiq-nodes+json` payload and write it through the async
Clipboard API only after feature-detecting `navigator.clipboard.write` and
`ClipboardItem`. The editor also keeps an in-memory buffer so same-instance paste
keeps working when clipboard permission is denied, `clipboard.write` is missing,
or the API is unavailable.

Paste prefers a validated TextIQ payload, remaps ids, and inserts through the
same presentation commands as local editing. If no TextIQ payload is available,
the stage accepts supported image blobs via the slide asset upload flow, then
falls back to sanitized HTML or normalized plain text as text nodes. Paste does
not intercept inspector inputs, table cells, modals, or other focused text
fields unless that owner explicitly delegates paste to the stage.

Copy-out includes plain text, safe HTML, and PNG fallbacks where supported so
external applications receive useful content instead of raw JSON. Recoverable
status messages cover denied permission, unsupported browser APIs, oversized or
invalid payloads, failed uploads, and other copy/paste failures without breaking
the in-editor fallback.

## Mutation Flow

Most user actions flow through pure presentation helpers:

```text
UI event
  -> SlideEditor handler
  -> editor-commands.ts / source-links.ts / document-source-commands.ts helper
  -> next Deck
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
revision tokens and a durable latest-snapshot queue:

1. Any deck edit calls `handleDeckChange`, marks dirty, and schedules autosave
   via `createSlideAutosaveScheduler`.
2. The latest unsaved deck snapshot is persisted locally before network save,
   coalescing newer edits over older queued snapshots.
3. Autosave (or explicit Save) calls `persistDeck`, which writes the full deck
   through `deckPort.saveDeckJson`.
4. If save succeeds, the editor stores the returned revision token, removes the
   queued snapshot, and clears dirty/error state.
5. Offline or transient failures keep the latest snapshot durable, retry with
   backoff, and recover on reconnect, visibility regain, route focus, editor
   mount, or explicit retry.
6. If save conflicts, the editor pauses retrying and surfaces
   `ConflictRecoveryDialog` with keep
   mine / use theirs / dismiss choices.

Conflict recovery has three user outcomes:

| Choice             | Behavior                                                     |
| ------------------ | ------------------------------------------------------------ |
| Keep my version    | Save the local deck against the server's latest token.       |
| Use server version | Fetch/accept the server deck and replace local editor state. |
| Dismiss            | Keep local unsaved changes and leave the editor dirty.       |

Keep-mine and use-server share one synchronous operation boundary. Repeated or
competing activation cannot start a second resolution before React renders the
pending state; while resolution is pending, both choices and every dialog
dismissal path remain locked. Ordinary failures retain the conflict and show
dismissible retry feedback, while Next.js redirect/not-found control flow
escapes to the framework.

Presence is advisory only. It shows who has the deck open and which slide they
are viewing, but optimistic revision tokens are the conflict authority.

Save status distinguishes idle, queued, saving, offline, retrying, persistent
failure, and conflict states. The bottom dock exposes retry and unload-warning
copy when local changes are durable but not yet synced.

The presentation runtime does not expose a `saveDeckPatch` action. Autosave,
manual save, retries, and conflict recovery all persist full deck snapshots
through `saveDeckJson`; `DeckPatch[]` command metadata is not a persistence log.

## Document Sync And Source Links

`SlideEditor` receives `sourceBlockIndex` and can optionally use host-side
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
2. `SlideEditor` owns interaction state and emits immutable `Deck` updates via `onDeckChange`.
3. `SlideCanvas` is shared and read-only.
4. Node geometry stays in percentage `LayoutBox.frame` units.
5. Node content, local style, and source-link edits write Deck node fields (`SlideNode.children`).
6. presentation autosave writes full deck snapshots through `saveDeckJson`.
7. Conflicts are resolved by revision token, not by presence.

## Primary Tests

- `src/lib/presentation/editor-commands*.test.ts`
- [`src/lib/presentation/source-links.test.ts`](../../src/lib/presentation/source-links.test.ts)
- [`src/lib/presentation/stage-chrome.test.ts`](../../src/lib/presentation/stage-chrome.test.ts)
- [`src/lib/presentation/slide-editor-collaboration-state.test.ts`](../../src/lib/presentation/slide-editor-collaboration-state.test.ts)
- [`src/components/presentation/slide-canvas-render.test.ts`](../../src/components/presentation/slide-canvas-render.test.ts)
- [`src/lib/presentation/slide-autosave-scheduler.test.ts`](../../src/lib/presentation/slide-autosave-scheduler.test.ts)
- [`e2e/presentation/slides-smoke.spec.ts`](../../e2e/presentation/slides-smoke.spec.ts)
