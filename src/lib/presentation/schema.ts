/**
 * Main presentation deck schema types.
 *
 * Persisted JSON must match these shapes exactly (strict mode: unknown keys are
 * rejected except inside `metadata.extra`, `source.extra`, and `debug` fields).
 */

import type {
  DeckId,
  NodeId,
  AssetId,
  ThemePackageId,
  ThemeVersion,
  TemplateVersion,
  IsoDateTime,
  CanvasSpec,
  FramePct,
  InsetsPct,
  PointPct,
  JsonValue,
  DeepPartial,
  StyleVariantId,
} from "./types";
import type { StyleBinding, StylePatch, StyleRef } from "./style-schema";

export type { StyleRef, StyleVariantId, StyleBinding, AssetId, CanvasSpec };

// ---------------------------------------------------------------------------
// Deck metadata
// ---------------------------------------------------------------------------

export type DeckMetadata = {
  createdAt?: IsoDateTime;
  updatedAt?: IsoDateTime;
  sourceDocumentId?: string;
  contentHash?: string;
  locale?: string;
  extra?: Record<string, JsonValue>;
};

// ---------------------------------------------------------------------------
// Asset registry
// ---------------------------------------------------------------------------

export type AssetOrigin = {
  kind: "upload" | "document" | "ai" | "theme" | "remote";
  sourceId?: string;
  importedAt?: IsoDateTime;
};

export type ImageAsset = {
  id: AssetId;
  src: string;
  alt?: string;
  widthPx?: number;
  heightPx?: number;
  mimeType?:
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp"
    | "image/svg+xml";
  contentHash?: string;
  origin?: AssetOrigin;
};

export type FontAsset = {
  id: AssetId;
  family: string;
  src: string;
  weight?: number | number[];
  style?: "normal" | "italic";
  contentHash?: string;
};

export type VisualAssetRef = {
  id: AssetId;
  visualId: string;
  documentId?: string;
  title?: string;
  alt?: string;
  contentHash?: string;
};

export type FileAsset = {
  id: AssetId;
  src: string;
  filename?: string;
  mimeType?: string;
  contentHash?: string;
};

export type DeckAssetRegistry = {
  images: Record<AssetId, ImageAsset>;
  fonts?: Record<AssetId, FontAsset>;
  visuals?: Record<AssetId, VisualAssetRef>;
  files?: Record<AssetId, FileAsset>;
};

// ---------------------------------------------------------------------------
// Deck theme binding
// ---------------------------------------------------------------------------

import type { ThemeTokens } from "./style-schema";

export type ThemeOverridePatch = {
  tokens?: DeepPartial<ThemeTokens>;
  styles?: Partial<Record<StyleRef, Record<string, Partial<StylePatch>>>>;
  disabledDecorations?: string[];
  chrome?: Partial<DeckChromeConfig>;
};

export type DeckThemeBinding = {
  packageId: ThemePackageId;
  packageVersion?: ThemeVersion;
  brandKitId?: string;
  overrides?: ThemeOverridePatch;
};

// ---------------------------------------------------------------------------
// Node layout
// ---------------------------------------------------------------------------

export type LayoutConstraints = {
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  preserveAspectRatio?: boolean;
};

export type LayoutBox = {
  frame: FramePct;
  rotation?: number;
  zIndex: number;
  autoHeight?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  anchor?: "topLeft" | "center";
  constraints?: LayoutConstraints;
};

// ---------------------------------------------------------------------------
// Accessibility and source metadata
// ---------------------------------------------------------------------------

export type AccessibilityMetadata = {
  label?: string;
  alt?: string;
  decorative?: boolean;
  readingOrder?: number;
};

export type SourceRefreshState =
  | "fresh"
  | "stale"
  | "orphan"
  | "unlinked"
  | "unknown";

export type SourceRefreshMetadata = {
  state: SourceRefreshState;
  checkedAt?: IsoDateTime;
  refreshedAt?: IsoDateTime;
  sourceHash?: string;
  reason?: string;
};

export type SourceDisplayMetadata = {
  documentTitle?: string;
  blockLabel?: string;
  blockKindLabel?: string;
};

export type NodeSourceMetadata = {
  documentId?: string;
  blockId?: string;
  blockKind?: "text" | "visual" | "table" | "image";
  contentHash?: string;
  blockRevision?: string;
  linkedAt?: IsoDateTime;
  display?: SourceDisplayMetadata;
  refresh?: SourceRefreshMetadata;
  unlinked?: boolean;
  extra?: Record<string, JsonValue>;
};

// ---------------------------------------------------------------------------
// Semantic roles
// ---------------------------------------------------------------------------

export type SemanticRole =
  | "slide"
  | "title"
  | "subtitle"
  | "kicker"
  | "body"
  | "bullet"
  | "caption"
  | "quote"
  | "attribution"
  | "metric"
  | "label"
  | "table"
  | "visual"
  | "image"
  | "card"
  | "callout"
  | "connector"
  | "background"
  | "themeDecoration";

