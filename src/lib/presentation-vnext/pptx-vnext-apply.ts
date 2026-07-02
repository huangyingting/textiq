/**
 * Browser-only v7 PPTX applier.
 *
 * Two public surfaces:
 *
 *  1. `applyVnextPptxSpec` — applies a `VnextPptxDeckSpec` (from
 *     `buildVnextPptxSpec`) to a new PptxGenJS instance and returns a PPTX
 *     Blob. Operates entirely on the inch-based intermediate; never touches v6
 *     element trees.
 *
 *  2. `exportDeckV7AsPPTX` — high-level orchestrator:
 *       DeckV7 + ThemePackageV1
 *         → resolveDeckRenderTree
 *         → buildExportSpec
 *         → buildVnextPptxSpec
 *         → applyVnextPptxSpec
 *         → Blob
 *
 * Node-family appliers live under `pptx-appliers/`; this module keeps the
 * browser assembly boundary and public re-exports stable.
 */

import type PptxGenJS from "pptxgenjs";

import type { DeckV7 } from "./schema";
import type { ThemePackageV1 } from "./theme-package-schema";
import { resolveThemePackageForDeck } from "./theme-package-registry";
import { resolveDeckRenderTree } from "./render-resolver";
import { buildExportSpec } from "./export-spec";
import {
  buildVnextPptxSpec,
  type VnextPptxDeckSpec,
  type VnextPptxSlideSpec,
  type BuildVnextPptxSpecOptions,
} from "./pptx-export-adapter";
import { resolveExportSpecAssetSources } from "./pptx-appliers/asset-sources";
import { applyVnextImageOp } from "./pptx-appliers/image-media-applier";
import { applyVnextPptxOp } from "./pptx-appliers/operation-applier";

export { resolveExportSpecAssetSources } from "./pptx-appliers/asset-sources";
export type { PptxTextRun } from "./pptx-appliers/text-rich-text-applier";
export {
  applyVnextTextOp,
  textContentToPptxRuns,
} from "./pptx-appliers/text-rich-text-applier";
export {
  applyVnextConnectorOp,
  applyVnextShapeOp,
  vnextShapeToName,
} from "./pptx-appliers/shape-connector-applier";
export { applyVnextImageOp } from "./pptx-appliers/image-media-applier";
export { applyVnextVisualOp } from "./pptx-appliers/visual-block-applier";
export { applyVnextTableOp } from "./pptx-appliers/table-applier";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// ---------------------------------------------------------------------------
// Slide applier
// ---------------------------------------------------------------------------

async function applyVnextSlide(
  pptx: PptxGenJS,
  slideSpec: VnextPptxSlideSpec,
  slideW: number,
  slideH: number,
): Promise<void> {
  const slide = pptx.addSlide();
  const bgFill = slideSpec.background.fill;
  slide.background =
    bgFill !== undefined ? { color: bgFill } : { color: "FFFFFF" };
  if (slideSpec.background.imageFill) {
    await applyVnextImageOp(slide, {
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
    await applyVnextPptxOp(slide, op);
  }

  if (slideSpec.notes) {
    slide.addNotes(slideSpec.notes);
  }
}

// ---------------------------------------------------------------------------
// Public: spec applier
// ---------------------------------------------------------------------------

/**
 * Browser-only: applies a `VnextPptxDeckSpec` to a new PptxGenJS instance and
 * returns a PPTX Blob. Returns `null` on any assembly error.
 */
export async function applyVnextPptxSpec(
  spec: VnextPptxDeckSpec,
): Promise<Blob | null> {
  try {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const pptx = new PptxGenJS();
    pptx.layout = spec.layout;

    for (const slideSpec of spec.slides) {
      await applyVnextSlide(pptx, slideSpec, spec.slideW, spec.slideH);
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
// Public: high-level v7 export
// ---------------------------------------------------------------------------

/**
 * Browser-only: resolves a `DeckV7` + `ThemePackageV1` into a PPTX Blob.
 * When the package is omitted, `DeckV7.theme.packageId` is resolved through
 * the runtime v7 theme package registry with neutral fallback.
 *
 * Pipeline:
 *   DeckV7 → resolveDeckRenderTree → buildExportSpec
 *          → buildVnextPptxSpec → applyVnextPptxSpec → Blob
 *
 * Returns `null` on any error (assembly failure, missing browser APIs, etc.).
 */
export async function exportDeckV7AsPPTX(
  deck: DeckV7,
  themePackage?: ThemePackageV1,
  options?: BuildVnextPptxSpecOptions,
): Promise<Blob | null> {
  try {
    const resolvedThemePackage =
      themePackage ?? resolveThemePackageForDeck(deck).package;
    const renderTree = resolveDeckRenderTree(deck, resolvedThemePackage);
    const exportSpec = resolveExportSpecAssetSources(
      deck,
      buildExportSpec(renderTree),
    );
    const pptxSpec = buildVnextPptxSpec(exportSpec, options);
    return applyVnextPptxSpec(pptxSpec);
  } catch {
    return null;
  }
}
