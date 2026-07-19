/**
 * Presentation theme token schema — pure types and layer documentation.
 *
 * This module contains only token shapes, semantic role names, and cascade layer
 * labels. Runtime lookup and fallback logic live in presentation-theme-resolvers;
 * built-in token data lives in presentation-theme-data.
 *
 * Cascade layers (outermost → innermost):
 *  1. deck token set — named PresentationTheme values and custom brand tokens.
 *  2. master slide — structural chrome shared by assigned slides.
 *  3. template materialization — blueprint defaults copied onto slide elements.
 *  4. slide override — Slide.background/accent and other per-slide fields.
 *  5. element override — concrete element styles and local override objects.
 *
 * Unit boundaries:
 *  - FontScale and PresentationRoleToken.fontSize are point sizes.
 *  - ElementBox and TextElementStyle font sizes are slide-relative percentages.
 *  - Color tokens are CSS hex colors; typography fonts are CSS font stacks.
 *  - Export adapters convert to PPTX inches/points at the boundary.
 */

import type {
  ConnectorArrow,
  ElementAlign,
  ImageFitMode,
  ImageMaskShape,
} from "./deck-element-primitives";
import {
  PRESENTATION_ROLES,
  type PresentationRole,
} from "./presentation-role-primitives";
import type { FontScale } from "./theme-typography";

// ---------------------------------------------------------------------------
// Semantic text roles (#603)
// ---------------------------------------------------------------------------

/**
 * Canonical, ordered list of semantic text roles a global presentation theme can
 * style. Stored as a runtime const so validators and UI can iterate it, and
 * re-exported as the {@link PresentationRole} string-literal union for typing.
 *
 * Roles are intentionally semantic (what the text *is*) rather than visual
 * (how it currently looks) so a single template edit can restyle every element
 * carrying a role without rewriting concrete element styles.
 */
export { PRESENTATION_ROLES, type PresentationRole };

/**
 * Typography token for a single semantic role.  All fields except `fontSize`,
 * `color`, and `weight` are optional; absent values inherit from the renderer
 * or theme defaults.  Sizes are points (matching {@link FontScale}); colors are
 * hex strings.
 */
export type PresentationRoleToken = {
  /** Font stack.  Falls back to the theme heading/body font when absent. */
  fontFamily?: string;
  /** Point size for this role. */
  fontSize: number;
  /** Hex color (`"#rrggbb"` / `"#rrggbbaa"`). */
  color: string;
  /** Numeric font weight (100–900). */
  weight: number;
  italic?: boolean;
  underline?: boolean;
  /** CSS line-height multiplier (e.g. 1.2). */
  lineHeight?: number;
  /** Paragraph spacing as a percent of slide height. */
  paragraphSpacing?: number;
  /** Default horizontal alignment for the role. */
  align?: ElementAlign;
  /** Optional letter spacing in `em` units. */
  letterSpacing?: number;
  /** Optional text transform for expressive theme roles. */
  textTransform?: "none" | "uppercase";
};

/** A complete-or-partial map of role → token. */
export type PresentationRoleTokenMap = Partial<
  Record<PresentationRole, PresentationRoleToken>
>;

// ---------------------------------------------------------------------------
// Color tokens
// ---------------------------------------------------------------------------

/**
 * Semantic slide color tokens.
 *
 * All values are hex strings (`"#rrggbb"` or `"#rrggbbaa"`).  Names are
 * intentionally role-based rather than hue-based so token consumers can swap
 * palettes without touching rendering code.
 */
export type ColorToken = {
  /** Background fill of the slide canvas. */
  slideBg: string;
  /** Primary surface color used for card fills, callout boxes, etc. */
  surface: string;
  /** Default brand/accent color for shapes, links, chart highlights. */
  accent: string;
  /** Default foreground color for body text on `slideBg`. */
  onBg: string;
  /** Foreground color for text/icons on `surface`. */
  onSurface: string;
  /** Foreground color for text/icons on `accent`. */
  onAccent: string;
  /** Secondary/muted text and label color. */
  muted: string;
};

// ---------------------------------------------------------------------------
// Typography tokens — re-exported from theme-typography for cohesion
// ---------------------------------------------------------------------------

