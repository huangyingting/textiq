---
type: "contract"
status: "current"
last_updated: "2026-07-31"
description: "The visual subsystem owns visual schemas, kind capabilities, renderer/export support, transformations, and AI prompt constraints. Persistence of visual nodes and Visual rows is documented in ../data-model/visual-mirror.md; editor lifecycle is documented in ../editor/document-editor.md."
---

# Visual System

The visual subsystem owns visual schemas, kind capabilities, renderer/export
support, transformations, and AI prompt constraints. Persistence of visual nodes
and `Visual` rows is documented in
[../data-model/visual-mirror.md](../data-model/visual-mirror.md); editor
lifecycle is documented in [../editor/document-editor.md](../editor/document-editor.md).

## Source Anchors

| Area                  | Source                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Schema facade         | [`src/lib/visual/schema.ts`](../../src/lib/visual/schema.ts)                                         |
| Schema types          | [`src/lib/visual/schema-types.ts`](../../src/lib/visual/schema-types.ts)                             |
| Schema validation     | [`src/lib/visual/schema-validation/`](../../src/lib/visual/schema-validation/)                       |
| Kind registry facade  | [`src/lib/visual/registry.ts`](../../src/lib/visual/registry.ts)                                     |
| Runtime descriptors   | [`src/lib/visual/registry-runtime.ts`](../../src/lib/visual/registry-runtime.ts)                     |
| Registry completeness | [`src/lib/visual/registry-validation.ts`](../../src/lib/visual/registry-validation.ts)               |
| Display renderer      | [`src/components/visual/visual-renderer.tsx`](../../src/components/visual/visual-renderer.tsx)       |
| Inline visual card    | [`src/app/app/documents/[id]/visual-card.tsx`](../../src/app/app/documents/%5Bid%5D/visual-card.tsx) |
| Export dialog         | [`src/components/visual/export-dialog.tsx`](../../src/components/visual/export-dialog.tsx)           |
| Social image actions  | [`src/components/share/social-share-menu.tsx`](../../src/components/share/social-share-menu.tsx)     |
| Transform helpers     | [`src/lib/visual/transforms.ts`](../../src/lib/visual/transforms.ts)                                 |
| Export support        | [`src/lib/visual/registry-export.ts`](../../src/lib/visual/registry-export.ts)                       |
| PPTX native specs     | [`src/lib/visual/pptx-shapes.ts`](../../src/lib/visual/pptx-shapes.ts)                               |

## Schema Contract

`@/lib/visual/schema` is the stable public facade for visual constants, types,
validation, non-throwing parse, and source-text hashing. Versioned types and
constants live in `schema-types.ts`; validation is split by concern under
`schema-validation/*`.

Callers that read persisted visual JSON should use `safeParseVisual` when they
can recover from invalid data and `validateVisual` when invalid data is a hard
failure.

## Kind Registry

Visual kinds are defined by one composed registry entry per `VisualKind`. The
entry combines concern-specific records:

- display metadata;
- allowed editing capabilities;
- export support;
- prompt constraints;
- runtime descriptor.

Runtime descriptors bind schema validation, layout family, render family,
transform behavior, validation expectations, and a per-kind completeness
checklist. `assertRegistryCompleteness` verifies that every split record covers
every kind, that registry ids match kinds, and that runtime descriptor details
agree with editing and prompt contracts.

## Layout And Rendering Families

Visual kinds fall into two layout families:

| Family       | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `positioned` | Nodes carry explicit positions; graph-like editing can preserve edges.  |
| `derived`    | Runtime derives layout from ordered data, values, or semantic grouping. |

Renderers consume validated visual data and registry metadata. Renderer code is
separate from schema and registry data so schema validation can run in tests and
server code without React.

## Transform, AI, And Export Boundaries

Transforms use registry defaults such as default shape, kind-switch layout, and
whether edges are relevant. AI prompt guidance is also registry-owned so every
kind has explicit generation constraints.

Export support is capability-driven. A kind can support SVG/PNG/PDF, native
PPTX, raster fallback, and documented fidelity degradations. Presentation export
uses these capabilities through the pipeline documented in
[../presentation/rendering-and-export.md](../presentation/rendering-and-export.md).

The visual export dialog owns one synchronous export boundary across SVG, PNG,
PDF, and PPTX. Same-event duplicate activation is ignored, and while export is
pending the dialog reports busy state and locks Download, Cancel, backdrop,
close-button, and Escape dismissal. Ordinary renderer failures retain the
dialog with explicit dismissible feedback so the user can adjust settings and
retry.

Social copy-image and native-share actions likewise share one image-operation
boundary. Copy and share cannot race the same SVG rasterization; both buttons
are disabled and the menu is marked busy until the active clipboard or Web
Share operation settles. User-cancelled native share remains a normal outcome.

The inline `VisualCard` applies that boundary across its complete shortcut
strip: PNG download, copy-image, and native share. The card keeps renderer
failures visible and dismissible, allows retry after settlement, sanitizes
download and shared-file names, exposes operation progress to assistive
technology, and makes the strip visible with shared touch-sized controls on
coarse pointers.

## Invariants

1. `VISUAL_KINDS` is the authoritative kind list.
2. Every kind must have display, editing, export, prompt, and runtime records.
3. Registry completeness checks guard drift between split concern files.
4. Validation stays framework-free and independent of React rendering.
5. Render/export callers consume current visual schema directly.
6. Source-text hashes are stable, environment-agnostic FNV-1a hex strings.

## Primary Tests

- [`src/lib/visual/schema.test.ts`](../../src/lib/visual/schema.test.ts)
- [`src/lib/visual/registry.test.ts`](../../src/lib/visual/registry.test.ts)
- [`src/lib/visual/transforms.style.test.ts`](../../src/lib/visual/transforms.style.test.ts)
- [`src/lib/visual/transforms.kind.test.ts`](../../src/lib/visual/transforms.kind.test.ts)
- [`src/lib/visual/transforms.theme.test.ts`](../../src/lib/visual/transforms.theme.test.ts)
- [`src/lib/visual/pptx-shapes.test.ts`](../../src/lib/visual/pptx-shapes.test.ts)
- [`src/components/visual/resize.test.ts`](../../src/components/visual/resize.test.ts)
