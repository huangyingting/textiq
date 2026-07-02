---
type: "architecture"
status: "current"
last_updated: "2026-07-02"
description: "This document describes how authored decks render in the editor, present mode, public viewers, and export pipeline. For the deck JSON shape, see ../data-model/deck.md. For theme/layout resolution, see theme-packages.md."
---

# Presentation Rendering And Export

This document describes how authored decks render in the editor, present mode,
public viewers, and export pipeline. For the deck JSON shape, see
[../data-model/deck.md](../data-model/deck.md). For theme/layout resolution,
see [theme-packages.md](theme-packages.md).

## Source Files

| Area                  | Source                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared slide canvas   | [`src/components/presentation-vnext/slide-canvas.tsx`](../../src/components/presentation-vnext/slide-canvas.tsx)                               |
| Node renderer         | [`src/components/presentation-vnext/slide-node-renderer.tsx`](../../src/components/presentation-vnext/slide-node-renderer.tsx)                 |
| Render resolver       | [`src/lib/presentation-vnext/render-resolver.ts`](../../src/lib/presentation-vnext/render-resolver.ts)                                         |
| Render tree contract  | [`src/lib/presentation-vnext/render-tree.ts`](../../src/lib/presentation-vnext/render-tree.ts)                                                 |
| In-app present mode   | [`src/components/presentation-vnext/present-mode-vnext.tsx`](../../src/components/presentation-vnext/present-mode-vnext.tsx)                   |
| Public present viewer | [`src/components/presentation-vnext/public-present-viewer-vnext.tsx`](../../src/components/presentation-vnext/public-present-viewer-vnext.tsx) |
| Export spec builder   | [`src/lib/presentation-vnext/export-spec.ts`](../../src/lib/presentation-vnext/export-spec.ts)                                                 |
| PPTX spec adapter     | [`src/lib/presentation-vnext/pptx-export-adapter.ts`](../../src/lib/presentation-vnext/pptx-export-adapter.ts)                                 |
| PPTX applier          | [`src/lib/presentation-vnext/pptx-vnext-apply.ts`](../../src/lib/presentation-vnext/pptx-vnext-apply.ts)                                       |

## Rendering Contract

`SlideCanvasVNext` renders one slide from a `ResolvedSlideRenderTree`. It is
shared by:

- the editor stage;
- the thumbnail rail;
- in-app present mode;
- public present/share viewers.

`resolveDeckRenderTree` resolves canvas metadata, slide background, user nodes,
theme decorations, deck chrome, style tokens, asset diagnostics, and concrete
node styles before React rendering. Renderers and export appliers do not receive
unresolved token refs or theme package blueprints. Normal rendering order is:

```text
slide background
  -> theme decorations / deck chrome background layers
  -> user slide nodes
  -> deck chrome foreground layers
```

Theme decorations and deck chrome are resolved separately from authored user
nodes, so normal slide editing does not select or mutate them unless an explicit
command detaches them.

Supported element rendering:

| Node        | Runtime behavior                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `text`      | Paragraph content, rich text runs, fit mode, role/style binding, local style, and rotation.                                   |
| `visual`    | Renders visual placeholders or resolved visual image assets with channel-color defaults.                                      |
| `image`     | Renders deck image assets with fit/crop/alt metadata and missing-asset diagnostics.                                           |
| `shape`     | Renders shape geometry, fill/stroke/effect style, opacity, and rotation; labels are separate `text` nodes.                    |
| `connector` | Resolves point/node endpoints and renders straight/elbow/curved connector intent with per-node SVG marker ids for arrowheads. |
| `table`     | Renders a clipped grid with optional header, caption, alternating rows, borders, and cell runs.                               |
| `group`     | Renders nested child nodes in group-local order while preserving group lock/selection metadata.                               |

