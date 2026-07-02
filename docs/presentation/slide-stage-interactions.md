---
type: "design"
status: "current"
last_updated: "2026-07-02"
description: "This document defines how the slide editor stage should choose, preview, select, move, resize, and edit DeckV7 nodes when many nodes overlap. It is the interaction contract for the vNext slide editor stage, not the persisted deck schema."
---

# Slide Stage Interactions

This document defines how the slide editor stage should choose, preview, select,
move, resize, and edit DeckV7 nodes when many nodes overlap. It is the
interaction contract for the vNext slide editor stage, not the persisted deck
schema.

## Legacy Parity Status

vNext already owns the production stage interaction model. A bulk port of the
legacy v6 stage editor is not needed: legacy interaction code is coupled to v6
flat element arrays and `groupId`, while vNext uses DeckV7 node trees,
`GroupNode.children`, and vNext command helpers. Verified parity includes
align/distribute/match-size, Shift+nudge, select-all, group/ungroup,
undo/redo, rotation snapping, keyboard connector flow, clipboard,
duplicate/delete, connector endpoint editing, group-bounds multi-selection
resize/rotate, and deterministic double-click finalization. The remaining
difference is a UX affordance only: vNext creates connectors by
insert-then-endpoint-drag rather than a single drag-from-source gesture.

## Source Files

| Area                  | Source                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Stage UI/controller   | [`src/components/presentation-vnext/slide-editor-vnext.tsx`](../../src/components/presentation-vnext/slide-editor-vnext.tsx)               |
| Read-only canvas      | [`src/components/presentation-vnext/slide-canvas.tsx`](../../src/components/presentation-vnext/slide-canvas.tsx)                           |
| Node renderer         | [`src/components/presentation-vnext/slide-node-renderer.tsx`](../../src/components/presentation-vnext/slide-node-renderer.tsx)             |
| Selection model       | [`src/components/presentation-vnext/selection-model.ts`](../../src/components/presentation-vnext/selection-model.ts)                       |
| Selection geometry    | [`src/lib/presentation-vnext/selection-geometry.ts`](../../src/lib/presentation-vnext/selection-geometry.ts)                               |
| Stage pointer helpers | [`src/components/presentation-vnext/stage-pointer-interactions.ts`](../../src/components/presentation-vnext/stage-pointer-interactions.ts) |
| Stage gesture drafts  | [`src/components/presentation-vnext/stage-gesture-feedback.tsx`](../../src/components/presentation-vnext/stage-gesture-feedback.tsx)       |
| Multi-select geometry | [`src/components/presentation-vnext/multi-selection-transform.ts`](../../src/components/presentation-vnext/multi-selection-transform.ts)   |
| Table editing         | [`src/components/presentation-vnext/use-table-cell-editing.ts`](../../src/components/presentation-vnext/use-table-cell-editing.ts)         |
| Stage chrome layering | [`src/lib/presentation-vnext/stage-chrome.ts`](../../src/lib/presentation-vnext/stage-chrome.ts)                                           |
| Stage fit             | [`src/lib/presentation-vnext/stage-fit.ts`](../../src/lib/presentation-vnext/stage-fit.ts)                                                 |
| Stage guides          | [`src/lib/presentation-vnext/stage-guides.ts`](../../src/lib/presentation-vnext/stage-guides.ts)                                           |
| Context toolbar       | [`src/components/presentation-vnext/toolbar/context-toolbar.tsx`](../../src/components/presentation-vnext/toolbar/context-toolbar.tsx)     |

## Goals

- Hover feedback should feel Canva-like: moving the pointer over the stage shows
  the element the editor believes the user is most likely targeting.
- Selection, drag, double-click edit, and context-menu targeting should use the
  same semantic hit-test result.
- Large text/list frames and large background-like shapes should not make lower
  content impossible to target.
- Selected/preselected frames must remain visible even when the target element is
  behind another element.
- Direct manipulation must stay predictable: click selects, second click edits
  text, drag starts only after pointer travel crosses the drag threshold.

## Interaction State Machine

