---
type: "plan"
status: "active — implementation pending"
last_updated: "2026-07-02"
description: "Remaining P2 PPTX fidelity work for gradients, pattern/image fills, effects, curved connectors, visual placeholders, and parity fixtures."
---

# PPTX Fidelity Plan

## Priority And Goal

**Priority:** P2.

Improve visible PPTX export fidelity while preserving deterministic diagnostics
for features that still require fallback behavior.

## Remaining Work

| Rank | Slice                        | Work                                                                                                                                                                                 | Exit criteria                                                                                    |
| ---: | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
|    1 | Native gradient mapping      | Map simple linear and radial gradient fills to native PPTX where stops, angle, and transparency can be represented faithfully.                                                       | Unsupported variants still emit clear diagnostics and parity fixtures cover native metadata.     |
|    2 | Image-retry fallback         | Rasterize nodes with image fills, conic gradients, repeating gradients, or other unsupported fill variants through the existing image-retry tier when native mapping is unavailable. | Crop, fit, opacity, and overlays match product render for affected nodes.                        |
|    3 | Pattern fill fidelity        | Map simple hatch/dot/stripe patterns to native PPTX and rasterize complex authored patterns when needed.                                                                             | Single-color fallback remains only when neither native nor raster representation is safe.        |
|    4 | Effect fidelity              | Rasterize glass and blur nodes, evaluate constrained native glow mapping, and group diagnostics for remaining effect fallbacks.                                                      | Effect fallback warnings are actionable and no longer repeat low-level noise per affected style. |
|    5 | Curved connector export      | Map simple curved routing to native PPTX connector/curve primitives while preserving endpoints, stroke, dash, and arrowheads.                                                        | Unsupported geometry falls back clearly without losing editable connectors by default.           |
|    6 | Visual placeholder preflight | Attempt to resolve or generate missing rendered visual assets before PPTX export; keep labeled placeholders only as final fallback.                                                  | Diagnostics explain how to regenerate or attach missing visual assets.                           |
|    7 | Fidelity parity fixtures     | Add shared parity decks covering gradients, pattern fills, image fills, effects, curved connectors, and unresolved visuals.                                                          | Each implementation slice updates focused parity tests and verifies remaining diagnostics.       |

## Constraints

- Do not implement whole-deck raster export in this plan.
- Do not add PPTX import.
- Raster fallback should target only affected nodes or visuals when possible.

## Verification

Each implementation follow-up must run `npm run test:presentation` and add or
update focused PPTX parity tests for the affected feature.
