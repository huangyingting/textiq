---
type: "plan"
status: "active — P2 spike, awaiting leaf-issue scheduling"
last_updated: "2026-07-02"
description: "Plan ranked PPTX fidelity improvements for gradients, pattern and image fills, effects, curved connectors, and visual placeholders."
---

# PPTX fidelity plan

## Priority and goal

**Priority:** P2 spike.

**Goal:** Decide which visible PPTX export fidelity losses should move to closer native PPTX mapping, high-fidelity image fallback, or improved warning UX, then split implementation into leaf issues that can be tested with presentation export parity coverage.

## Current behavior and recommendations

The current support matrix says product rendering supports slide background gradients, patterns, and image fills, while PPTX export only supports solid backgrounds, uses deterministic color fallbacks for gradients and patterns, and has no fill for image fills (`docs/presentation/rendering-and-export.md:214-216`). It also says effects render in product CSS, but PPTX export uses deterministic style fallback (`docs/presentation/rendering-and-export.md:224-225`), and curved connectors export as straight fallbacks (`docs/presentation/rendering-and-export.md:221`). Diagnostics use the existing `unsupported-export-feature` and related export fallback channels (`src/lib/presentation-vnext/diagnostics.ts:37-39`).

### 1. Gradient fills — map native where possible; rasterize only unsupported variants

**Current behavior:** `fillToHex` collapses linear gradients to the `from` color, radial gradients to the `inner` color, conic gradients to the first stop, and repeating linear gradients to the first stop, emitting `unsupported-export-feature` warnings for each (`src/lib/presentation-vnext/pptx-lowerers/shared.ts:100-131`). The support matrix describes this as deterministic color fallback (`docs/presentation/rendering-and-export.md:214-216`).

**Recommendation:** Rank this first for user visibility and moderate effort. Map simple `linearGradient` and `radialGradient` fills to native PPTX gradient fills when the adapter can preserve stops, angle, and transparency well enough. For `conicGradient` and `repeatingLinearGradient`, use the existing image-retry tier (`visualToNativeSpecs` / image embed) because native PPTX support is unlikely to match authored CSS semantics. Keep the current single-color fallback only when native mapping and node rasterization are both unavailable, but improve the warning copy to name the chosen degradation.

### 2. Image fills — rasterize the node as a high-fidelity image

**Current behavior:** `fillToHex` emits an `unsupported-export-feature` warning for `fill.type === "image"` and returns `undefined`, so PPTX export uses no fill (`src/lib/presentation-vnext/pptx-lowerers/shared.ts:140-147`). The support matrix also records image fill as unsupported/no fill (`docs/presentation/rendering-and-export.md:214-216`).

**Recommendation:** Rank this second because disappearing image fills are highly visible on branded decks, cards, and hero slides. Prefer rasterizing the affected node through the existing image-retry tier so crop, fit, repeat, masks, opacity, and overlays match product render without introducing partial native semantics. Consider native picture/texture fills only as a later optimization for simple rectangular frames after raster parity is stable.

### 3. Pattern fills — native-map simple patterns; rasterize complex authored patterns

**Current behavior:** `fillToHex` emits `unsupported-export-feature` for `fill.type === "pattern"` and returns the pattern background or color as a single deterministic fallback color (`src/lib/presentation-vnext/pptx-lowerers/shared.ts:132-139`). The support matrix groups patterns with gradient color fallback behavior (`docs/presentation/rendering-and-export.md:214-216`).

**Recommendation:** Rank this third because patterns can be brand-visible but are usually less catastrophic than a missing image fill. Map simple hatch/dot/stripe patterns to the closest native PPTX pattern fill when foreground and background colors are enough to preserve intent. Rasterize custom, image-like, scaled, or theme-composed patterns through the existing image-retry tier. Keep the single-color fallback only for unsupported pattern metadata, with warnings that name the lost pattern type.

### 4. Glass, blur, and glow effects — rasterize glass/blur; native-map simple glow only if cheap

**Current behavior:** `checkEffect` emits `unsupported-export-feature` for `glass`, `blur`, and `glow`, with the message that each effect uses a deterministic export fallback (`src/lib/presentation-vnext/pptx-lowerers/shared.ts:174-189`). The support matrix says effects render in CSS where supported but are not native in current PPTX export (`docs/presentation/rendering-and-export.md:224-225`).

**Recommendation:** Rank this fourth: effects are visually important, but implementation complexity varies. Rasterize nodes using `glass` and `blur` because background sampling and backdrop-filter behavior are difficult to express natively in PPTX. Investigate native PPTX glow/shadow mapping for a constrained `glow` subset; if color/radius/opacity cannot be preserved consistently, route glow through the same image-retry path. Keep fallback warnings for effects that cannot be rasterized, but group them so users see actionable summary guidance instead of repeated low-level style messages.

### 5. Curved connectors — map to native curved connector when geometry is simple