The stage should be treated as a small state machine, even though some state is
currently represented by refs and React state in `SlideEditorVNext`.

| State           | Meaning                                                                | Hover preselect? | Main transitions                                                                                  |
| --------------- | ---------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `idle`          | No selected element, no pointer gesture, no editor                     | Yes              | hover -> preselect; pointerdown on element -> `press-pending`; pointerdown empty -> marquee/click |
| `selected-idle` | One or more elements selected, but no pointer gesture                  | Yes              | hover -> preselect any target; pointerdown selected/unselected element -> `press-pending`         |
| `press-pending` | Pointer is down but movement has not exceeded the click/drag threshold | No               | pointerup -> select or edit; pointermove beyond threshold -> `moving` / `resizing` / `rotating`   |
| `moving`        | Element(s) are actively moving                                         | No               | pointermove -> update boxes; pointerup -> commit gesture                                          |
| `resizing`      | Element(s) or multi-selection bounds are actively resizing             | No               | pointermove -> update boxes/font/connector endpoint; pointerup -> commit gesture                  |
| `marquee`       | Stage background drag is drawing a selection band                      | No               | pointerup -> select intersecting boxes or clear selection                                         |
| `editing`       | Inline text editor or table-cell editor is mounted                     | No               | input -> content patch; click/double-click another target -> commit/exit before switching         |

Important distinction: **selected is not moving**. A selected element may remain
selected while pointer movement over other elements continues to preselect those
other elements. The stage enters moving/resizing only after pointer movement
passes `CLICK_MOVE_THRESHOLD_PX`.

## Input Modalities

The interaction model is pointer-first, but it must not assume every input has a
hover phase.

| Input          | Behavior                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Mouse/trackpad | Full hover preselection, click selection, drag threshold, double-click edit, context menu.                                 |
| Pen/stylus     | Treat like pointer input; hover preselection is available only on devices/browsers that emit hover-style pointer movement. |
| Touch          | No reliable hover. Tap should select, second tap edits editable text, drag threshold starts movement.                      |
| Keyboard       | Uses roving tabindex and keyboard canvas helpers; `Enter` enters the current target, arrows nudge, `Alt+]` selects under.  |
| Screen readers | Use focus, selection announcements, and the layer list. Preselection itself is advisory visual chrome.                     |

Touch and keyboard users must always have deterministic alternatives through
selection, traversal, and the layer list; they should never depend on hover-only
feedback.

## Semantic Hit Testing

The stage should not rely on DOM overlay boxes for target selection. Instead,
`stage-hit-test.ts` computes ranked candidates from the pointer position and the
current slide elements.

The hit-test pipeline is:

1. Convert client coordinates to slide percent coordinates.
2. Collect candidates from elements whose interactive geometry contains or is
   near the pointer.
3. Drop hidden elements and, by default, locked elements.
4. Score candidates by interaction semantics.
5. Sort by score, then z-index, then DOM/order tie-break.

`HitTestCandidate` carries:

- `element`: the target element;
- `box`: the box used for manipulation;
- `score`: semantic priority;
- `reason`: why the candidate was included.

### Scoring Intent

Scores are intentionally semantic rather than purely visual z-index based.
Examples:

| Candidate condition                  | Priority intent                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Text/list actual content hit         | Very high. Text content is often what users intend to edit/select, even if covered by a shape.                                |
| Text/list near content               | High. A little tolerance around text makes targeting humane.                                                                  |
| Text/list frame-only hit             | Low. Empty frame area should not block lower visible objects.                                                                 |
| Connector or line stroke hit         | Very high. Thin objects need a generous distance threshold to be selectable.                                                  |
| Shape edge hit                       | Very high. Edges/corners usually mean the user is targeting the shape itself.                                                 |
| Small shape interior                 | High. Small shapes are likely intentional targets.                                                                            |
| Medium shape interior                | Medium-high.                                                                                                                  |
| Large/background-like shape interior | Low. Large covering shapes often function as backgrounds/containers and should not trap intent.                               |
| Selected element                     | Optional strong bonus for selected-object flows such as context menus; not used for hover or ordinary pointer-down targeting. |
| Z-index                              | Small tie-break bonus, not the whole decision.                                                                                |

