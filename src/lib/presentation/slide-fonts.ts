export {
  DEFAULT_SLIDE_FONT_ID,
  SLIDE_FONTS,
  SLIDE_FONT_OPTIONS,
  buildSlideFontFaceCss,
  ensureCjkFallback,
  isPrimarilyCjk,
  isSlideFontId,
  matchSlideFont,
  resolveElementFontCss,
  resolveSlideFont,
  slideFontCssStack,
  slideFontExportFace,
} from "@/lib/document/deck-kernel/slide-fonts";
export type {
  FontOption,
  SlideFont,
  SlideFontAsset,
  SlideFontStyle,
  SlideFontWeight,
} from "@/lib/document/deck-kernel/slide-fonts";
