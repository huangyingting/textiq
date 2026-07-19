/**
 * Style system types for the presentation schema.
 *
 * `StyleObject` is the resolved or package-level style; `StylePatch` is
 * the partial form used for local overrides and deck-level overrides.
 */

import type {
  AssetId,
  TokenPath,
  InsetsPct,
  InsetsPt,
  JsonValue,
  DeepPartial,
} from "./types";

// ---------------------------------------------------------------------------
// Token ref
// ---------------------------------------------------------------------------

/** A reference to a token defined in `ThemeTokens`. */
export type TokenRef = { token: TokenPath };

/** A colour value: either a CSS hex literal or a token ref. */
export type ColorValue = string | TokenRef;

// ---------------------------------------------------------------------------
// Text style
// ---------------------------------------------------------------------------

export type TextStyle = {
  fontFamily?: string | TokenRef;
  fontSizePt?: number;
  weight?: number;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: ColorValue;
  lineHeight?: number;
  paragraphSpacingPt?: number;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  letterSpacingEm?: number;
  textTransform?: "none" | "uppercase";
};

// ---------------------------------------------------------------------------
// Fill style
// ---------------------------------------------------------------------------

export type GradientStop = { color: ColorValue; offsetPct: number };

export type PatternFillKind = "grid" | "dots" | "stripes" | "scanlines";

export type FillStyle =
  | { type: "solid"; color: ColorValue }
  | {
      type: "linearGradient";
      from: ColorValue;
      to: ColorValue;
      angle?: number;
      stops?: GradientStop[];
    }
  | {
      type: "radialGradient";
      inner: ColorValue;
      outer: ColorValue;
      cx?: number;
      cy?: number;
      r?: number;
      rx?: number;
      ry?: number;
      stops?: GradientStop[];
    }
  | {
      type: "conicGradient";
      fromAngle?: number;
      cx?: number;
      cy?: number;
      stops: GradientStop[];
    }
  | {
      type: "repeatingLinearGradient";
      angle?: number;
      stops: GradientStop[];
      sizePct?: number;
    }
  | {
      type: "pattern";
      kind: PatternFillKind;
      color: ColorValue;
      background?: ColorValue;
      spacingPct?: number;
      strokeWidthPct?: number;
      angle?: number;
    }
  | { type: "image"; assetId: AssetId; opacity?: number };

// ---------------------------------------------------------------------------
// Other style sub-types
// ---------------------------------------------------------------------------

export type StrokeStyle = {
  color: ColorValue;
  widthPt: number;
  dash?: "solid" | "dashed" | "dotted";
};

export type RadiusStyle =
  | { allPt: number }
  | {
      topLeftPt: number;
      topRightPt: number;
      bottomRightPt: number;
      bottomLeftPt: number;
    };

export type ShadowStyle = {
  xPt: number;
  yPt: number;
  blurPt: number;
  color: ColorValue;
  opacity?: number;
};

export type EffectStyle =
  | { kind: "none" }
  | { kind: "glass"; intensity: "light" | "medium" | "strong" }
  | { kind: "blur"; radiusPt: number }
  | { kind: "glow"; color: ColorValue; blurPt: number; opacity?: number };

export type ImageFitMode = "contain" | "cover" | "fill" | "none";

export type ImageStyle = {
  fit?: ImageFitMode;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  maskShape?:
    "none" | "rect" | "circle" | "ellipse" | "rounded" | "diamond" | "triangle";
  radiusPct?: number;
  shadow?: boolean;
};

export type ConnectorStyle = {
  stroke?: StrokeStyle;
  startArrow?: "none" | "arrow" | "filled";
  endArrow?: "none" | "arrow" | "filled";
  routing?: "straight" | "elbow" | "curved";
};

export type TableStyle = {
  headerFill?: FillStyle;
  rowFill?: FillStyle;
  alternateRowFill?: FillStyle;
  border?: StrokeStyle;
  cellPaddingPt?: InsetsPt;
  text?: TextStyle;
  headerText?: TextStyle;
};

export type SlideSurfaceStyle = {
  background?: FillStyle;
  accent?: ColorValue;
  paddingPct?: InsetsPct;
  chrome?: "default" | "minimal" | "none";
  decoration?: "none" | "subtle" | "default" | "expressive";
};

export type VisualStyle = {
  styleThemeId?: string;
  transparentBackground?: boolean;
  channelColors?: Record<string, ColorValue>;
};

export type ClipStyle = {
  enabled: boolean;
};

export type BlendMode =
  "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";

// ---------------------------------------------------------------------------
// Top-level style object
// ---------------------------------------------------------------------------

export type StyleObject = {
  text?: TextStyle;
  fill?: FillStyle;
  stroke?: StrokeStyle;
  radius?: RadiusStyle;
  opacity?: number;
  shadow?: ShadowStyle;
  effect?: EffectStyle;
  image?: ImageStyle;
  connector?: ConnectorStyle;
  table?: TableStyle;
  slide?: SlideSurfaceStyle;
  visual?: VisualStyle;
  clip?: ClipStyle;
  blendMode?: BlendMode;
};

/** Partial style, used for local overrides and deck-level patches. */
export type StylePatch = DeepPartial<StyleObject>;

// ---------------------------------------------------------------------------
// Style binding (node-level reference into the theme)
// ---------------------------------------------------------------------------

/**
 * Named semantic style references.
 *
 * Every public style ref must have a `default` variant in every theme package.
 */
export type StyleRef =
  | "slide.cover"
  | "slide.content"
  | "slide.section"
  | "text.title"
  | "text.subtitle"
  | "text.body"
  | "text.kicker"
  | "text.caption"
  | "text.quote"
  | "text.metric"
  | "surface.card"
  | "surface.callout"
  | "surface.table"
  | "media.hero"
  | "media.inline"
  | "chart.primary"
  | "connector.primary"
  | "decoration.background";

/** Binds a node to a named theme style. */
export type StyleBinding = {
  ref: StyleRef;
  variant?: string;
};

/** Theme colour token structure. */
export type ThemeTokens = {
  colors: {
    canvas: { fill: string; text: string; mutedText: string };
    surface: { fill: string; text: string; mutedText: string; border?: string };
    accent: { fill: string; text: string };
    status?: {
      danger?: { fill: string; text: string };
      warning?: { fill: string; text: string };
      success?: { fill: string; text: string };
    };
  };
  fonts: {
    heading: string;
    body: string;
    mono?: string;
  };
  spacing?: Record<string, number>;
  radii?: Record<string, number>;
  shadows?: Record<string, ShadowStyle>;
};

/** Resolves a token path (e.g. "colors.canvas.text") against ThemeTokens. */
export function resolveToken(
  tokens: ThemeTokens,
  path: TokenPath,
): string | number | ShadowStyle | undefined {
  const parts = path.split(".");
  let cursor: unknown = tokens;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor as string | number | ShadowStyle | undefined;
}

/** Extra metadata about a style patch that carries only unknown keys. */
export type StyleMetadata = Record<string, JsonValue>;