This is why a text element can be preselected even when a large shape covers it:
the pointer can be close to the text content, while the large shape's interior is
penalized as a likely background-like cover. Conversely, if the pointer is near
the shape edge, the shape edge score wins.

## Element-Specific Hit Rules

### Text

Text elements should not use the entire frame as their primary hit area.

- Actual text line/content area -> `text-content`.
- Slightly inflated text area -> `text-near`.
- Frame-only hit -> `text-frame`, low score.
- Alignment and vertical alignment affect the estimated visible text box.

The current implementation accepts an optional measured text geometry cache from
`text-hit-geometry.ts`. The cache is built by `SlideStageEditor` during layout
from a hidden DOM measurement host, stores line/content boxes in slide-percent
coordinates, and is passed into the pure `stage-hit-test.ts` pipeline. Cache
misses fall back to the heuristic geometry derived from line count, character
count, font size, alignment, and stage aspect ratio.

### List Paragraphs

List paragraphs follow the text model, but include marker/indent slack:

- `TextElement.paragraphs[]` is authoritative for plain text, bullets, and
  numbered lists. Paragraphs with `listType` render markers; `indent` carries
  nesting depth.
- Visible rows/near rows should outrank large shape interiors.
- Empty list frame areas should not trap lower objects.

### Shapes

Shape rules depend on shape kind:

- Rectangles: box hit, with edge vs interior scoring.
- Ellipses: mathematical ellipse hit test.
- Triangles: triangle area hit test.
- Lines: distance-to-line-segment threshold; line bounding boxes are not enough.

Large interior-only shape hits are downweighted so background-like shapes do not
make text and small objects underneath impossible to target. Shape edges remain
high priority so users can still select/manipulate the shape deliberately.

### Connectors

Connectors must be considered in both preselection and direct manipulation.

- Hit testing uses resolved connector endpoint points and a distance-to-segment
  threshold.
- Bound endpoints resolve through `resolveConnectorElementPoints` using current
  fitted boxes.
- Connector endpoint handles remain separate editing affordances once the
  connector is selected.
- While dragging an endpoint, anchor preview dots are shown on candidate target
  elements; this interaction intentionally suppresses general hover preselection.
- Candidate target elements are collected by `connectorAnchorCandidates` from
  elements under the pointer and elements with anchors inside the snap radius;
  final binding still uses the nearest snapped anchor from `snapLineEndpoint`.

A connector is not selected by its full bounding box. It should be targetable
near its stroke, with enough tolerance to be practical.

### Visuals And Images

Visual and image elements can use optional media-aware hit geometry. Visuals get
node-aware regions from `media-hit-geometry.ts` when positioned node bounds are
available; otherwise visuals and images fall back to their fitted box. Image
alpha/pixel-aware geometry is intentionally an extension hook rather than work
done in pointermove.

Large visuals/images are ambiguous: they can be primary content, but they can
also act as background-like covers. The current box-based rule is intentionally
conservative. Future scoring may need additional signals, such as:

- alpha-aware image hit testing for transparent PNG/WebP content;
- richer rendered-node hit testing for sparse visuals, including edges and
  labels outside basic node rectangles;
- background/cover intent from slide layout, element role, or user lock state;
- selected-object stickiness so large media remains operable once selected.

### Empty Template Elements

Slide templates materialize real typed elements, not placeholder elements.
Empty template text/image/visual affordances are therefore hit-tested through
their normal element kind and should not beat text content, line strokes, or
explicit shape edges unless the pointer is clearly targeting them.

## Selection And Preselection Frames

Selection/preselection frames are visual chrome, not hit targets.

- Single selected and preselected frames render through a high z-index
  `pointer-events: none` overlay layer.
- This keeps the frame visible even when the selected/preselected element is
  behind another element.
- Stage chrome z-index values are centralized in `stage-chrome.ts` so selected
  element handle overlays, selected/preselected frames, group frames,
  multi-selection bounds, guides, marquees, and live badges preserve a stable
  stacking order.
