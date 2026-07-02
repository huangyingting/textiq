/**
 * Browser-only presentation PPTX applier.
 *
 * Two public surfaces:
 *
 *  1. `applyPptxSpec` — applies a `PptxDeckSpec` (from
 *     `buildPptxSpec`) to a new PptxGenJS instance and returns a PPTX
 *     Blob. Operates entirely on the inch-based intermediate; never touches v6
 *     element trees.
 *
 *  2. `exportDeckAsPPTX` — high-level orchestrator:
 *       Deck + ThemePackageV1
 *         → resolveDeckRenderTree
 *         → buildExportSpec
 *         → buildPptxSpec
 *         → applyPptxSpec
 *         → Blob
 *
 * Node-family appliers live under `pptx-appliers/`; this module keeps the
 * browser assembly boundary and public re-exports stable.
 */

import type PptxGenJS from "pptxgenjs";

import type { Deck } from "./schema";
import type { ThemePackageV1 } from "./theme-package-schema";
import { resolveThemePackageForDeck } from "./theme-package-registry";
import { resolveDeckRenderTree } from "./render-resolver";
import { buildExportSpec } from "./export-spec";
import {
  buildPptxSpec,
  type PptxDeckSpec,
  type PptxSlideSpec,
  type BuildPptxSpecOptions,
} from "./pptx-export-adapter";
import { resolveExportSpecAssetSources } from "./pptx-appliers/asset-sources";
import { applyPptxImageOp } from "./pptx-appliers/image-media-applier";
import { applyPptxOp } from "./pptx-appliers/operation-applier";

export { resolveExportSpecAssetSources } from "./pptx-appliers/asset-sources";
export type { PptxTextRun } from "./pptx-appliers/text-rich-text-applier";
export {
  applyPptxTextOp,
  textContentToPptxRuns,
} from "./pptx-appliers/text-rich-text-applier";
export {
  applyPptxConnectorOp,
  applyPptxShapeOp,
  presentationShapeToName,
} from "./pptx-appliers/shape-connector-applier";
export { applyPptxImageOp } from "./pptx-appliers/image-media-applier";
export { applyPptxVisualOp } from "./pptx-appliers/visual-block-applier";
export { applyPptxTableOp } from "./pptx-appliers/table-applier";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// ---------------------------------------------------------------------------
// Slide applier
// ---------------------------------------------------------------------------

async function applyPptxSlide(
  pptx: PptxGenJS,
  slideSpec: PptxSlideSpec,
  slideW: number,
  slideH: number,
): Promise<void> {
  const slide = pptx.addSlide();
  const bgFill = slideSpec.background.fill;
  slide.background =
    bgFill !== undefined ? { color: bgFill } : { color: "FFFFFF" };
  if (slideSpec.background.imageFill) {
    await applyPptxImageOp(slide, {
      type: "image",
      id: `${slideSpec.id}:background-fill`,
      assetId: slideSpec.background.imageFill.assetId,
      x: 0,
      y: 0,
      w: slideW,
      h: slideH,
      ...(slideSpec.background.imageFill.fit
        ? { fit: slideSpec.background.imageFill.fit }
        : {}),
      zIndex: Number.NEGATIVE_INFINITY,
    });
  }

  // Ops are already in render order from the adapter (sorted by zIndex)
  for (const op of slideSpec.ops) {
    await applyPptxOp(slide, op);
  }

  if (slideSpec.notes) {
    slide.addNotes(slideSpec.notes);
  }
}

// ---------------------------------------------------------------------------
// Public: spec applier
// ---------------------------------------------------------------------------

/**
 * Browser-only: applies a `PptxDeckSpec` to a new PptxGenJS instance and
 * returns a PPTX Blob. Returns `null` on any assembly error.
 */
export async function applyPptxSpec(spec: PptxDeckSpec): Promise<Blob | null> {
  try {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const pptx = new PptxGenJS();
    pptx.layout = spec.layout;

    for (const slideSpec of spec.slides) {
      await applyPptxSlide(pptx, slideSpec, spec.slideW, spec.slideH);
    }

    const arrayBuffer = (await pptx.write({
      outputType: "arraybuffer",
    })) as ArrayBuffer;
    return new Blob([arrayBuffer], { type: PPTX_MIME });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public: high-level presentation export
// ---------------------------------------------------------------------------

/**
 * Browser-only: resolves a `Deck` + `ThemePackageV1` into a PPTX Blob.
 * When the package is omitted, `Deck.theme.packageId` is resolved through
 * the runtime presentation theme package registry with neutral fallback.
 *
 * Pipeline:
 *   Deck → resolveDeckRenderTree → buildExportSpec
 *          → buildPptxSpec → applyPptxSpec → Blob
 *
 * Returns `null` on any error (assembly failure, missing browser APIs, etc.).
 */
export async function exportDeckAsPPTX(
  deck: Deck,
  themePackage?: ThemePackageV1,
  options?: BuildPptxSpecOptions,
): Promise<Blob | null> {
  try {
    const resolvedThemePackage =
      themePackage ?? resolveThemePackageForDeck(deck).package;
    const renderTree = resolveDeckRenderTree(deck, resolvedThemePackage);
    const exportSpec = resolveExportSpecAssetSources(
      deck,
      buildExportSpec(renderTree),
    );
    const pptxSpec = buildPptxSpec(exportSpec, options);
    return applyPptxSpec(pptxSpec);
  } catch {
    return null;
  }
}
