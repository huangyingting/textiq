/** Leaf presentation element primitive unions shared by schema and tokens. */

export type ElementAlign = "left" | "center" | "right";

export type ConnectorArrow = "none" | "arrow" | "filled";

export const IMAGE_FIT_MODES = ["contain", "cover", "fill", "none"] as const;
export type ImageFitMode = (typeof IMAGE_FIT_MODES)[number];

export const IMAGE_MASK_SHAPES = [
  "none",
  "rect",
  "circle",
  "ellipse",
  "rounded",
  "diamond",
  "triangle",
] as const;
export type ImageMaskShape = (typeof IMAGE_MASK_SHAPES)[number];

export const GLASS_EFFECT_INTENSITIES = ["light", "medium", "strong"] as const;
export type GlassEffectIntensity = (typeof GLASS_EFFECT_INTENSITIES)[number];