- The frame overlay must not intercept pointer events.
- Multi-selection and group bounding boxes should also remain visually above
  slide elements. Multi-selection and group frames use the same named top-layer
  chrome scale as the single-element selection frame.
- Single-node resize/rotate/crop/connector handles are suppressed while multiple
  nodes are selected. In multi-selection, resize and rotation handles belong to
  the combined selection bounds.
- Multi-selection bounds and handles are stage chrome. They are not content
  targets and must not trigger empty-canvas text insertion or node editing.

Resize and rotation handles are editing affordances, not hover preselection. The
handles belong to the selected primary element and should stay reachable even
when the selected element is behind another object. If handle visibility diverges
from frame visibility, handles should be moved to the same top-layer chrome
strategy as frames.

## Pointer Target Resolution

Pointer-down, double-click, and context-menu actions should ask the same semantic
hit-test for the target. This keeps hover feedback and click behavior aligned.

| Gesture                  | Target source                        | Result                                                                                         |
| ------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Pointer move             | top semantic hit candidate           | update preselection while idle/selected-idle                                                   |
| Pointer down on element  | top semantic hit candidate           | select target immediately, enter `press-pending`                                               |
| Pointer move threshold   | existing drag ref                    | enter moving/resizing/rotating and suppress hover preselection                                 |
| Pointer up no movement   | press-pending target                 | select only, or enter inline edit if it was the already selected editable text element         |
| Double click             | top semantic hit candidate           | collapse to the target, then enter text edit, table edit, or group when allowed                |
| Context menu             | top semantic hit candidate           | select target and open menu for that target                                                    |
| Select-under cycle       | current ranked candidate stack       | `Alt`-click or `Alt+]` selects the next candidate in stack order                               |
| Stage empty click        | no semantic hit, no marquee movement | commit/exit current edit, clear selection, and exit group/table context                        |
| Stage empty double click | true canvas background               | commit/exit current edit, insert a text node at the point, select it, and enter inline editing |
| Multi-selection bounds   | stage chrome                         | retain current selection; do not insert text, clear selection, or enter editing                |

Pointer-down target resolution and hover preselection use the same ranked
candidate list without selected-node stickiness, so the object shown as
preselected is also the object a normal drag starts from. Hover only updates
`preselectedElementId`; pointer-down stores a press-pending target; movement past
the threshold promotes that target into the active manipulation state.

Preselection must be computed from the stage-level semantic pointermove path.
Node-level DOM `pointerenter`/`pointerleave` handlers must not write preselection
state directly, because DOM stacking and semantic ranking can disagree for
overlapping objects.

Selected-node stickiness is reserved for flows that explicitly operate on the
current selection, such as context-menu targeting and select-under anchoring. It
must not override ordinary pointer-down targeting, because that would make a
preselected overlapping object appear draggable while actually dragging the
already selected object underneath.

The raw semantic hit candidate is resolved through `stage-targeting.ts` before
selection semantics are applied. This keeps group behavior consistent across
hover, pointer-down, double-click, context-menu selection, and future
select-under cycling while preserving the raw candidate stack for precision
fallback menus.

### Double-Click Finalizer

Double-click is the final action after the browser has already delivered two
pointer/click sequences. The finalizer must override temporary selection effects
from those clicks and re-establish the intended editing context:

- true blank-canvas double-click inserts a new text node and enters inline edit;
- double-clicking multi-selection bounds or transform handles is inert and keeps
  the selection intact;
- double-clicking a node collapses selection to that node and focuses it;
- editable text enters inline edit with a caret based on the click position; an
  empty text node falls back to the start caret;
- tables enter table-cell edit with the first cell focused as the stable
  fallback;
- groups enter group-editing mode and select the first child;
- image, visual, shape, and connector nodes only collapse to single selection;
- locked nodes only collapse selection and never enter text/table/group editing;
- modifier keys do not add double-click selection semantics and do not trigger
  duplicate behavior.

If another inline text editor or table editor is active, double-click first
commits/exits the current editor and then performs the new target action.

## Groups And Multi-Selection