**Current behavior:** the connector lowerer detects `routing === "curved"`, emits `unsupported-export-feature`, and warns that PPTX export uses a straight-line fallback (`src/lib/presentation-vnext/pptx-lowerers/shape-connector-lowerer.ts:61-71`). The returned connector still carries routing metadata (`src/lib/presentation-vnext/pptx-lowerers/shape-connector-lowerer.ts:72-83`), but current export behavior is straight fallback per the support matrix (`docs/presentation/rendering-and-export.md:221`).

**Recommendation:** Rank this fifth: visible in diagrams, but usually less destructive than lost fills. Map simple curved connectors to the closest native PPTX connector/curve primitive while preserving endpoints, stroke, dash, and arrows. If native mapping cannot preserve authored control points, use straight fallback plus improved warnings rather than rasterizing by default, because rasterized connectors lose editability and can blur at deck scale. Reserve rasterization for grouped diagram nodes where the whole diagram already uses the image-retry tier.

### 6. Visuals without rendered assets — improve warning UX and asset generation path

**Current behavior:** a visual op with neither `assetId` nor `visualId` emits `missing-asset` and uses a labeled placeholder; a visual with `visualId` but no `assetId` emits `unsupported-export-feature` and also uses a labeled placeholder (`src/lib/presentation-vnext/pptx-lowerers/visual-block-lowerer.ts:53-65`). The support matrix says rendered visual assets embed as images, while visual-id-only nodes use labeled placeholders (`docs/presentation/rendering-and-export.md:219`).

**Recommendation:** Rank this sixth because it is visible but often indicates a missing pre-export asset pipeline rather than a lowerer-only fidelity gap. Keep the placeholder fallback as the final deterministic behavior, improve warning UX to explain how to regenerate or attach the visual asset, and add a preflight/asset-generation follow-up that attempts the existing image embed path before export. Do not invent native mappings for unresolved visuals.

## Ranked summary

| Rank | Feature                 | User visibility | Effort      | Primary recommendation                                   | Fallback                                                 |
| ---: | ----------------------- | --------------- | ----------- | -------------------------------------------------------- | -------------------------------------------------------- |
|    1 | Gradient fills          | High            | Medium      | Native-map simple linear/radial gradients                | Rasterize conic/repeating or keep explicit color warning |
|    2 | Image fills             | High            | Medium      | Rasterize affected node via image-retry tier             | No fill only with improved warning                       |
|    3 | Pattern fills           | Medium-high     | Medium      | Native-map simple hatch/dot/stripe patterns              | Rasterize complex patterns or keep explicit warning      |
|    4 | Glass/blur/glow effects | Medium-high     | Medium-high | Rasterize glass/blur; native-map simple glow if faithful | Grouped warning UX                                       |
|    5 | Curved connectors       | Medium          | Medium      | Native-map simple curves                                 | Straight fallback with clearer warning                   |
|    6 | Visuals without asset   | Medium          | Low-medium  | Keep placeholder; improve UX and preflight asset path    | Placeholder fallback                                     |

## Proposed leaf issues

1. **PPTX native gradient mapping for simple fills.** Add adapter support for linear and radial gradient fills where stop count, angle, and transparency can be represented faithfully. Preserve current diagnostics for unsupported variants and add parity fixtures comparing native export metadata.
2. **Image-retry fallback for image fills and unsupported gradient fills.** Route nodes with image fills, conic gradients, and repeating gradients through the existing `visualToNativeSpecs` / image embed retry tier when native mapping is unavailable. Verify crop/fit/opacity behavior against product render.
3. **PPTX pattern fill fidelity.** Map simple hatch, dot, and stripe patterns to native PPTX pattern fills. Route complex authored patterns through image-retry and keep color fallback only when neither representation is safe.
4. **Effect fidelity fallback strategy.** Rasterize glass and blur nodes, evaluate a constrained native glow mapping, and otherwise use image-retry for glow. Add grouped diagnostics so users see one actionable effects summary per affected slide.
5. **Editable curved connector export.** Map simple curved routing to a native PPTX curved connector or freeform curve while preserving endpoints, stroke width, dash, and arrowheads. Keep straight fallback only for geometry that cannot be represented safely.
6. **Visual placeholder preflight and warning UX.** Before export, attempt to resolve or generate missing rendered visual assets for visual-id-only nodes. If unavailable, keep the labeled placeholder and improve diagnostics with asset-panel action guidance.
7. **PPTX fidelity parity fixtures.** Add focused parity decks covering gradients, pattern fills, image fills, effects, curved connectors, and unresolved visuals so future implementation leaf issues share one regression suite.

## Acceptance and verification

- This spike is complete when the plan is reviewed and leaf issues are scheduled; no implementation is part of this issue.
- Each implementation follow-up must run `npm run test:presentation`.
- Each implementation follow-up must add or update parity tests for the affected feature and verify diagnostics still describe any remaining fallback.
- Follow-ups that use raster output must verify that the existing image-retry tier embeds an image only for the affected node or visual, not as whole-deck raster export.

## Out of scope

- Implementation in this spike.
- Raster deck export tracked separately by #1618.
- PPTX import.