export type { FontScale } from "./theme-typography";

/**
 * Typography token bundle for one theme.  Mirrors `ThemeTypography` from
 * `theme-typography.ts` but is co-located here so token consumers have a
 * single import point.
 */
export type TypographyToken = {
  /** Body / general text font stack. */
  fontFamily: string;
  /** Heading font stack.  Falls back to `fontFamily` when absent. */
  headingFontFamily?: string;
  /** Point sizes for each semantic text role. */
  scale: FontScale;
  /**
   * Optional explicit semantic role tokens (#603).  When a role is absent the
   * cascade derives a token from {@link FontScale} + color tokens via
   * {@link deriveRoleTokens}.  Authoring this map lets a theme define full
   * per-role typography (font, color, weight, alignment, spacing).
   */
  roles?: PresentationRoleTokenMap;
};

// ---------------------------------------------------------------------------
// Spacing tokens
// ---------------------------------------------------------------------------

/** Slide-level spacing tokens (stored in points, 1 pt = 1/72 in). */
export type SpacingToken = {
  /** Inner padding from each edge of the slide canvas in points. */
  slidePaddingPt: number;
  /** Base snap-grid unit used by the layout engine in points. */
  gridUnitPt: number;
};

// ---------------------------------------------------------------------------
// Shape tokens
// ---------------------------------------------------------------------------

/** Default visual style for shapes that have no explicit style override. */
export type ShapeToken = {
  /** Corner radius for rectangle/card shapes in points. */
  cornerRadiusPt: number;
  /**
   * CSS `box-shadow` value used for floating / elevated elements.
   * Set to `"none"` to suppress shadows by default.
   */
  shadowCss: string;
  /** Optional default fill (hex) for new shapes. Absent → renderer/accent. */
  fill?: string;
  /** Optional default stroke color (hex). Absent → no border. */
  stroke?: string;
  /** Optional default stroke width in `cqmin` units. */
  strokeWidth?: number;
  /** Optional default opacity (0–1). Absent → fully opaque. */
  opacity?: number;
};

// ---------------------------------------------------------------------------
// Non-text default tokens (#601)
// ---------------------------------------------------------------------------

/** Numbered-list rendering style for bullet defaults. */
export type BulletNumberStyle =
  "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman";

/** Deck-template bullet defaults inherited by bullet elements. */
export type BulletDefaultsToken = {
  /** Marker color (hex). Absent → resolves to the accent color. */
  markerColor?: string;
  /** Extra gap between items as a percent of slide height. Absent → 0. */
  gapPct?: number;
  /** List indent as a percent of slide width. Absent → 0. */
  indentPct?: number;
  /** Numbered-list glyph style. Absent → "decimal". */
  numberStyle?: BulletNumberStyle;
};

/** Dash style for connector strokes. */
export type ConnectorDashStyle = "solid" | "dashed" | "dotted";

/** Deck-template connector defaults inherited by connector elements. */
export type ConnectorDefaultsToken = {
  /** Stroke color (hex). Absent → resolves to the onBg color. */
  color?: string;
  /** Stroke width in `cqmin` units. Absent → 0.4. */
  width?: number;
  /** Dash pattern. Absent → "solid". */
  dash?: ConnectorDashStyle;
  /** Arrowhead at the start endpoint. Absent → "none". */
  startArrow?: ConnectorArrow;
  /** Arrowhead at the end endpoint. Absent → "arrow". */
  endArrow?: ConnectorArrow;
};

/** Deck-template visual (chart/diagram) defaults. */
export type VisualDefaultsToken = {
  /** Restyle theme id applied to embedded visuals. Absent → visual's own. */
  styleThemeId?: string;
  /** Render visuals on a transparent background. Absent → false. */
  transparentBackground?: boolean;
};

/** Deck-template image defaults inherited by image elements. */
export type ImageDefaultsToken = {
  /** Fit mode. Absent → "contain". */
  fitMode?: ImageFitMode;
  /** Corner radius as a percent of the box (0–50). Absent → 0. */
  radiusPct?: number;
  /** Mask shape. Absent → "none". */
  maskShape?: ImageMaskShape;
  /** Drop shadow. Absent → false. */
  shadow?: boolean;
};