Renderers do not synthesize nodes from flat slide fields. A stored deck must
already be valid DeckV7 with slide content under `SlideNode.children`.
When a container-rendered node uses `fill.type: "image"`, the renderer draws the
fill as a separate overlay layer and applies `fill.opacity` there so node
content does not fade with the background image.

## Present Mode

`PresentModeVNext` is a full-screen, portal-mounted surface for the authenticated
app. It renders the current slide through the shared DeckV7 canvas and adds
presentation chrome:

- keyboard navigation: arrows, space, page keys, home/end;
- click and touch navigation;
- fullscreen toggle;
- speaker notes;
- slide overview;
- timer;
- laser pointer;
- keyboard help;
- HUD auto-hide.

The present surface fits the active slide format into the available viewport via
`fitAspectRatio` and `slideAspectRatio`. It does not mutate the deck.

Public present/share viewers use the same vNext rendering primitive so public
output tracks in-app rendering.

## Export Pipeline

The PPTX export path is split into a pure spec builder and a browser/PPTX
applier.

```text
DeckV7 + ThemePackageV1
  -> resolveDeckRenderTree
  -> buildExportSpec
  -> buildVnextPptxSpec
  -> applyVnextPptxSpec / exportDeckV7AsPPTX
  -> PptxGenJS file Blob
```

`buildExportSpec` is DOM-free and unit tested. It consumes the same resolved
render tree order as `SlideCanvasVNext`, converts resolved nodes into export
operations, and carries diagnostics forward. `buildVnextPptxSpec` converts those
operations into inch-based PPTX operations; `applyVnextPptxSpec` owns PptxGenJS
side effects.

Table export currently stays as a native table operation end to end:
`buildExportSpec` emits `tableShape`, `buildVnextPptxSpec` maps it to
`VnextPptxTableOp`, and `applyVnextPptxSpec` calls `slide.addTable(...)`.
Current adapter coverage maps column labels, row cell `text`, per-cell rich
`runs`, frame geometry, table text style, resolved
`headerFill`/`rowFill`/`alternateRowFill`, borders, and cell padding. Captions
export as separate PPTX text boxes positioned above the native table.
Unsupported table fill types (for example pattern or gradient) use deterministic
solid fallbacks and emit `unsupported-export-feature` diagnostics.

Visual operations use a rendered asset when one is available and otherwise emit
a deterministic placeholder with channel colors and diagnostics. PptxGenJS 4.0.1
does not expose native gradient or pattern fill props, so vNext PPTX export uses
the image-retry tier for gradient, pattern, image fills, and simple glass/blur
shape effects that cannot stay as a solid fill. Simple glow maps to a native
zero-distance outer shadow when color, blur, and opacity are representable.

## Preflight

Presentation export diagnostics are produced while resolving and building export
specs. Callers surface fatal errors and fidelity warnings before download.

Current diagnostic categories:

| Code                       | Severity | Meaning                                                               |
| -------------------------- | -------- | --------------------------------------------------------------------- |
| `missing-asset`            | fatal    | An image element has no resolvable source.                            |
| `missing-font`             | warning  | A presentation theme/brand typography font is not embeddable in PPTX. |
| `font-cjk-mapping`         | warning  | Editable PPTX maps the self-hosted CJK font to an Office face.        |
| `unsupported-pptx-feature` | warning  | A used feature has partial or unsupported PPTX fidelity.              |
| `raster-fallback`          | warning  | An image feature will rasterize rather than remain vector/native.     |
| `remote-image-failure`     | warning  | A remote image may fail during export.                                |
| `oversized-deck`           | warning  | Slide count exceeds the configured recommendation.                    |

Callers decide whether to block export based on `hasFatal` / `canExport` and
surface warnings separately.

## Slide Fonts

Slide typography uses self-hosted fonts from the registry in
[`src/lib/presentation/slide-fonts.ts`](../../src/lib/presentation/slide-fonts.ts),
served from `public/fonts/slides/` and loaded via
[`src/app/slide-fonts.css`](../../src/app/slide-fonts.css). This keeps rendering
deterministic across platforms.

