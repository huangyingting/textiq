/** Primitive type aliases for the presentation schema. */

export type DeckId = string;
export type SlideId = string;
export type NodeId = string;
export type AssetId = string;
export type ThemePackageId = string;
export type ThemeVersion = string;
export type TemplateVersion = string;
export type StyleVariantId = string;
export type TokenPath = string;
export type IsoDateTime = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type DeepPartial<T> = { [K in keyof T]?: DeepPartial<T[K]> };

/** Slide aspect-ratio format. */
export type CanvasFormat = "16:9" | "4:3" | "square" | "custom";

/** Percent-space coordinate frame for the canvas. */
export type CanvasSpec = {
  format: CanvasFormat;
  width: number;
  height: number;
  unit: "percent";
  safeArea?: InsetsPct;
};

export type InsetsPct = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type InsetsPt = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** Canvas-relative percent frame. */
export type FramePct = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Percent-space point inside a frame. */
export type PointPct = {
  x: number;
  y: number;
};
