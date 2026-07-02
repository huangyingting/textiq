/**
 * Test-only seam helpers for the deck PPTX applier.
 *
 * These let Node tests assert that {@link DeckOp} descriptors are translated
 * into the right PptxGenJS calls without constructing a real `.pptx` archive.
 * The pure spec tests cover `buildDeckSpecs`; this file surfaces the applier
 * internals as a narrow test seam.
 *
 * Import from here in test files instead of from the production module.
 */

import {
  applyBulletsOp,
  applyConnectorOp,
  applyDeckOp,
  applyImageOp,
  applyShapeOp,
  applyTextOp,
  SHADOW_OPTS,
} from "@/test/deck-export-pptx";

export const deckExportTestHelpers = {
  applyDeckOp,
  applyTextOp,
  applyBulletsOp,
  applyShapeOp,
  applyImageOp,
  applyConnectorOp,
  SHADOW_OPTS,
};
