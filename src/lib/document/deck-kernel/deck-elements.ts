/** Slide element families and element helper constructors. */

import type { PresentationRole } from "./presentation-role-primitives";
import type { AssetReference, ResolvedAssetUrl } from "@/lib/asset-vocabulary";
import {
  GLASS_EFFECT_INTENSITIES,
  IMAGE_FIT_MODES,
  IMAGE_MASK_SHAPES,
  type ConnectorArrow,
  type ElementAlign,
  type GlassEffectIntensity,
  type ImageFitMode,
  type ImageMaskShape,
} from "./deck-element-primitives";
import { makeElementId } from "./deck-ids";
import type { SourceRef } from "./deck-source-refs";

/**
 * Positioned box for a free-form element, expressed in **percentages** of the
 * slide (0–100). Percentage units keep slides resolution- and aspect-ratio
 * independent so the same deck renders identically at any size.
 */
export interface ElementBox {
  /** Left edge, percent of slide width. */
  x: number;
  /** Top edge, percent of slide height. */
  y: number;
  /** Width, percent of slide width. */
  w: number;
  /** Height, percent of slide height. */
  h: number;
}

/**
 * A formatted span of text within a line. Produced by `blockRichText()` from a
 * serialised Lexical block so document emphasis survives into slide derivation.
 *
 * Every field except `text` is optional and only set when the span actually
 * carries that formatting, keeping runs compact and additive. A run with no
 * formatting flags is equivalent to plain text.
 */
/* node:coverage ignore next 20 -- type-only text-run fields are erased by tsx and reported as source-map gaps. */
export interface TextRun {
  /** The literal text of this span. */
  text: string;
  /** Bold emphasis. */
  bold?: boolean;
  /** Italic emphasis. */
  italic?: boolean;
  /** Underline emphasis. */
  underline?: boolean;
  /** Optional run font size as a percent of slide height. */
  fontSize?: number;
  /** Inline (monospace) code. */
  code?: boolean;
  /** Hex color (e.g. `#ff0000`) carried by the span, if any. */
  color?: string;
  /** Destination URL when the span is a hyperlink. */
  link?: string;
}

/**
 * Controls how a text element handles content that exceeds its box.
 *
 * - `"auto-height"` (default / absent): the box grows to fit the content
 *   height in the editor; the canvas clips only if the box is intentionally
 *   smaller than the content.
 * - `"fixed-box"`: the box height is pinned; content that overflows is clipped.
 * - `"shrink-to-fit"`: the font size is reduced automatically until the
 *   content fits within the box without clipping.
 */
export type TextFitMode = "auto-height" | "fixed-box" | "shrink-to-fit";

/** Text styling for text elements and shape labels. */
export interface TextElementStyle {
  /** Font size as a percent of slide height (rendered via `cqh`). */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** Optional underline for the whole element. */
  underline?: boolean;
  align: ElementAlign;
  /**
   * Vertical alignment of text within its box.
   * - `"top"`: content starts at the top edge.
   * - `"middle"` (default): content is vertically centered.
   * - `"bottom"`: content is pushed to the bottom edge.
   */
  verticalAlign?: "top" | "middle" | "bottom";
  /**
   * CSS `line-height` multiplier (e.g. 1.2, 1.5, 2.0).
   * When absent the renderer uses its own default (~1.15–1.2).
   */
  lineHeight?: number;
  /**
   * Extra space below each paragraph / text block, expressed as a percent of
   * slide height (the same unit as `fontSize`). Absent → 0.
   */
  paragraphSpacing?: number;
  /** Optional hex color override; falls back to the theme color when unset. */
  color?: string;
  /** Optional text fill. When set to a gradient, renderers clip it to text. */
  textFill?: ElementFill;
  /** Letter spacing in `em` units. */
  letterSpacing?: number;
  /** Optional text transform for expressive theme roles. */
  textTransform?: "none" | "uppercase";
  /**
   * Optional slide font id (see `slide-fonts.ts`). Selects a self-hosted,
   * cross-platform font for this element; falls back to the theme/role font
   * when unset.
   */
  fontId?: string;
}

export type ShapeKind =
  "rect" | "ellipse" | "line" | "triangle" | "diamond" | "circle" | "square";

export type ColorRef = { token: string } | { value: string };

export interface GradientStop {
  color: ColorRef;
  /** Stop offset in percent (0–100). Absent lets the renderer distribute it. */
  offset?: number;
}

export interface RadialGradientFill {
  type: "radialGradient";
  inner: ColorRef;
  outer: ColorRef;
  cx?: number;
  cy?: number;
  r?: number;
  /** Optional horizontal radius in percent. Falls back to `r`. */
  rx?: number;
  /** Optional vertical radius in percent. Falls back to `r`. */
  ry?: number;
  /** Optional ordered stops for richer radial treatments. */
  stops?: GradientStop[];
}