// ---------------------------------------------------------------------------
// Slot keys
// ---------------------------------------------------------------------------

export type SlotKey =
  | "kicker"
  | "title"
  | "subtitle"
  | "body"
  | "bullets"
  | "leftTitle"
  | "leftBody"
  | "leftBullets"
  | "rightTitle"
  | "rightBody"
  | "rightBullets"
  | "cards"
  | "steps"
  | "quote"
  | "attribution"
  | "stat"
  | "statLabel"
  | "metrics"
  | "table"
  | "visualId"
  | "imagePrompt"
  | "caption";

// ---------------------------------------------------------------------------
// Text content types
// ---------------------------------------------------------------------------

export type TextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  link?: string;
  localStyle?: Pick<
    import("./style-schema").TextStyle,
    "color" | "fontSizePt" | "fontFamily"
  >;
};

export type ListMarker = {
  kind: "bullet" | "number";
  indent?: number;
  numberStyle?: "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman";
};

export type Paragraph = {
  id: string;
  text: string;
  runs?: TextRun[];
  list?: ListMarker;
};

export type TextFitMode = "auto-height" | "fixed-box" | "shrink-to-fit";

export type TextContent = {
  paragraphs: Paragraph[];
  fit?: TextFitMode;
  language?: string;
};

// ---------------------------------------------------------------------------
// Shape content
// ---------------------------------------------------------------------------

export type ShapeKind =
  | "rect"
  | "ellipse"
  | "line"
  | "triangle"
  | "diamond"
  | "circle"
  | "square"
  | "path";

export type SvgPathData = string;

export type ShapeContent = {
  shape: ShapeKind;
  path?: SvgPathData;
};

// ---------------------------------------------------------------------------
// Image content
// ---------------------------------------------------------------------------

export type ImageCrop = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ImageContent = {
  assetId: AssetId;
  crop?: ImageCrop;
  fit?: import("./style-schema").ImageFitMode;
  focalPoint?: PointPct;
  alt?: string;
};

// ---------------------------------------------------------------------------
// Connector content
// ---------------------------------------------------------------------------

export type ConnectorAnchor = "center" | "top" | "right" | "bottom" | "left";

export type ConnectorEndpoint =
  | { kind: "point"; point: PointPct }
  | { kind: "node"; nodeId: NodeId; anchor: ConnectorAnchor };

export type ConnectorContent = {
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  routing?: "straight" | "elbow" | "curved";
};

// ---------------------------------------------------------------------------
// Table content
// ---------------------------------------------------------------------------

export type TableColumn = {
  id: string;
  label: string;
  width?: number;
};

export type TableCell = {
  text: string;
  runs?: TextRun[];
};

export type TableRow = {
  id: string;
  cells: TableCell[];
};

export type TableContent = {
  columns: TableColumn[];
  rows: TableRow[];
  header?: boolean;
  caption?: string;
};

// ---------------------------------------------------------------------------
// Visual content
// ---------------------------------------------------------------------------

export type VisualContent = {
  assetId?: AssetId;
  visualId?: string;
  transparentBackground?: boolean;
  alt?: string;
};

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export type GroupComponentKind =
  | "metricCard"
  | "quoteBlock"
  | "timeline"
  | "comparisonGrid"
  | "cardGrid"
  | "custom";

// ---------------------------------------------------------------------------
// Base node
// ---------------------------------------------------------------------------

export type BaseNode = {
  id: NodeId;
  name?: string;
  role?: SemanticRole;
  slot?: SlotKey;
  layout?: LayoutBox;
  style?: StyleBinding;
  localStyle?: StylePatch;
  locked?: boolean;
  hidden?: boolean;
  accessibility?: AccessibilityMetadata;
  source?: NodeSourceMetadata;
};

// ---------------------------------------------------------------------------
// Concrete node types
// ---------------------------------------------------------------------------

export type TextNode = BaseNode & {
  type: "text";
  content: TextContent;
};

export type ImageNode = BaseNode & {
  type: "image";
  content: ImageContent;
};

export type ShapeNode = BaseNode & {
  type: "shape";
  content: ShapeContent;
};

export type ConnectorNode = BaseNode & {
  type: "connector";
  content: ConnectorContent;
};

export type TableNode = BaseNode & {
  type: "table";
  content: TableContent;
};

export type VisualNode = BaseNode & {
  type: "visual";
  content: VisualContent;
};

export type GroupNode = BaseNode & {
  type: "group";
  component: GroupComponentKind;
  children: SlideChildNode[];
};

export type SlideChildNode =
  | TextNode
  | ImageNode
  | ShapeNode
  | ConnectorNode
  | TableNode
  | VisualNode
  | GroupNode;

// ---------------------------------------------------------------------------
// Slide root
// ---------------------------------------------------------------------------

