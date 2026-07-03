---
type: "plan"
status: "active — native fill support blocked"
last_updated: "2026-07-03"
description: "Remaining P2 PPTX fidelity work for native gradient/pattern fills once the PPTX writer exposes representable fill metadata. Image-retry, effects, curved connectors, visual preflight, and parity fixtures are implemented."
---

# PPTX Fidelity Plan

## Priority And Goal

**Priority:** P2.

Improve visible PPTX export fidelity while preserving deterministic diagnostics
for features that still require fallback behavior.

## Remaining Work

| Rank | Slice                                | Work                                                                                                                                                                 | Exit criteria                                                                                |
| ---: | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
|    1 | Native gradient/pattern fill mapping | Map simple linear, radial, hatch, dot, and stripe fills to native PPTX once the PPTX writer exposes gradient/pattern fill props or a supported postprocess boundary. | Unsupported variants still emit clear diagnostics and parity fixtures cover native metadata. |

## Completed Work

| Slice                        | Implemented behavior                                                                                                                                                                                 | Evidence                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Image-retry fallback         | Gradient, pattern, image-fill, glass, and blur fallback-prone nodes lower to deterministic image-retry metadata instead of single-color fallbacks when native mapping is unavailable.                | `src/lib/presentation/pptx-lowerers/shared.ts`; `src/lib/presentation/pptx-export-adapter.test.ts`.                               |
| Effect fidelity              | Glass/blur nodes use image-retry diagnostics, and representable glow maps to native zero-distance outer shadow metadata.                                                                             | `src/lib/presentation/pptx-lowerers/shared.ts`; `src/lib/presentation/pptx-appliers/shared.ts`.                                   |
| Curved connector export      | Simple point-to-point curved routing lowers to editable native arc geometry while preserving stroke, dash, and arrowheads; unsupported endpoint geometry falls back to editable straight connectors. | `src/lib/presentation/pptx-lowerers/shape-connector-lowerer.ts`; `src/lib/presentation/pptx-appliers/shape-connector-applier.ts`. |
| Visual placeholder preflight | Export resolves declared visual assets and visual-registry rendered assets before placeholder fallback; missing/unsupported visuals emit actionable diagnostics.                                     | `src/lib/presentation/pptx-appliers/asset-sources.ts`; `src/lib/presentation/pptx-lowerers/visual-block-lowerer.ts`.              |
| Fidelity parity fixtures     | Shared parity deck covers linear/radial/conic/repeating gradients, pattern and image fills, effects, curved connectors, resolved visuals, and unresolved visuals.                                    | `src/test/fixtures/pptx-fidelity.ts`; `src/lib/presentation/pptx-export-adapter.test.ts`.                                         |

## Current Blocker

PptxGenJS 4.0.1 `ShapeFillProps` only exposes `type: "none" | "solid"`,
`color`, and transparency, and its fill XML generator only emits solid fills.
Native gradient or pattern fills should not be wired through untyped options
until the PPTX writer exposes a stable public API or this codebase adds a
controlled OpenXML postprocess boundary with focused archive-level tests.

## Constraints

- Do not implement whole-deck raster export in this plan.
- Do not add PPTX import.
- Raster fallback should target only affected nodes or visuals when possible.

## Verification

Each implementation follow-up must run focused PPTX adapter/applier tests and
add or update parity fixtures for the affected feature. Use `npm run
test:presentation` when the change crosses render/export boundaries.
