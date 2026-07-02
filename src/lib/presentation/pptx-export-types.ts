import type {
  ConnectorEndpoint,
  ImageCrop,
  TableContent,
  TextContent,
} from "./schema";
import type { ImageFitMode } from "./style-schema";
import type { PresentationDiagnostic } from "./diagnostics";
import type { ResolvedVisualChannelColors } from "./visual-channel-colors";

export type PptxLayout = "LAYOUT_WIDE" | "LAYOUT_4X3" | "LAYOUT_CUSTOM";

export type PptxTextStyle = {
  color?: string;
  fontSize?: number;
  fontFace?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  lineHeightMultiple?: number;
  paragraphSpacePt?: number;
};

export type PptxEffect = {
  kind: "glow";
  color: string;
  blurPt: number;
  opacity?: number;
};

export type PptxBackgroundOp = {
  type: "background";
  fill?: string;
  imageFill?: PptxImageFill;
};

export type PptxImageFill = {
  kind: "image";
  assetId: string;
  fit?: ImageFitMode;
};

export type PptxTextOp = {
  type: "text";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  content: TextContent;
  textStyle: PptxTextStyle;
  effect?: PptxEffect;
  rotation?: number;
  zIndex: number;
};

export type PptxShapeOp = {
  type: "shape";
  id: string;
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string | PptxImageFill;
  stroke?: { color: string; widthPt: number };
  effect?: PptxEffect;
  rotation?: number;
  zIndex: number;
};

export type PptxImageOp = {
  type: "image";
  id: string;
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fit?: ImageFitMode;
  crop?: ImageCrop;
  alt?: string;
  effect?: PptxEffect;
  rotation?: number;
  zIndex: number;
};

export type PptxConnectorOp = {
  type: "connector";
  id: string;
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  routing?: "straight" | "elbow" | "curved";
  x: number;
  y: number;
  w: number;
  h: number;
  stroke?: {
    color: string;
    widthPt: number;
    dash?: "solid" | "dashed" | "dotted";
  };
  startArrow?: "none" | "arrow" | "filled";
  endArrow?: "none" | "arrow" | "filled";
  zIndex: number;
};

export type PptxVisualOp = {
  type: "visual";
  id: string;
  assetId?: string;
  visualId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  channelColors?: ResolvedVisualChannelColors;
  transparentBackground?: boolean;
  alt?: string;
  effect?: PptxEffect;
  rotation?: number;
  fill?: string;
  stroke?: { color: string; widthPt: number };
  fallbackLabel?: string;
  zIndex: number;
};

export type PptxTableOp = {
  type: "tableShape";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  table: TableContent;
  headerFill?: string;
  rowFill?: string;
  alternateRowFill?: string;
  border?: {
    color: string;
    widthPt: number;
    dash?: "solid" | "dashed" | "dotted";
  };
  cellMargin?: [number, number, number, number];
  textStyle?: PptxTextStyle;
  zIndex: number;
};

export type PptxOp =
  | PptxTextOp
  | PptxShapeOp
  | PptxImageOp
  | PptxConnectorOp
  | PptxVisualOp
  | PptxTableOp;

export type PptxSlideSpec = {
  id: string;
  background: PptxBackgroundOp;
  ops: PptxOp[];
  notes?: string;
};

export type PptxDeckSpec = {
  layout: PptxLayout;
  slideW: number;
  slideH: number;
  slides: PptxSlideSpec[];
  diagnostics: PresentationDiagnostic[];
};
