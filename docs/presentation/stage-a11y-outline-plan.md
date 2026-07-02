---
type: "plan"
status: "complete"
last_updated: "2026-07-02"
description: "Remaining P2 work for a content-first screen-reader deck outline and per-node narration on the presentation slide stage."
---

# Stage Accessibility Outline Plan

## Priority And Goal

**Priority:** P2.

Expose a content-first deck outline and deterministic per-node narration for
screen-reader users without replacing the existing canvas keyboard editing
model.

## Completed Work

| Slice                               | Work                                                                                                                                                                                    | Exit criteria                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Resolved outline adapter            | Convert `ResolvedSlideRenderTree` user nodes into a stable content outline with slide metadata, node roles, reading order, labels, and decorative/chrome filtering.                     | The outline model can be tested without scraping the canvas DOM.                                                                         |
| Outline region DOM                  | Render semantic deck or active-slide outline DOM near the stage without disrupting the existing canvas interaction model.                                                               | Screen readers can discover slide position, slide title/summary, and ordered node content.                                               |
| Per-node narration helper           | Derive deterministic labels/details for text, image, shape, table, visual, connector, group, and decorative nodes.                                                                      | Missing alt text, missing visual description, unbound connectors, and empty/decorative shapes have explicit fallback labels or warnings. |
| Table cell names                    | Improve table edit-mode cell labels with header context and content preview while preserving current keyboard behavior.                                                                 | Editable table cells announce more than row/column coordinates when header context exists.                                               |
| Reduced-motion/focus-visible checks | Added focused checks for outline-current updates, selection changes, table edit mode, locked/grouped nodes, high contrast review, and focus-visible states.                             | Accessibility release gates cover motion alternatives and visible keyboard focus.                                                        |
| Release-gate criteria               | Updated accessibility acceptance criteria to require deck/slide outline, per-node content labels, missing-content warnings, reduced-motion conformance, and focus-visible verification. | Sign-off can point to focused component/a11y tests for the outline and narration behavior.                                               |

## Constraints

- Do not rework the shipped canvas keyboard editing model.
- Do not change canvas pointer/keyboard editing semantics, export behavior, or
  free-draw connector authoring.
- The outline is for reading and orientation; editing actions remain in the
  canvas, inspector, and toolbar controls.

## Verification

Use focused accessibility/component tests for the outline adapter, rendered
outline DOM, per-node names, table cell labels, reduced-motion behavior, and
focus-visible states.
