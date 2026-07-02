import type {
  ConnectorEndpoint,
  ImageCrop,
  TableContent,
  TextContent,
} from "./schema";
import type { FillStyle, ImageFitMode, StyleObject } from "./style-schema";
import type { NodeId, CanvasSpec } from "./types";
import type { PresentationDiagnostic } from "./diagnostics";
import type { ResolvedVisualChannelColors } from "./visual-channel-colors";

export type ExportBackgroundOperation = {
  type: "background";
  fill?: FillStyle;
};

export type ExportTextOperation = {
  type: "text";
  id: NodeId;
  frame: { x: number; y: number; w: number; h: number };
  content: TextContent;
  style: StyleObject;
  rotation?: number;
  zIndex: number;
};

export type ExportShapeOperation = {
  type: "shape";
  id: NodeId;
  shape: string;
  frame: { x: number; y: number; w: number; h: number };
  style: StyleObject;
  rotation?: number;
  zIndex: number;
};

export type ExportImageOperation = {
  type: "image";
  id: NodeId;
  assetId: string;
  frame: { x: number; y: number; w: number; h: number };
  style: StyleObject;
  fit?: ImageFitMode;
  crop?: ImageCrop;
  alt?: string;
  rotation?: number;
  zIndex: number;
};

export type ExportConnectorOperation = {
  type: "connector";
  id: NodeId;
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  routing?: "straight" | "elbow" | "curved";
  frame: { x: number; y: number; w: number; h: number };
  style: StyleObject;
  zIndex: number;
};

export type ExportVisualOperation = {
  type: "visual";
  id: NodeId;
  assetId?: string;
  visualId?: string;
  pptxAssetPreflight?: ExportVisualAssetPreflight;
  frame: { x: number; y: number; w: number; h: number };
  style: StyleObject;
  channelColors?: ResolvedVisualChannelColors;
  transparentBackground?: boolean;
  alt?: string;
  rotation?: number;
  zIndex: number;
};

export type ExportVisualAssetPreflight =
  | {
      status: "ready";
      assetId: string;
      source: "declared-asset" | "visual-registry";
    }
  | {
      status: "missing";
      requestedAssetId?: string;
      visualId?: string;
    }
  | {
      status: "unsupported";
      requestedAssetId: string;
      visualId?: string;
      mimeType?: string;
    };

export type ExportTableShapeOperation = {
  type: "tableShape";
  id: NodeId;
  frame: { x: number; y: number; w: number; h: number };
  style: StyleObject;
  table: TableContent;
  zIndex: number;
};

export type ExportOperation =
  | ExportTextOperation
  | ExportShapeOperation
  | ExportImageOperation
  | ExportConnectorOperation
  | ExportVisualOperation
  | ExportTableShapeOperation;

export type ExportSlideSpec = {
  id: NodeId;
  background: ExportBackgroundOperation;
  operations: ExportOperation[];
  notes?: string;
};

export type ExportDeckSpec = {
  canvas: CanvasSpec;
  slides: ExportSlideSpec[];
  diagnostics: PresentationDiagnostic[];
};