export interface LinearGradientFill {
  type: "linearGradient";
  from: ColorRef;
  to: ColorRef;
  /** Gradient angle in degrees; defaults to 90 (left → right). */
  angle?: number;
  /** Optional ordered stops for richer linear treatments. */
  stops?: GradientStop[];
}

export type ElementFill = ColorRef | RadialGradientFill | LinearGradientFill;

export interface GlassEffect {
  kind: "glass";
  intensity: GlassEffectIntensity;
}

export interface BlurEffect {
  kind: "blur";
  radius: number;
}

export interface GlowEffect {
  kind: "glow";
  color: string;
  blur: number;
  opacity?: number;
}

export type ElementEffect = GlassEffect | BlurEffect | GlowEffect;

export interface ElementRadiusCorners {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export type ElementRadius = number | ElementRadiusCorners;

export interface ElementShadow {
  x: number;
  y: number;
  blur: number;
  color: string;
  opacity?: number;
}

export type ConnectorAnchor = "center" | "top" | "bottom" | "left" | "right";

export interface ConnectorEndpoint {
  elementId: string;
  anchor: ConnectorAnchor;
}

/**
 * A free-floating connector endpoint expressed in percentage units (0–100).
 * Used when a connector end is not bound to an element anchor.
 */
export interface ConnectorPointFree {
  /** Horizontal position as a percent of slide width. */
  x: number;
  /** Vertical position as a percent of slide height. */
  y: number;
}

/**
 * A connector endpoint is either a free point in slide-percentage space or an
 * anchor bound to another element on the same slide.
 */
export type ConnectorPoint = ConnectorPointFree | ConnectorEndpoint;

/** Routing algorithm for a {@link ConnectorElement}. */
export type ConnectorRouting = "straight" | "elbow";

export interface TextElementContent {
  kind: "text";
  text: string;
  paragraphs?: Paragraph[];
  runs?: TextRun[];
  fitMode?: TextFitMode;
  bulletGap?: number;
  bulletIndent?: number;
}

export interface VisualElementContent {
  kind: "visual";
  visualId: string;
  styleThemeId?: string;
  alt?: string;
}

export interface ImageElementContent {
  kind: "image";
  src?: ResolvedAssetUrl;
  assetId?: AssetReference;
  alt?: string;
  crop?: ImageCrop;
}

export interface ShapeElementContent {
  kind: "shape";
  shape: ShapeKind;
  text?: string;
  textRuns?: TextRun[];
}

export interface ConnectorElementContent {
  kind: "connector";
  start: ConnectorPoint;
  end: ConnectorPoint;
  routing?: ConnectorRouting;
}

export interface TableElementContent {
  kind: "table";
  columns: TableColumn[];
  rows: TableRow[];
  header?: boolean;
  caption?: string;
}

export interface TableColumn {
  id: string;
  label: string;
  width?: number;
}

export interface TableRow {
  id: string;
  cells: TableCell[];
}

export interface TableCell {
  text: string;
  runs?: TextRun[];
}

export interface TableElementStyle {
  headerFill?: ColorRef;
  rowFill?: ColorRef;
  alternateRowFill?: ColorRef;
  borderColor?: string;
  borderWidth?: number;
  textStyle?: Partial<TextElementStyle>;
  headerTextStyle?: Partial<TextElementStyle>;
}

export interface ElementDesignOverrides {
  styleThemeId?: string;
  textStyle?: Partial<TextElementStyle>;
  fill?: ElementFill;
  stroke?: { color: string; width: number };
  radius?: ElementRadius;
  fitMode?: ImageFitMode;
  maskShape?: ImageMaskShape;
  effect?: ElementEffect;
  opacity?: number;
  dash?: boolean;
  arrowStart?: ConnectorArrow;
  arrowEnd?: ConnectorArrow;
  tableStyle?: TableElementStyle;
}

/**
 * A first-class connector element — a directed line between two points that may
 * optionally be anchored to other slide elements.
 *
 * Authored as `kind: "connector"` and carries connector semantics
 * (arrowheads, dash, routing) without a shape-type branch.
 */
export interface ConnectorElement extends BaseElement {
  kind: "connector";
  content: ConnectorElementContent;
}

export interface BaseElement {
  /** Stable identifier, unique within a slide. */
  id: string;
  /** Positioned box in percent units. */
  box: ElementBox;
  /** Stacking order — higher renders on top. */
  zIndex: number;
  /**
   * Optional element opacity in the `[0, 1]` range. Absent (or `1`) means fully
   * opaque; renderers apply it uniformly so the editor, present mode, public
   * viewer and export stay identical.
   */
  opacity?: number;
  /**
   * Optional clockwise rotation in degrees about the element's center. Absent
   * (or `0`) means upright. Applied as a CSS transform in every renderer.
   */
  rotation?: number;
  /** Optional drop shadow. Absent/false means no shadow. */
  shadow?: boolean | ElementShadow;
  /** When true, the element is not selectable or draggable in the editor. */
  locked?: boolean;
  /**
   * When true, the element is not rendered in the editor, present mode, or
   * export. Set/cleared via the layer list (issue #331).
   */
  hidden?: boolean;
  /**
   * Optional user-assigned display name for the element, shown in the layer
   * list. When absent the layer list derives a name from content (issue #331).
   */
  name?: string;
  /**
   * Optional group id. Elements sharing a `groupId` select and move together in
   * the editor. Renderers ignore it. Cleared by ungrouping.
   */
  groupId?: string;
  /** Optional provenance link back to the source document block. */
  source?: SourceRef;
  /** Semantic presentation role used by the design cascade. */
  role?: PresentationRole;
  /** Local design overrides applied over deck/master/template defaults. */
  designOverrides?: ElementDesignOverrides;
}

export interface TextElement extends BaseElement {
  kind: "text";
  content: TextElementContent;
}

/**
 * A single paragraph in a text element. When `listType` is present, the
 * paragraph renders as a bullet or numbered list item.
 */
export interface Paragraph {
  text: string;
  /** Rich-text runs for this paragraph; falls back to `text` when absent. */
  runs?: TextRun[];
  /**
   * Nesting depth: 0 = top level (default), 1 = first nested, 2 = second
   * nested.  Clamped to [0, 5] by validators.
   */
  indent?: number;
  /** Marker style for this item.  Defaults to `"bullet"`. */
  listType?: "bullet" | "number";
}

export type BulletItem = Paragraph;

/**
 * Returns the canonical paragraph list for a text element.
 */
export function normalizeTextParagraphs(
  el: Pick<TextElement, "content">,
): Paragraph[] {
  const { content } = el;
  if (content.paragraphs !== undefined) return content.paragraphs;
  if (typeof content.text === "string") {
    return [
      {
        text: content.text,
        ...(content.runs !== undefined && content.runs.length > 0
          ? { runs: content.runs }
          : {}),
      },
    ];
  }
  return [];
}

export interface VisualElement extends BaseElement {
  kind: "visual";
  content: VisualElementContent;
}

/** How an image is sized within its element box. */
export { GLASS_EFFECT_INTENSITIES, IMAGE_FIT_MODES, IMAGE_MASK_SHAPES };
export type {
  ConnectorArrow,
  ElementAlign,
  GlassEffectIntensity,
  ImageFitMode,
  ImageMaskShape,
};

/** Shape mask options for an image element. */
/** Fractional clipping inset applied to an image element. */
export interface ImageCrop {
  /** Fraction clipped from the top edge (0–1). */
  top: number;
  /** Fraction clipped from the right edge (0–1). */
  right: number;
  /** Fraction clipped from the bottom edge (0–1). */
  bottom: number;
  /** Fraction clipped from the left edge (0–1). */
  left: number;
}

export interface ImageElement extends BaseElement {
  kind: "image";
  content: ImageElementContent;
}

export interface ShapeElement extends BaseElement {
  kind: "shape";
  content: ShapeElementContent;
}

export interface TableElement extends BaseElement {
  kind: "table";
  role?: "table";
  content: TableElementContent;
}

/** Discriminated union of every free-form slide element. */
export type SlideElement =
  | TextElement
  | VisualElement
  | ImageElement
  | ShapeElement
  | ConnectorElement
  | TableElement;

/**
 * Default centered box for a freshly inserted visual element, in percent units.
 * Wide and tall enough to read on a blank slide while leaving a margin so the
 * insert never butts against the slide edge. Kept as a named constant so the
 * "Insert visual" picker and tests share one source of truth.
 */
export const DEFAULT_VISUAL_BOX: ElementBox = { x: 25, y: 18, w: 50, h: 64 };

/**
 * Builds a {@link VisualElement} (sans `zIndex`) for the given document visual,
 * positioned at a default centered {@link ElementBox}. Pure and DOM-free: the
 * "Insert document visual" picker routes the result through
 * `addElement`/`onDeckChange` so the insert is undoable. `zIndex` is assigned by
 * `addElement`, so it is intentionally omitted here.
 *
 * Pass `options.source` to stamp provenance metadata when inserting from
 * a source document (issue #424).
 */
export function buildVisualElement(
  visualId: string,
  options: {
    id?: string;
    box?: ElementBox;
    styleThemeId?: string;
    /** Optional source-document provenance for inserted document visuals (#424). */
    source?: SourceRef;
  } = {},
): Omit<VisualElement, "zIndex"> & { id: string } {
  return {
    id: options.id ?? makeElementId(),
    kind: "visual",
    role: "visual",
    box: options.box ?? { ...DEFAULT_VISUAL_BOX },
    content: {
      kind: "visual",
      visualId,
      ...(options.styleThemeId ? { styleThemeId: options.styleThemeId } : {}),
    },
    ...(options.source !== undefined ? { source: options.source } : {}),
  };
}