Groups add another semantic layer over hit testing.

- Outside group-editing mode, clicking a grouped member selects the group as a
  unit.
- Inside group-editing mode, members are targetable individually.
- `stage-targeting.ts` is the shared boundary that turns a raw hit element into
  either an element target or a group target.
- Group bounding boxes are visual chrome and should not become hit-test
  blockers.
- Multi-selection transforms use the combined transform box, not the individual
  hit-test candidate under the pointer. Group snapping is computed once from the
  combined bounds and then applied as a shared delta so relative offsets remain
  stable during drag preview.
- Multi-selection resize and rotation are computed from the combined bounds via
  `multi-selection-transform.ts`. Locked or layoutless selected nodes are
  excluded from the transform entries; unlocked nodes keep their relative
  placement within the transformed bounds.
- Modifier-click selection toggles membership in the selection set and should
  not start drag tracking.

When group behavior and semantic hit-testing disagree, the group-editing mode is
the authority: unentered groups resolve to group-level selection; entered groups
resolve to member-level selection.

## Overlap Cases

| Scenario                                           | Expected result                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Large text frame over shape, pointer in text blank | Lower visible object can preselect/select.                                                                                   |
| Large shape over text, pointer near text content   | Text can win by semantic score, even if geometrically covered by the shape.                                                  |
| Pointer near shape edge                            | Shape wins.                                                                                                                  |
| Small shape over text                              | Small shape can win.                                                                                                         |
| Selected large shape over text                     | Hover and normal pointer-down can still target the text; context-menu/select-under flows may bias toward the selected shape. |
| Multiple arbitrary fully covered objects           | Semantic scoring can improve the common case, but layer list/context menu remains the fallback.                              |
| Line/connector over any element                    | Stroke-distance hit wins near the line; box interior alone should not.                                                       |
| Locked object over editable object                 | Locked object is excluded by default, so lower editable objects can be targeted.                                             |

Locked nodes can still be selected through layer/focus flows for inspection, but
they are excluded from mutation helpers and do not enter edit modes through
double-click or `Enter`.

## Keyboard Interaction Matrix

Keyboard behavior mirrors pointer semantics without relying on pointer
coordinates:

