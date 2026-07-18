/**
 * Export spec for the presentation system.
 *
 * Converts a `ResolvedDeckRenderTree` into a DOM-free `ExportDeckSpec`.
 * Browser / PPTX adapters apply operations and perform file-generation side
 * effects; this module is pure.
 *
 * Operation order matches resolved render order exactly.
 * Unsupported effects emit diagnostics with deterministic fallbacks.
 */

import type {
  ResolvedDeckRenderTree,
  ResolvedSlideRenderTree,
} from "./render-tree";
import { DiagnosticCollector } from "./diagnostics";
import type {
  ExportDeckSpec,
  ExportOperation,
  ExportSlideSpec,
} from "./export-spec-types";
import { lowerNodeToExportOperations } from "./export-lowerers/export-node-lowerer";
import {
  lowerBackgroundChromeOperations,
  lowerForegroundChromeOperations,
  lowerSlideBackground,
  lowerThemeDecorationOperations,
} from "./export-lowerers/theme-background-chrome-lowerer";
import { orderSiblingsByVisualOrder } from "./render-order";
export type {
  ExportBackgroundOperation,
  ExportConnectorOperation,
  ExportDeckSpec,
  ExportImageOperation,
  ExportOperation,
  ExportShapeOperation,
  ExportSlideSpec,
  ExportTableShapeOperation,
  ExportTextOperation,
  ExportVisualOperation,
} from "./export-spec-types";

// ---------------------------------------------------------------------------
// Slide export spec builder
// ---------------------------------------------------------------------------

function buildSlideExportSpec(
  slide: ResolvedSlideRenderTree,
  dc: DiagnosticCollector,
): ExportSlideSpec {
  const operations: ExportOperation[] = [];

  // Decorations first (render order: behind user nodes)
  operations.push(...lowerThemeDecorationOperations(slide, dc));

  // Background chrome (e.g. watermark) sits above decorations and below user nodes.
  operations.push(...lowerBackgroundChromeOperations(slide, dc));

  // User roots form slide-level stacking contexts; group descendants are
  // lowered recursively in their own sibling order.
  for (const node of orderSiblingsByVisualOrder(slide.nodes)) {
    operations.push(...lowerNodeToExportOperations(node, dc));
  }

  // Foreground chrome (logo/footer/page number/border/safe-area) overlays content.
  operations.push(...lowerForegroundChromeOperations(slide, dc));

  return {
    id: slide.id,
    background: lowerSlideBackground(slide),
    operations,
    ...(slide.notes ? { notes: slide.notes } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts a resolved render tree into a DOM-free `ExportDeckSpec`.
 *
 * This function is pure. Adapters (browser, PPTX, image) apply the spec.
 */
export function buildExportSpec(
  renderTree: ResolvedDeckRenderTree,
): ExportDeckSpec {
  const dc = new DiagnosticCollector();
  // Carry forward any render-resolve diagnostics
  for (const d of renderTree.diagnostics) dc.add(d);

  const slides: ExportSlideSpec[] = [];
  for (const slide of renderTree.slides) {
    slides.push(buildSlideExportSpec(slide, dc));
  }

  return {
    canvas: renderTree.canvas,
    slides,
    diagnostics: dc.diagnostics,
  };
}
