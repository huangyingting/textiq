---
type: "design"
status: "current"
last_updated: "2026-07-17"
description: "This document defines how the slide editor stage should choose, preview, select, move, resize, and edit Deck nodes when many nodes overlap. It is the interaction contract for the presentation slide editor stage, not the persisted deck schema."
---

# Slide Stage Interactions

This document defines how the slide editor stage should choose, preview, select,
move, resize, and edit Deck nodes when many nodes overlap. It is the
interaction contract for the presentation slide editor stage, not the persisted deck
schema.

## Legacy Parity Status

presentation already owns the production stage interaction model. A bulk port of the
legacy v6 stage editor is not needed: legacy interaction code is coupled to v6
flat element arrays and `groupId`, while presentation uses Deck node trees,
`GroupNode.children`, and presentation command helpers. Verified parity includes
align/distribute/match-size, Shift+nudge, select-all, group/ungroup,
undo/redo, rotation snapping, keyboard connector flow, clipboard,
duplicate/delete, connector endpoint editing, group-bounds multi-selection
resize/rotate, and deterministic double-click finalization. The remaining
difference is a UX affordance only: presentation creates connectors by
insert-then-endpoint-drag rather than a single drag-from-source gesture.

## Source Files

| Area                   | Source                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Stage UI/controller    | [`src/components/presentation/slide-editor.tsx`](../../src/components/presentation/slide-editor.tsx)                           |
| Read-only canvas       | [`src/components/presentation/slide-canvas.tsx`](../../src/components/presentation/slide-canvas.tsx)                           |
| Node renderer          | [`src/components/presentation/slide-node-renderer.tsx`](../../src/components/presentation/slide-node-renderer.tsx)             |
| Selection model        | [`src/components/presentation/selection-model.ts`](../../src/components/presentation/selection-model.ts)                       |
| Selection geometry     | [`src/lib/presentation/selection-geometry.ts`](../../src/lib/presentation/selection-geometry.ts)                               |
| Stage pointer helpers  | [`src/components/presentation/stage-pointer-interactions.ts`](../../src/components/presentation/stage-pointer-interactions.ts) |
| Stage gesture drafts   | [`src/components/presentation/stage-gesture-feedback.tsx`](../../src/components/presentation/stage-gesture-feedback.tsx)       |
| Multi-select geometry  | [`src/components/presentation/multi-selection-transform.ts`](../../src/components/presentation/multi-selection-transform.ts)   |
| Table editing          | [`src/components/presentation/use-table-cell-editing.ts`](../../src/components/presentation/use-table-cell-editing.ts)         |
| Stage chrome layering  | [`src/lib/presentation/stage-chrome.ts`](../../src/lib/presentation/stage-chrome.ts)                                           |
| Stage fit              | [`src/lib/presentation/stage-fit.ts`](../../src/lib/presentation/stage-fit.ts)                                                 |
| Stage guides           | [`src/lib/presentation/stage-guides.ts`](../../src/lib/presentation/stage-guides.ts)                                           |
| Context toolbar        | [`src/components/presentation/toolbar/context-toolbar.tsx`](../../src/components/presentation/toolbar/context-toolbar.tsx)     |
| Stage hit testing      | [`src/lib/presentation/stage-hit-test.ts`](../../src/lib/presentation/stage-hit-test.ts)                                       |
| Render-order traversal | [`src/lib/presentation/render-order.ts`](../../src/lib/presentation/render-order.ts)                                           |
| Selection traversal    | [`src/components/presentation/selection-traversal.ts`](../../src/components/presentation/selection-traversal.ts)               |
| Layers panel           | [`src/components/presentation/inspector/layers-panel.tsx`](../../src/components/presentation/inspector/layers-panel.tsx)       |

## Goals

- Hover feedback should feel Canva-like: moving the pointer over the stage shows
  the element the editor believes the user is most likely targeting.
