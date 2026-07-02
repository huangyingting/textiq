/** Document-owned access to the legacy deck model while v6 fallback remains. */
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
} from "./deck-kernel/deck-core";
export type {
  Deck,
  MasterChromeKind,
  MasterElement,
  PresentationThemeId,
  Slide,
  SlideMaster,
} from "./deck-kernel/deck-core";
export {
  DEFAULT_VISUAL_BOX,
  GLASS_EFFECT_INTENSITIES,
  IMAGE_FIT_MODES,
  IMAGE_MASK_SHAPES,
  buildVisualElement,
  normalizeTextParagraphs,
} from "./deck-kernel/deck-elements";
export type {
  BaseElement,
  BlurEffect,
  BulletItem,
  ColorRef,
  ConnectorAnchor,
  ConnectorArrow,
  ConnectorElement,
  ConnectorEndpoint,
  ConnectorPoint,
  ConnectorPointFree,
  ConnectorRouting,
  ElementAlign,
  ElementBox,
  ElementEffect,
  ElementFill,
  ElementRadius,
  ElementRadiusCorners,
  ElementShadow,
  GlassEffect,
  GlowEffect,
  GradientStop,
  ImageCrop,
  ImageElement,
  ImageFitMode,
  ImageMaskShape,
  LinearGradientFill,
  Paragraph,
  RadialGradientFill,
  ShapeElement,
  ShapeKind,
  SlideElement,
  TableCell,
  TableColumn,
  TableElement,
  TableElementContent,
  TableElementStyle,
  TableRow,
  TextElement,
  TextElementStyle,
  TextFitMode,
  TextRun,
  VisualElement,
} from "./deck-kernel/deck-elements";
export {
  activeSourceRef,
  isSourceLinked,
  isSourceStale,
  relinkSource,
  unlinkSource,
} from "./deck-kernel/deck-source-refs";
export type { SourceRef } from "./deck-kernel/deck-source-refs";
export { makeElementId, makeSlideId } from "./deck-kernel/deck-ids";
export { inspectSlideDesignOrigins } from "./deck-kernel/slide-design-origins";
export type {
  SlideDesignOrigin,
  SlideDesignOriginLayer,
  SlideDesignOriginReport,
} from "./deck-kernel/slide-design-origins";
export {
  findSourceLinkedElements,
  getSlideTitleFromElements,
  getSlideVisualIds,
  summarizeSlideContent,
} from "./deck-kernel/slide-helpers";
export {
  MAX_BULLETS,
  buildDeckFromBlocks,
  buildSlideElementsFromContent,
} from "./deck-kernel/deck-derivation";
