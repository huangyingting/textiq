/**
 * Deck → PPTX export that honors the edited deck (`deckJson`).
 *
 * Unlike `exportDocumentAsPPTX` (document-export.ts), which re-derives one
 * slide per visual straight from the raw `DocumentBlock[]` and therefore
 * ignores every slide-editor change (reordering, retitling, free-form text,
 * shapes, images, etc.), this module walks an actual {@link Deck} and emits one
 * PptxGenJS slide per `deck.slides` entry. The authored content — including
 * free-form `elements`, per-slide `background`/`accent`, and reordered slides —
 * is preserved.
 *
 * Design (mirrors the pure/applier split used by pptx-shapes.ts + pptx-apply.ts):
 *  1. `buildDeckSpecs` (deck-export-spec.ts) — pure, DOM-free transform from a
 *     `Deck` into an array of `DeckSlideSpec` descriptors. Fully testable under
 *     `node --test`. It walks current slide `elements[]` and reuses
 *     `visualToNativeSpecs` for the visual→PPTX mapping.
 *  2. `exportDeckAsPPTX` (deck-export-pptx.ts) — browser-only applier that
 *     walks the descriptors, creates a real PptxGenJS deck, applies each op,
 *     and resolves visual image-fallbacks via the supplied `getSvg` callback.
 *     Returns a Blob.
 *  3. `exportDeckAsSlideImages` (deck-export-slide-images.ts) — browser-only
 *     SVG/PNG renderer that produces a ZIP of per-slide images.
 *
 * This file is the public facade: it re-exports the stable public API from
 * the three sub-modules so external importers need only one path.
 */

// Spec types + pure builder
export type {
  DeckBulletsOp,
  DeckConnectorOp,
  DeckImageOp,
  DeckOp,
  DeckShapeOp,
  DeckSlideSpec,
  DeckTextOp,
  DeckVisualFallbackOp,
  DeckVisualNativeOp,
} from "./deck-export-spec";
export { buildDeckSpecs } from "./deck-export-spec";

// PPTX applier
export { exportDeckAsPPTX } from "./deck-export-pptx";

// Slide-image renderer
export type {
  DeckSlideImageDiagnostic,
  DeckSlideImageExportOptions,
  DeckSlideImageFormat,
} from "./deck-export-slide-images";
export { exportDeckAsSlideImages } from "./deck-export-slide-images";