- Selection, drag, double-click edit, and context-menu targeting should use the
  same shared hit-test and render-order traversal rather than DOM stacking.
- Large text/list frames and large background-like shapes should not make lower
  content impossible to target.
- Selected/preselected frames must remain visible even when the target element is
  behind another element.
- Direct manipulation must stay predictable: click selects, second click edits
  text, drag starts only after pointer travel crosses the drag threshold.

## Interaction State Machine

The stage should be treated as a small state machine, even though some state is
currently represented by refs and React state in `SlideEditor`.

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

| Input          | Behavior                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mouse/trackpad | Full hover preselection, click selection, drag threshold, double-click edit, context menu.                                                                  |
| Pen/stylus     | Treat like pointer input; hover preselection is available only on devices/browsers that emit hover-style pointer movement.                                  |
| Touch          | No reliable hover. Tap should select, second tap edits editable text, drag threshold starts movement.                                                       |
| Keyboard       | Uses roving tabindex and keyboard canvas helpers; `Enter` enters the current target, arrows nudge, and `Shift+F10` or the Menu key opens overlap selection. |
| Screen readers | Use focus, selection announcements, and the layer list. Preselection itself is advisory visual chrome.                                                      |

Touch and keyboard users must always have deterministic alternatives through
selection, traversal, and the layer list; they should never depend on hover-only
feedback.

## Semantic Hit Testing

The stage does not rely on DOM overlay boxes for target selection. Instead,
`stage-hit-test.ts` computes geometry-aware candidates from the pointer position
and current slide nodes. Candidate scoring and candidate ordering are separate:
the helper can return semantic-score order or topmost visual order, and the
current stage interaction paths explicitly request visual order.

The hit-test pipeline is:

1. Convert client coordinates to slide percent coordinates.
2. Canonically sort each sibling list by finite `layout.zIndex`, using stable
   source order for ties, then flatten in visual preorder: each node, then its
   descendants, then later siblings. Missing, `NaN`, and infinite z-index values
   deterministically fall back to zero. A hidden node prunes its entire subtree.
3. Drop layoutless nodes and, unless `includeLocked` is true, each locked node.
   Locking is not inherited, so unlocked descendants of a locked group remain
   candidates.
4. Apply node-specific geometry and assign a semantic `score` and `reason`.
5. Order the candidates according to `StageHitTestOptions.order`:
   - `"semantic"` is the default helper mode. It normally prefers descendants
     over ancestor groups, then higher scores, then later visual preorder.
   - `"visual"` ignores scores for ordering and reverses the exact visual
     preorder, producing foreground-to-background order.

Both modes use the same canonical sibling ordering. The modes differ in candidate
scoring and whether hidden subtrees are retained, not in visual stacking.

`StageHitCandidate` carries:

- `node`: the target `SlideChildNode`;
- `frame`: the node's `LayoutBox["frame"]`;
- `score`: semantic priority;
- `reason`: why the candidate was included.

### Visual And Management Traversal

`flattenNodesInRenderOrder` has two explicit modes:

- `mode: "visual"` supports hidden-node pruning. When the hidden predicate
  matches a group, neither the group nor any descendant enters hit testing or
  selection reading order.
- `mode: "management"` visits every node and descendant. `LayersPanel` uses this
  mode, then reverses the preorder so user layers are shown
  foreground-to-background while hidden groups and descendants remain listed.

Nested groups preserve stacking contexts in both modes: each parent sorts only
its direct children by canonical z-index, a parent precedes its sorted
descendants in preorder, and the complete group subtree stays at the parent
group's position among its own siblings. A child's z-index cannot escape its
group to cover a later top-level sibling. Reversing that preorder puts
foreground siblings first and descendants before their parent. The Layers panel
mirrors this ordering while its management traversal additionally retains hidden
subtrees. Keyboard reading order also starts from visual traversal, but then
sorts visible layout nodes by explicit `accessibility.readingOrder` or position.

### Scoring Intent