- Element font selection is a stable `fontId` (`TextElementStyle.fontId`); the
  cascade resolves it to a CSS stack via `slideFontCssStack`.
- Deck/theme typography stays as CSS stacks. Every resolved role token gets the
  self-hosted CJK fallback (`Noto Sans SC`) appended by `ensureCjkFallback` in
  the token resolver, so Simplified Chinese renders deterministically even for
  theme-default text.
- Brand custom `@font-face` rules escape the authored family name before CSS
  injection (`buildFontFaceCss`) so stored font labels cannot break runtime
  stylesheet syntax.
- Editable PPTX export maps registry fonts to Office-compatible faces
  (`slideFontExportFace`), choosing the CJK face for primarily-Chinese text.
  Preflight emits a non-blocking `font-cjk-mapping` notice when the deck
  contains Chinese text.
- Rasterized exports (PDF, per-slide PNG) and present mode await
  `loadSlideFonts()` so output/first paint use the real fonts. The shrink-to-fit
  measurement re-runs once fonts are ready.

Current bundled registry entries are:

| `fontId`         | CSS family     | Editable PPTX mapping | CJK PPTX mapping |
| ---------------- | -------------- | --------------------- | ---------------- |
| `inter`          | Inter          | Aptos                 | Microsoft YaHei  |
| `source-sans-3`  | Source Sans 3  | Aptos                 | Microsoft YaHei  |
| `ibm-plex-sans`  | IBM Plex Sans  | Aptos                 | Microsoft YaHei  |
| `manrope`        | Manrope        | Aptos                 | Microsoft YaHei  |
| `space-grotesk`  | Space Grotesk  | Aptos Display         | Microsoft YaHei  |
| `source-serif-4` | Source Serif 4 | Georgia               | Microsoft YaHei  |
| `jetbrains-mono` | JetBrains Mono | Consolas              | Microsoft YaHei  |
| `noto-sans-sc`   | Noto Sans SC   | Microsoft YaHei       | Microsoft YaHei  |

Editable PPTX export remains native and editable. It maps TextIQ-hosted fonts
to Office-compatible faces and may differ slightly from TextIQ browser
rendering on machines without the same fonts.

## Slide Format And Geometry

Decks specify `canvas.format`. Rendering uses aspect ratio, while PPTX export
uses physical dimensions from `slideFormatConfig`.

Element boxes are stored as percentages of slide width/height. Export converts
those percentages into inches; text font sizes authored as slide-height percent
are converted into points.

## Visual Export Fidelity

Visual export has two tiers:

1. **Native PPTX specs**: supported visual kinds map to PPTX shapes via
   `visualToNativeSpecs` and `applySpecsToSlide`.
2. **Image retry**: unsupported or fidelity-sensitive cases can embed a rendered
   image produced from the visual SVG/PNG path.

Preflight warnings describe expected fidelity changes before the export starts.

## Support Matrix

