/**
 * Permanent public boundary for the presentation deck subsystem.
 *
 * This facade is the sole stable import surface for all deck types and
 * helpers. Consumers must import from here, not from the internal modules.
 * This surface is the legacy v6 deck model (`Slide.elements[]`).
 * Current persisted runtime contracts are DeckV7 in `presentation-vnext`.
 */

export {
  DEFAULT_SLIDE_FORMAT,
  SLIDE_FORMAT_CONFIGS,
  SLIDE_FORMATS,
  resolveSlideFormat,
  slideAspectRatio,
  slideFormatConfig,
} from "@/lib/presentation-shared/slide-format";
export type { SlideFormat } from "@/lib/presentation-shared/slide-format";

export {
  LEGACY_DECK_SCHEMA_VERSION,
  PRESENTATION_THEME_IDS,
} from "./deck-core";
export type {
  PresentationThemeId,
  MasterChromeKind,
  MasterElement,
  SlideMaster,
  Slide,
  Deck,
} from "./deck-core";

export {
  normalizeTextParagraphs,
  GLASS_EFFECT_INTENSITIES,
  IMAGE_FIT_MODES,
  IMAGE_MASK_SHAPES,
  DEFAULT_VISUAL_BOX,
  buildVisualElement,
} from "./deck-elements";
export type {
  ElementBox,
  ColorRef,
  ElementEffect,
  ElementFill,
  ElementRadius,
  ElementRadiusCorners,
  ElementShadow,
  BlurEffect,
  GlowEffect,
  GlassEffect,
  GradientStop,
  TextRun,
  TextFitMode,
  TextElementStyle,
  RadialGradientFill,
  LinearGradientFill,
  ShapeKind,
  ConnectorAnchor,
  ConnectorEndpoint,
  ConnectorPointFree,
  ConnectorPoint,
  ConnectorRouting,
  ConnectorElement,
  TableElement,
  TableElementContent,
  TableElementStyle,
  TableColumn,
  TableRow,
  TableCell,
  BaseElement,
  TextElement,
  Paragraph,
  BulletItem,
  VisualElement,
  ConnectorArrow,
  ElementAlign,
  ImageFitMode,
  ImageMaskShape,
  ImageCrop,
  ImageElement,
  ShapeElement,
  SlideElement,
} from "./deck-elements";

export {
  isSourceLinked,
  isSourceStale,
  unlinkSource,
  relinkSource,
  activeSourceRef,
} from "./deck-source-refs";
export type { SourceRef } from "./deck-source-refs";

export { makeElementId, makeSlideId } from "./deck-ids";

export { inspectSlideDesignOrigins } from "./slide-design-origins";
export type {
  SlideDesignOrigin,
  SlideDesignOriginLayer,
  SlideDesignOriginReport,
} from "./slide-design-origins";

export {
  getSlideVisualIds,
  getSlideTitleFromElements,
  summarizeSlideContent,
  findSourceLinkedElements,
} from "./slide-helpers";
export {
  MAX_BULLETS,
  buildSlideElementsFromContent,
  buildDeckFromBlocks,
} from "./deck-derivation";