| Key / chord           | Behavior                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Enter`               | Coordinate-less double-click for a single selected node: text edit, table edit, or group entry; locked nodes do nothing.                             |
| `Escape`              | Unwinds the deepest active state first: table edit, group, selection, then editor close request. Inline text edit consumes Escape inside the editor. |
| Arrow keys            | Nudge selected nodes by `1%`; `Shift+Arrow` nudges by `5%`. Locked selected nodes are ignored by mutation helpers.                                   |
| `Alt+Arrow`           | Resize selected unlocked layout entries by the same step size; aspect-locked nodes preserve aspect ratio.                                            |
| `Tab` / `Shift+Tab`   | Traverse the stage roving-tabindex order. Arrow keys do not perform focus traversal on the stage.                                                    |
| Space / `Shift+Space` | Select the focused node or toggle it into/out of the selection.                                                                                      |
| `Ctrl/Cmd+A`          | Select all selectable nodes for the current selection mode.                                                                                          |
| `Ctrl/Cmd+G`          | Group selection; `Ctrl/Cmd+Shift+G` ungroups.                                                                                                        |
| Delete / Backspace    | Delete selected nodes.                                                                                                                               |
| `Ctrl/Cmd+D`          | Duplicate selected nodes and select the duplicates.                                                                                                  |
| `Alt+]`               | Select-under cycle at the focused element center.                                                                                                    |
| `C` / `Shift+C`       | Keyboard connector flow when connector preconditions are met.                                                                                        |

Inline text editing and table-cell editing own their editing keys while active;
the stage must not intercept arrows, typing, or editing shortcuts from those
surfaces. `Alt` retains two pointer meanings: `Alt`-click cycles select-under,
and `Alt`-drag duplicates moved nodes while disabling snap during that drag.

## Precision Fallbacks

Semantic scoring should make common cases feel intelligent, but it is not a
replacement for precise layer selection.

- The layer list remains the deterministic way to select any element regardless
  of occlusion.
- The context menu exposes a `Select layer` section when multiple hit-test
  candidates are under the pointer, sorted by score/z-index.
- Select-under cycling reuses the same candidate list without changing default
  hover behavior: `Alt`-click cycles at the pointer, and `Alt+]` cycles at the
  focused element center.

These fallbacks are especially important for fully covered arbitrary objects,
nearly identical stacked shapes, locked/background layers, and dense groups.

## Performance And Caching

Pointer movement can fire at high frequency. The stage already batches pointer
processing with `requestAnimationFrame`; hit testing should preserve that model.

Implementation guidance:

- Keep hit-test helpers pure and DOM-free where possible.
- Reuse fitted boxes computed for rendering/manipulation.
- Avoid measuring DOM line boxes on every pointer move; cache measured text
  geometry if precise text hit testing is added later.
- Consider a spatial index only if slides grow beyond typical element counts.
- Keep hover preselection advisory so it never writes deck state or schedules
  autosave.

## Known Limitations And Future Work

- Text hit boxes use DOM-measured line/content boxes when the cache is available
  and fall back to heuristic boxes on cache miss. The cache is invalidated when
  slide elements, fitted boxes, or stage dimensions change.
- Visual and image hit testing is box-based. Alpha-aware image picking and
  visual-node hit testing could make sparse media behave more like Canva.
- If future group handles diverge from the multi-selection handle strategy, they
  should stay on the named top-layer chrome scale in `stage-chrome.ts`.
- Fully covered arbitrary objects cannot always be inferred correctly from a
  single pointer point. If semantic scoring is ambiguous, right-click layer
  selection or the layer list remains the precise fallback.
- Select-under cycling uses the ordered candidate list returned by the hit-test;
  it remains a precision fallback rather than a replacement for semantic
  scoring.

## Invariants

1. Hover preselection is advisory and never mutates the deck.
2. Selection state changes only through explicit pointer/keyboard/menu actions.
3. Moving/resizing starts only after the pointer passes the drag threshold.
4. Hit testing is pure and covered by DOM-free tests.
5. Visual frames render above slide elements but never intercept pointer events.
6. Connector/line hit testing is distance based, not bounding-box based.
7. Locked nodes can be selected for inspection but must not be mutated or enter
   edit modes through pointer, transform, or keyboard shortcuts.
8. `SlideCanvasVNext` remains read-only; all interaction logic lives in the stage.

## Primary Tests

- [`src/components/presentation-vnext/selection-model.test.ts`](../../src/components/presentation-vnext/selection-model.test.ts)
- [`src/components/presentation-vnext/stage-pointer-interactions.test.ts`](../../src/components/presentation-vnext/stage-pointer-interactions.test.ts)
- [`src/components/presentation-vnext/slide-editor-vnext-node-drag-threshold.test.ts`](../../src/components/presentation-vnext/slide-editor-vnext-node-drag-threshold.test.ts)
- [`src/components/presentation-vnext/slide-editor-vnext-inline-text-editor.failures.test.ts`](../../src/components/presentation-vnext/slide-editor-vnext-inline-text-editor.failures.test.ts)
- [`src/components/presentation-vnext/slide-editor-vnext-stage-selection.failures.test.ts`](../../src/components/presentation-vnext/slide-editor-vnext-stage-selection.failures.test.ts)
- [`src/components/presentation-vnext/multi-selection-transform.test.ts`](../../src/components/presentation-vnext/multi-selection-transform.test.ts)
- [`src/lib/presentation-vnext/selection-geometry.test.ts`](../../src/lib/presentation-vnext/selection-geometry.test.ts)
- [`src/lib/presentation-vnext/stage-chrome.test.ts`](../../src/lib/presentation-vnext/stage-chrome.test.ts)
- [`src/lib/presentation-vnext/stage-fit.test.ts`](../../src/lib/presentation-vnext/stage-fit.test.ts)
- [`src/lib/presentation-vnext/stage-guides.test.ts`](../../src/lib/presentation-vnext/stage-guides.test.ts)