| Category               | Product render behavior                                      | PPTX export behavior                                                                                                                                                                                                              | Diagnostics                                                                              |
| ---------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Slide backgrounds      | Solid, gradient, pattern, and image fills render.            | Solid supported; gradients, patterns, and image fills use image-retry metadata because PptxGenJS 4.0.1 does not expose native gradient/pattern fill props.                                                                        | Yes when image-retry replaces unsupported native fill metadata or no retry asset exists. |
| Text                   | Paragraphs, runs, alignment, rotation, and local style.      | Text boxes/runs, font face, size, color, bold/italic/underline, alignment, rotation.                                                                                                                                              | Missing tokens diagnose.                                                                 |
| Images                 | Asset-resolved image render with fit/crop surface rules.     | URL/data/file source embeds as image with alt text and rotation.                                                                                                                                                                  | Missing assets diagnose before export.                                                   |
| Visuals                | Asset-backed visuals render; unresolved visuals placeholder. | Rendered visual asset embeds as image; visual-id-only nodes use a labeled placeholder.                                                                                                                                            | Placeholder and unsupported visual channels diagnose.                                    |
| Shapes                 | Core shapes render; path fallback styling is deterministic.  | Core shapes map to PptxGenJS shapes; solid fills stay native; gradient, pattern, image fills, and simple glass/blur effects use image-retry fills with stroke overlays where needed; simple glow maps to native shadow metadata.  | Unsupported native fill/effect mappings diagnose.                                        |
| Connectors             | Straight, elbow, and curved SVG paths with dash/arrows.      | Straight and elbow preserve endpoints, dash, stroke, and arrows; simple point-to-point curved connectors export as editable native arc geometry; unsupported curved geometry keeps an editable straight fallback.                 | Unsupported curved geometry diagnoses.                                                   |
| Tables                 | Header/body rows, fills, alternate rows, borders, text.      | Native `tableShape` -> `VnextPptxTableOp` -> `slide.addTable(...)`; exports column labels, cell text/runs, frame, table text style, header/row/alternate-row fills, borders, padding, and captions as text boxes above the table. | Unsupported table fill types emit `unsupported-export-feature` fallback diagnostics.     |
| Decorations/chrome     | Theme decorations and chrome render outside user nodes.      | Decoration/chrome nodes export in render order; unsupported styles diagnose as style fallbacks.                                                                                                                                   | Yes when fallback is lossy.                                                              |
| Effects                | Blur, glass, glow render in CSS where supported.             | Shape glass/blur use image-retry when the affected shape can be represented safely; simple glow maps to native outer-shadow metadata; other unsupported effect placements keep editable fallbacks with diagnostics.               | Yes when raster/native mapping is unavailable or lossy.                                  |
| Blend/clip/image masks | Product CSS behavior where implemented.                      | Not native in current PPTX adapter unless represented by image asset.                                                                                                                                                             | Diagnostic required when user-visible.                                                   |

Representative checks live in `src/lib/presentation-vnext/render-export-parity.test.ts`,
`src/lib/presentation-vnext/pptx-export-adapter.test.ts`, and
`src/lib/public-render/presentation.test.ts`. New DeckV7 node kinds, styles,
effects, or chrome layers must update render behavior, export behavior,
diagnostics, and focused tests together.

## Invariants

1. `SlideCanvasVNext` is the shared runtime renderer.
2. Render/export code consumes `resolveDeckRenderTree` output.
3. Export specs are pure and testable without DOM/PptxGenJS.
4. Browser/PPTX appliers consume specs and own file-generation side effects.
5. Preflight runs before export and reports stable diagnostic codes.
6. Present/public viewers do not mutate decks.

## Primary Tests

- [`src/lib/presentation-vnext/render-resolver.test.ts`](../../src/lib/presentation-vnext/render-resolver.test.ts)
- [`src/lib/presentation-vnext/export-spec.test.ts`](../../src/lib/presentation-vnext/export-spec.test.ts)
- [`src/lib/presentation-vnext/pptx-export-adapter.test.ts`](../../src/lib/presentation-vnext/pptx-export-adapter.test.ts)
- [`src/lib/presentation-vnext/pptx-vnext-apply.test.ts`](../../src/lib/presentation-vnext/pptx-vnext-apply.test.ts)
- [`src/lib/presentation-vnext/render-export-parity.test.ts`](../../src/lib/presentation-vnext/render-export-parity.test.ts)
- [`src/components/presentation-vnext/slide-canvas-render.test.ts`](../../src/components/presentation-vnext/slide-canvas-render.test.ts)
- [`e2e/slides-smoke.spec.ts`](../../e2e/slides-smoke.spec.ts)
- [`e2e/public-pages.spec.ts`](../../e2e/public-pages.spec.ts)
