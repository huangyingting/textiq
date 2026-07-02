/**
 * Canonical slide formats for presentation decks.
 *
 * The dimensions here are ratio primitives, not pixels. Editor surfaces use the
 * aspect ratio, while PPTX export maps the same format to PowerPoint's standard
 * physical slide sizes.
 */

export const SLIDE_FORMATS = ["16:9", "4:3"] as const;

export type SlideFormat = (typeof SLIDE_FORMATS)[number];

export const DEFAULT_SLIDE_FORMAT: SlideFormat = "16:9";

export interface SlideFormatConfig {
  label: string;
  width: number;
  height: number;
  pptxLayout: "LAYOUT_WIDE" | "LAYOUT_4X3";
  pptxWidthIn: number;
  pptxHeightIn: number;
}

export const SLIDE_FORMAT_CONFIGS: Record<SlideFormat, SlideFormatConfig> = {
  "16:9": {
    label: "16:9 Widescreen",
    width: 16,
    height: 9,
    pptxLayout: "LAYOUT_WIDE",
    pptxWidthIn: 13.333,
    pptxHeightIn: 7.5,
  },
  "4:3": {
    label: "4:3 Standard",
    width: 4,
    height: 3,
    pptxLayout: "LAYOUT_4X3",
    pptxWidthIn: 10,
    pptxHeightIn: 7.5,
  },
};

export function resolveSlideFormat(
  format: SlideFormat | undefined,
): SlideFormat {
  return format ?? DEFAULT_SLIDE_FORMAT;
}

export function slideFormatConfig(
  format: SlideFormat | undefined,
): SlideFormatConfig {
  return SLIDE_FORMAT_CONFIGS[resolveSlideFormat(format)];
}

export function slideAspectRatio(format: SlideFormat | undefined): number {
  const config = slideFormatConfig(format);
  return config.width / config.height;
}