Scores are intentionally semantic and independent of `zIndex`; canonical
z-index still determines the visual preorder that breaks visual-mode ties.
Examples:

| Candidate condition                  | Priority intent                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Text/list actual content hit         | Very high. Semantic order can prefer text content even when a shape also contains the point.                       |
| Text/list near content               | High. A little tolerance around text makes targeting humane.                                                       |
| Text/list frame-only hit             | Low in semantic order.                                                                                             |
| Connector or line stroke hit         | Very high. Thin objects use a generous distance threshold to become candidates.                                    |
| Shape edge hit                       | Very high in semantic order.                                                                                       |
| Small shape interior                 | High in semantic order.                                                                                            |
| Medium shape interior                | Medium-high in semantic order.                                                                                     |
| Large/background-like shape interior | Low. Semantic order treats large covering shapes as likely backgrounds or containers.                              |
| Selected node                        | Optional strong bonus for callers that opt in; current hover, pointer-down, double-click, and menu stacks opt out. |

These scores explain semantic-order results, not topmost visual picking. In
semantic order, text content can outrank a large covering shape, while a shape
edge can outrank the text. The current stage hover, pointer-down, double-click,
context-menu, and overlap paths request `"visual"`, so their first candidate is
the last eligible node in visual preorder; scores and reasons remain available
as candidate metadata.

## Element-Specific Hit Rules

### Text

Text elements should not use the entire frame as their primary hit area.

- Actual text line/content area -> `text-content`.
- Slightly inflated text area -> `text-near`.
- Frame-only hit -> `text-frame`, low score.
- Alignment and vertical alignment affect the estimated visible text box.

The current implementation estimates the visible text frame from non-empty
paragraph lines, character count, font size, line height, alignment, vertical
alignment, and stage aspect ratio. It does not consume DOM measurements.

### List Paragraphs

List paragraphs use the same text-node path:

- `TextNode.content.paragraphs[]` is authoritative. A paragraph's optional
  `list.kind` is `"bullet"` or `"number"`, and `list.indent` carries nesting
  depth.
- Hit estimation currently uses paragraph text only; markers and indentation do
  not add separate measured hit regions.
- Semantic order gives visible/near text higher scores than large shape
  interiors, while current visual stage order remains foreground-to-background.

### Shapes

Shape rules depend on shape kind:

- Rectangles: box hit, with edge vs interior scoring.
- Ellipses: mathematical ellipse hit test.
- Triangles: triangle area hit test.
- Diamonds: normalized diamond area hit test.
- Lines: distance-to-line-segment threshold; line bounding boxes are not enough.

Large interior-only shape hits are downweighted so background-like shapes do not
make text and small objects underneath impossible to target. Shape edges remain
high priority so users can still select/manipulate the shape deliberately.

### Connectors

Connectors must be considered in both preselection and direct manipulation.

- Hit testing resolves point endpoints inside the connector frame and bound
  endpoints from the target node's current layout frame.
- Straight paths use one segment, elbow paths use three segments, and curved
  paths use a sampled cubic path; all use a distance threshold.
- Connector endpoint handles remain separate editing affordances once the
  connector is selected.
- While dragging an endpoint, the active endpoint interaction suppresses general
  hover preselection.

A connector is not selected by its full bounding box. It should be targetable
near its stroke, with enough tolerance to be practical.

### Visuals And Images

Visual and image nodes currently use their layout frame and the
`"box-interior"` reason. There is no alpha-aware image or visual-subregion hit
geometry in `stage-hit-test.ts`.

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

