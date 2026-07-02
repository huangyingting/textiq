/** Test-owned access to the legacy PPTX exporter until v6 fallback deletion (#1615). */
export {
  SHADOW_OPTS,
  applyBulletsOp,
  applyConnectorOp,
  applyDeckOp,
  applyImageOp,
  applyShapeOp,
  applyTextOp,
  exportDeckAsPPTX,
} from "../lib/presentation/export/deck-export-pptx";
export type { DeckSlideSpec } from "../lib/presentation/export/deck-export-pptx";