export type SemanticTemplateKind =
  | "cover"
  | "agenda"
  | "section"
  | "executive-summary"
  | "content"
  | "detail"
  | "quote"
  | "big-stat"
  | "metric-row"
  | "insight"
  | "evidence"
  | "table"
  | "comparison"
  | "matrix"
  | "framework"
  | "process"
  | "timeline"
  | "roadmap"
  | "architecture"
  | "case-study"
  | "risks"
  | "recommendation"
  | "pricing"
  | "team"
  | "visual-focus"
  | "closing"
  | "appendix";

export type SlideTemplateBinding = {
  kind: SemanticTemplateKind;
  templateVersion?: TemplateVersion;
  layoutId?: string;
};

export type SlideTone =
  | "neutral"
  | "confident"
  | "warm"
  | "urgent"
  | "premium"
  | "technical";

export type SlideDensity = "airy" | "normal" | "dense";

export type SlideEmphasis =
  | "balanced"
  | "title"
  | "data"
  | "visual"
  | "quote"
  | "action";

export type SlideControls = {
  tone?: SlideTone;
  density?: SlideDensity;
  emphasis?: SlideEmphasis;
};

export type SlideProps = {
  decoration?: "none" | "subtle" | "default" | "expressive";
  chrome?: "default" | "minimal" | "none";
  deckChrome?: SlideDeckChromeOverrides;
};

export type SlideNode = BaseNode & {
  type: "slide";
  template: SlideTemplateBinding;
  controls?: SlideControls;
  props?: SlideProps;
  children: SlideChildNode[];
  notes?: string;
};

// ---------------------------------------------------------------------------
// Deck chrome
// ---------------------------------------------------------------------------

export type DeckChromeKind =
  | "logo"
  | "footer"
  | "pageNumber"
  | "watermark"
  | "border"
  | "safeArea";

export type DeckChromeLayer = "background" | "foreground";

export type DeckChromeBase = {
  enabled?: boolean;
  layout?: LayoutBox;
  style?: StylePatch;
  layer?: DeckChromeLayer;
};

export type DeckChromeLogoPlacement =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";
export type DeckChromeLogoSize = "small" | "medium" | "large";

export type DeckChromeLogo = DeckChromeBase & {
  assetId?: AssetId;
  alt?: string;
  placement?: DeckChromeLogoPlacement;
  size?: DeckChromeLogoSize;
};

export type DeckChromeTextAlign = "left" | "center" | "right";

export type DeckChromeFooter = DeckChromeBase & {
  text?: string;
  align?: DeckChromeTextAlign;
};

export type DeckChromePageNumberFormat = "number" | "number-total";
export type DeckChromePageNumberPlacement =
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type DeckChromePageNumber = DeckChromeBase & {
  format?: DeckChromePageNumberFormat;
  placement?: DeckChromePageNumberPlacement;
};

export type DeckChromeWatermarkLayout = "center" | "diagonal";
export type DeckChromeWatermarkSize = "small" | "medium" | "large";

export type DeckChromeWatermark = DeckChromeBase & {
  text?: string;
  opacity?: number;
  layoutMode?: DeckChromeWatermarkLayout;
  size?: DeckChromeWatermarkSize;
};

export type DeckChromeBorder = DeckChromeBase & {
  color?: string;
  widthPt?: number;
};

export type DeckChromeSafeArea = DeckChromeBase & {
  insets?: InsetsPct;
  color?: string;
  widthPt?: number;
};

export type DeckChromeConfig = {
  logo?: DeckChromeLogo;
  footer?: DeckChromeFooter;
  pageNumber?: DeckChromePageNumber;
  watermark?: DeckChromeWatermark;
  border?: DeckChromeBorder;
  safeArea?: DeckChromeSafeArea;
};

export type SlideDeckChromeOverrideMode =
  | "inherit"
  | "disabled"
  | "detached"
  | "override";

export type SlideDeckChromeOverride<TChrome> =
  | { mode: "inherit" }
  | { mode: "disabled" }
  | { mode: "detached"; nodeId?: NodeId }
  | { mode: "override"; value: Partial<TChrome> };

export type SlideDeckChromeOverrides = {
  logo?: SlideDeckChromeOverride<DeckChromeLogo>;
  footer?: SlideDeckChromeOverride<DeckChromeFooter>;
  pageNumber?: SlideDeckChromeOverride<DeckChromePageNumber>;
  watermark?: SlideDeckChromeOverride<DeckChromeWatermark>;
  border?: SlideDeckChromeOverride<DeckChromeBorder>;
  safeArea?: SlideDeckChromeOverride<DeckChromeSafeArea>;
};

// ---------------------------------------------------------------------------
// Top-level deck
// ---------------------------------------------------------------------------

export type Deck = {
  schemaVersion: 7;
  id?: DeckId;
  title?: string;
  canvas: CanvasSpec;
  theme: DeckThemeBinding;
  chrome?: DeckChromeConfig;
  assets: DeckAssetRegistry;
  slides: SlideNode[];
  metadata?: DeckMetadata;
};

export const DECK_SCHEMA_VERSION = 7 as const;