| Gesture                  | Target source                         | Result                                                                                         |
| ------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Pointer move             | first visual-order hit candidate      | update preselection while idle/selected-idle                                                   |
| Pointer down on element  | first visual-order hit candidate      | select target immediately, enter `press-pending`                                               |
| Pointer move threshold   | existing drag ref                     | enter moving/resizing/rotating and suppress hover preselection                                 |
| Pointer up no movement   | press-pending target                  | select only, or enter inline edit if it was the already selected editable text element         |
| Double click             | first visual-order hit candidate      | collapse to the target, then enter text or table edit when allowed; groups remain selected     |
| Context menu             | current node plus visual-order stack  | select target and open menu for that target                                                    |
| Select-under cycle       | filtered visual-order candidate stack | the context-menu command selects the next candidate and wraps                                  |
| Stage empty click        | no semantic hit, no marquee movement  | commit/exit current edit, clear selection, and exit group/table context                        |
| Stage empty double click | true canvas background                | commit/exit current edit, insert a text node at the point, select it, and enter inline editing |
| Multi-selection bounds   | stage chrome                          | retain current selection; do not insert text, clear selection, or enter editing                |

Pointer-down target resolution and hover preselection use the same reverse
visual-preorder candidate list without selected-node stickiness, so the object
shown as preselected is also the object a normal drag starts from. Hover only updates
`hoveredNodeId`; pointer-down stores a press-pending target; movement past
the threshold promotes that target into the active manipulation state.

Preselection must be computed from the stage-level semantic pointermove path.
Node-level DOM `pointerenter`/`pointerleave` handlers must not write preselection
state directly, because the event target and shared render-tree traversal can
disagree for overlapping or grouped objects.

Selected-node bonus remains an opt-in semantic-order feature. Current visual
hover, pointer-down, double-click, context-menu, and overlap stacks disable it so
the topmost visual result does not change with selection.

The raw `StageHitCandidate` is resolved through `stage-targeting.ts` before
selection semantics are applied. This keeps group behavior consistent across
hover, pointer-down, double-click, context-menu selection, and overlap commands
while preserving the raw candidate stack for precision menus.

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
- double-clicking a group collapses selection to and focuses the group without
  entering a child; keyboard `Enter` on a selected, unlocked group enters and
  selects its first child;
- image, visual, shape, and connector nodes only collapse to single selection;
- locked nodes are excluded from default hit targeting; a locked node selected
  through a management or focus path does not enter text/table/group editing;
- modifier keys do not add double-click selection semantics and do not trigger
  duplicate behavior.

If another inline text editor or table editor is active, double-click first
commits/exits the current editor and then performs the new target action.

## Groups And Multi-Selection

Groups add another semantic layer over hit testing. They are logical
selection/stacking containers, not nested visual transform containers. Child
frames and rotations are stored in slide-absolute coordinates. Moving, resizing,
or rotating a group updates descendant geometry, so renderers and exporters must
not apply the group transform again. Group `style` and `localStyle` are rejected
at the schema boundary rather than stored and ignored; descendant styling remains
authoritative. Group layout remains meaningful for selection bounds, group
commands, hit testing, and the subtree's position in its parent stacking context.

- An initial click on a grouped member selects the group as a unit. Once the
  group is selected, progressive targeting can select a member without entering
  a persistent group-editing mode.
- Group children sort only against their siblings. Editor, present/public
  rendering, hit testing, Layers, and export use that same nested ordering.
- A hidden group prunes its full subtree from visual hit testing and keyboard
  reading order. The Layers panel intentionally uses management traversal so the
  hidden group and descendants remain available for selection, rename,
  visibility, lock, and enabled same-parent sibling-reorder controls.
- A locked group remains in the visual tree, but the group node itself is
  excluded from default hit candidates. Unlocked descendants remain candidates:
  lock state is not inherited. Progressive group targeting still applies normal
  group-entry selection rules, while mutation/edit checks use each resolved
  node's own lock state.
- Ungroup locates the selected group recursively, replaces it with its direct
  children in the same parent list and sibling position, and preserves child
  identity, geometry, style, source metadata, and nested group structure. Locked
  and hidden groups are not ungroupable.
- `stage-targeting.ts` is the shared boundary that turns a raw hit node into
  either a direct node target or a parent-group target.
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

### Guide Snapping Ownership