// ---------------------------------------------------------------------------
// Background treatment
// ---------------------------------------------------------------------------

/**
 * Typed union representing the three supported background modes for a slide or
 * master.  A renderer inspects `type` and reads the corresponding fields.
 *
 * Normalized background form used at the token, master, slide, and element
 * design-override layers.
 */
export type BackgroundTreatment =
  | { type: "solid"; color: string }
  | {
      type: "gradient";
      from: string;
      to: string;
      angle?: number;
      stops?: ThemeGradientStop[];
    }
  | {
      type: "radialGradient";
      inner: string;
      outer: string;
      cx?: number;
      cy?: number;
      r?: number;
      rx?: number;
      ry?: number;
      stops?: ThemeGradientStop[];
    }
  | { type: "image"; url: string };

export interface ThemeGradientStop {
  color: string;
  offset?: number;
}

export interface ThemeShadowToken {
  x: number;
  y: number;
  blur: number;
  color: string;
  opacity?: number;
}

export interface ThemeEffectToken {
  kind: "blur" | "glow" | "glass";
  radius?: number;
  blur?: number;
  color?: string;
  opacity?: number;
  intensity?: "light" | "medium" | "strong";
}

export interface ThemeSurfaceRecipe {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number | ThemeRadiusToken;
  opacity?: number;
  shadow?: ThemeShadowToken;
  effect?: ThemeEffectToken;
}

export interface ThemeRadiusToken {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface ThemeMotifRecipe {
  kind: "orb" | "ring" | "wedge" | "leaf" | "frame" | "bar" | "holo";
  shape?: "rect" | "ellipse" | "circle" | "triangle" | "diamond";
  box: { x: number; y: number; w: number; h: number };
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number | ThemeRadiusToken;
  rotation?: number;
  opacity?: number;
  shadow?: ThemeShadowToken;
  effect?: ThemeEffectToken;
}

export interface ThemeVisualLanguageToken {
  slide?: { radius?: number; shadow?: ThemeShadowToken };
  surfaces?: Partial<
    Record<"card" | "chip" | "tag" | "frame", ThemeSurfaceRecipe>
  >;
  motifs?: Record<string, ThemeMotifRecipe>;
  text?: Partial<
    Record<
      | "kicker"
      | "heroTitle"
      | "subtitle"
      | "stat"
      | "quoteMark"
      | "cardTitle"
      | "cardBody"
      | "chipText",
      Partial<PresentationRoleToken>
    >
  >;
}

// ---------------------------------------------------------------------------
// Complete token set
// ---------------------------------------------------------------------------

/**
 * A complete design-token bundle for one named theme.  Built-in sets are
 * exported below; custom sets can be created at runtime by brand-kit tooling.
 */
export type PresentationTheme = {
  /** Stable id.  Matches the `PresentationThemeId` / `themeId` value used on `Deck`. */
  id: string;
  /** Display name shown in the theme picker UI. */
  name: string;
  colors: ColorToken;
  typography: TypographyToken;
  spacing: SpacingToken;
  shape: ShapeToken;
  /** Optional bullet defaults (#601). Absent → deterministic fallbacks. */
  bullet?: BulletDefaultsToken;
  /** Optional connector defaults (#601). Absent → deterministic fallbacks. */
  connector?: ConnectorDefaultsToken;
  /** Optional visual defaults (#601). Absent → deterministic fallbacks. */
  visual?: VisualDefaultsToken;
  /** Optional image defaults (#601). Absent → deterministic fallbacks. */
  image?: ImageDefaultsToken;
  /** Optional expressive visual-language recipes used by rich theme packages. */
  visualLanguage?: ThemeVisualLanguageToken;
  /** Default background applied when no slide- or master-level override exists. */
  defaultBackground: BackgroundTreatment;
};

// ---------------------------------------------------------------------------
// Override layer tag (documentation / type narrowing helper)
// ---------------------------------------------------------------------------

/**
 * Tags the five cascade layers.  Useful for functions that accept a resolved
 * value annotated with its origin, e.g. for a "where does this color come from?"
 * inspector in the editor.
 */
export type OverrideLayer = "deck" | "master" | "layout" | "slide" | "element";
