import type {
  ConnectorEndpoint,
  ImageCrop,
  TableContent,
  TextContent,
} from "./schema";
import type { ImageFitMode } from "./style-schema";
import type { PresentationDiagnostic } from "./diagnostics";
import type { ResolvedVisualChannelColors } from "./visual-channel-colors";

export type VnextPptxLayout = "LAYOUT_WIDE" | "LAYOUT_4X3" | "LAYOUT_CUSTOM";

export type VnextPptxTextStyle = {
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

export type VnextPptxBackgroundOp = {
  type: "background";
  fill?: string;
};

export type VnextPptxTextOp = {
  type: "text";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  content: TextContent;
  textStyle: VnextPptxTextStyle;
  rotation?: number;
  zIndex: number;
};

export type VnextPptxShapeOp = {
  type: "shape";
  id: string;
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: { color: string; widthPt: number };
  rotation?: number;
  zIndex: number;
};

export type VnextPptxImageOp = {
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
  rotation?: number;
  zIndex: number;
};

export type VnextPptxConnectorOp = {
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

export type VnextPptxVisualOp = {
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
  rotation?: number;
  fill?: string;
  stroke?: { color: string; widthPt: number };
  fallbackLabel?: string;
  zIndex: number;
};

export type VnextPptxTableOp = {
  type: "tableShape";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  table: TableContent;
  headerFill?: string;
  rowFill?: string;
  textStyle?: VnextPptxTextStyle;
  zIndex: number;
};

export type VnextPptxOp =
  | VnextPptxTextOp
  | VnextPptxShapeOp
  | VnextPptxImageOp
  | VnextPptxConnectorOp
  | VnextPptxVisualOp
  | VnextPptxTableOp;

export type VnextPptxSlideSpec = {
  id: string;
  background: VnextPptxBackgroundOp;
  ops: VnextPptxOp[];
  notes?: string;
};

export type VnextPptxDeckSpec = {
  layout: VnextPptxLayout;
  slideW: number;
  slideH: number;
  slides: VnextPptxSlideSpec[];
  diagnostics: PresentationDiagnostic[];
};