The top-toolbar snap toggle is editor-session state and starts enabled on every
editor mount. Disabling it gates alignment and custom-guide snapping and clears
transient snap feedback, but it does not hide grid, ruler, or custom-guide
overlays and does not write deck state. Grid, ruler, custom-guide visibility,
and custom-guide positions are separate document-scoped local-storage
preferences; they survive reload, while the snap toggle returns to enabled.

When group behavior and semantic hit-testing disagree, progressive selection
context is the authority: an unselected group resolves to group-level selection;
an already selected group can resolve to member-level selection.

## Overlap Cases

| Scenario                                          | Current result                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Large text frame and shape both contain the point | Visual stage paths choose the later eligible visual-preorder node; semantic order can prefer actual text content over a large interior. |
| Pointer near shape edge                           | The shape receives a high semantic score; visual order still decides current stage topmost targeting.                                   |
| Small shape over text                             | The small shape receives a high semantic score; visual order still decides current stage topmost targeting.                             |
| Selected large shape over text                    | Current visual stage paths disable selected-node bonus; selection does not reorder the visual hit stack.                                |
| Multiple arbitrary fully covered objects          | Context-menu overlap selection and the Layers panel provide deterministic foreground-to-background access.                              |
| Line/connector over any element                   | It becomes a candidate only near its stroke; visual order chooses among candidates, while semantic order gives the stroke a high score. |
| Locked object over editable object                | The locked node itself is excluded by default, so an eligible node underneath can be targeted.                                          |

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
| `Shift+F10` / Menu    | Open the focused node menu at its center. When overlap candidates exist, `Select next overlapping element` receives initial focus.                   |
| `C` / `Shift+C`       | Keyboard connector flow when connector preconditions are met.                                                                                        |

Inline text editing and table-cell editing own their editing keys while active;
the stage must not intercept arrows, typing, or editing shortcuts from those
surfaces. `Alt`-click without movement keeps normal topmost visual selection.
`Alt`-drag duplicates moved nodes; the duplication path uses its own move preview
rather than the ordinary select-under command.

## Precision Fallbacks

Geometry-aware candidate collection and explicit visual ordering do not replace
precise layer selection. Semantic-score order remains a separate helper mode.

- The Layers panel remains the deterministic way to select any user node
  regardless of occlusion. It uses management traversal, includes hidden
  subtrees, and presents user nodes in reversed canonical preorder. Its move
  controls reorder only direct siblings within the selected node's parent.
- The context menu exposes a `Select layer` section when multiple hit-test
  candidates remain under the pointer, ordered foreground-to-background by
  reverse visual preorder.
- Select-under cycling uses that visual candidate list without changing hover
  behavior. Keyboard users press `Shift+F10` or the Menu key, then invoke
  `Select next overlapping element`; pointer users can open the same context
  menu. `Alt`-click does not cycle because it shares the `Alt`-drag duplication
  gesture.
- Hidden subtrees and locked nodes are filtered before overlap commands are
  offered. The command is absent unless at least two selectable candidates
  remain.
- Cycling advances from the current candidate and wraps to the top. Menu
  invocation focuses the command; selection then moves focus to the chosen
  element and announces its label through the stage polite live region.
- `semanticCandidateStackRef` is populated after hit collection and cleared when
  slide children, active slide, source document, selection, or context-menu
  state changes, and when stage interactions become blocked. The open context
  menu keeps its captured `candidateIds`; reopening it reruns hit testing against
  current state.

These fallbacks are especially important for fully covered arbitrary objects,
nearly identical stacked shapes, locked/background layers, and dense groups.

## Performance And Caching

Pointer movement can fire at high frequency. Current pointer-move hit testing is
synchronous. The hover path skips hit testing during explicit stage gestures,
while stage interactions are blocked, and over editable or editing-handle
targets; hit testing uses the current slide nodes' existing layout frames.

Implementation guidance:

