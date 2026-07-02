/**
 * presentation PPTX export adapter.
 *
 * Converts a `ExportDeckSpec` (produced by `buildExportSpec` from a
 * `ResolvedDeckRenderTree`) into a `PptxDeckSpec` — a DOM-free,
 * inch-based intermediate that a browser-side PptxGenJS applier can consume
 * without touching v6 element trees.
 *
 * Design notes:
 * - All coordinates are converted from the build-time pixel basis to PPTX
 *   inches at this boundary. The default pixel basis is 960×540 (matches
 *   `resolveDeckRenderTree` default). Pass `canvasWidthPx`/`canvasHeightPx`
 *   to override.
 * - Gradient, pattern, and image fills use image-retry fallback metadata when
 *   PptxGenJS has no native fill representation.
 * - Shape glass/blur effects use image-retry fallback when safe; simple glow
 *   maps to native shadow metadata; unsupported effect placements diagnose.
 * - This module has no browser or PptxGenJS dependencies.
 */

import type {
  ExportDeckSpec,
  ExportSlideSpec,
} from "@/lib/presentation/export-spec";
import { DiagnosticCollector } from "@/lib/presentation/diagnostics";
import type { PptxDeckSpec, PptxOp, PptxSlideSpec } from "./pptx-export-types";
import {
  canvasToPptxDimensions,
  type PptxLowererContext,
} from "./pptx-lowerers/shared";
import { lowerExportOperationToPptx } from "./pptx-lowerers/operation-lowerer";
import { lowerBackgroundOperationToPptx } from "./pptx-lowerers/theme-background-chrome-lowerer";
export type {
  PptxBackgroundOp,
  PptxConnectorOp,
  PptxDeckSpec,
  PptxEffect,
  PptxImageFill,
  PptxImageOp,
  PptxLayout,
  PptxOp,
  PptxShapeOp,
  PptxSlideSpec,
  PptxTableOp,
  PptxTextOp,
  PptxTextStyle,
  PptxVisualOp,
} from "./pptx-export-types";

export interface BuildPptxSpecOptions {
  /** Pixel width of the canvas used when resolving the render tree. Default: 960. */
  canvasWidthPx?: number;
  /** Pixel height of the canvas used when resolving the render tree. Default: 540. */
  canvasHeightPx?: number;
}

// ---------------------------------------------------------------------------
// Slide converter
// ---------------------------------------------------------------------------

function convertSlide(
  slide: ExportSlideSpec,
  ctx: PptxLowererContext,
): PptxSlideSpec {
  const ops: PptxOp[] = [];
  for (const op of slide.operations) {
    const converted = lowerExportOperationToPptx(op, ctx);
    if (converted !== null) {
      ops.push(converted);
    }
  }

  return {
    id: slide.id,
    background: lowerBackgroundOperationToPptx(
      slide.id,
      slide.background,
      ctx.dc,
    ),
    ops,
    ...(slide.notes !== undefined ? { notes: slide.notes } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts a `ExportDeckSpec` (from `buildExportSpec`) into a DOM-free,
 * inch-based `PptxDeckSpec` ready for a PptxGenJS browser applier.
 *
 * - Operation frames are converted from pixels (at the given pixel basis) to
 *   PPTX inches derived from the canvas format.
 * - Gradient / pattern / image fills use image-retry fallback metadata when
 *   PptxGenJS has no native fill representation.
 * - Glass/blur/glow effects use native or image-retry paths where faithful;
 *   unsupported placements emit `unsupported-export-feature` diagnostics.
 * - Carry-forward diagnostics from the `ExportDeckSpec` are preserved.
 */
export function buildPptxSpec(
  exportSpec: ExportDeckSpec,
  options: BuildPptxSpecOptions = {},
): PptxDeckSpec {
  const basisW = options.canvasWidthPx ?? 960;
  const basisH = options.canvasHeightPx ?? 540;
  const dims = canvasToPptxDimensions(exportSpec.canvas);

  const dc = new DiagnosticCollector();
  for (const d of exportSpec.diagnostics) dc.add(d);

  const ctx: PptxLowererContext = {
    basis: { w: basisW, h: basisH },
    dims,
    dc,
  };

  const slides = exportSpec.slides.map((slide) => convertSlide(slide, ctx));

  return {
    layout: dims.layout,
    slideW: dims.slideW,
    slideH: dims.slideH,
    slides,
    diagnostics: dc.diagnostics,
  };
}