- Keep hit-test helpers pure and DOM-free where possible.
- Keep grid/ruler/custom guide overlays as editor-only, pointer-transparent
  chrome; only normalized guide positions should enter the pure snapping
  pipeline.
- Reuse layout frames already used for rendering and manipulation.
- Keep text hit estimation DOM-free on pointer move. If measured text geometry is
  added later, compute and cache it outside the pure hit-test path.
- Consider a spatial index only if slides grow beyond typical element counts.
- Keep hover preselection advisory so it never writes deck state or schedules
  autosave.

## Known Limitations And Future Work

- Text hit geometry is heuristic rather than DOM-measured.
- Visual and image hit testing is frame-based. Alpha-aware image picking and
  visual-node hit testing could make sparse media behave more like Canva.
- If future group handles diverge from the multi-selection handle strategy, they
  should stay on the named top-layer chrome scale in `stage-chrome.ts`.
- A single pointer point cannot infer intent among fully covered arbitrary
  objects. Current visual order is deterministic; context-menu layer selection
  or the Layers panel remains the precise fallback.
- Select-under cycling uses the visual-order candidate list returned by the
  hit-test; semantic-order scoring remains a separate helper mode.

## Invariants

1. Hover preselection is advisory and never mutates the deck.
2. Selection state changes only through explicit pointer/keyboard/menu actions.
3. Moving/resizing starts only after the pointer passes the drag threshold.
4. Hit testing is pure and covered by DOM-free tests.
5. Visual frames render above slide elements but never intercept pointer events.
6. Connector/line hit testing is distance based, not bounding-box based.
7. Locked nodes remain available through management/focus flows, but default hit
   targeting, transforms, and edit entry exclude them; explicit unlock controls
   remain available.
8. `SlideCanvas` remains read-only; all interaction logic lives in the stage.

## Primary Tests

- [`src/components/presentation/selection-model.test.ts`](../../src/components/presentation/selection-model.test.ts)
- [`src/components/presentation/stage-pointer-interactions.test.ts`](../../src/components/presentation/stage-pointer-interactions.test.ts)
- [`src/components/presentation/stage-context-menu.test.ts`](../../src/components/presentation/stage-context-menu.test.ts)
- [`src/components/presentation/use-semantic-candidate-stack-reset.test.ts`](../../src/components/presentation/use-semantic-candidate-stack-reset.test.ts)
- [`src/components/presentation/selection-traversal.test.ts`](../../src/components/presentation/selection-traversal.test.ts)
- [`src/components/presentation/inspector/layers-panel.test.ts`](../../src/components/presentation/inspector/layers-panel.test.ts)
- [`src/components/presentation/slide-editor-node-drag-threshold.test.ts`](../../src/components/presentation/slide-editor-node-drag-threshold.test.ts)
- [`src/components/presentation/slide-editor-inline-text-editor.failures.test.ts`](../../src/components/presentation/slide-editor-inline-text-editor.failures.test.ts)
- [`src/components/presentation/slide-editor-stage-selection.failures.test.ts`](../../src/components/presentation/slide-editor-stage-selection.failures.test.ts)
- [`src/components/presentation/multi-selection-transform.test.ts`](../../src/components/presentation/multi-selection-transform.test.ts)
- [`src/lib/presentation/selection-geometry.test.ts`](../../src/lib/presentation/selection-geometry.test.ts)
- [`src/lib/presentation/stage-hit-test.test.ts`](../../src/lib/presentation/stage-hit-test.test.ts)
- [`src/lib/presentation/render-tree.test.ts`](../../src/lib/presentation/render-tree.test.ts)
- [`src/lib/presentation/stage-chrome.test.ts`](../../src/lib/presentation/stage-chrome.test.ts)
- [`src/lib/presentation/stage-fit.test.ts`](../../src/lib/presentation/stage-fit.test.ts)
- [`src/lib/presentation/stage-guides.test.ts`](../../src/lib/presentation/stage-guides.test.ts)
