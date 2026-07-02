import type {
  Deck,
  ImageAsset,
  LayoutBox,
  SlideChildNode,
  SlideNode,
} from "./schema";

export type ImageUploadResult = {
  src: string;
  assetId?: string;
  alt?: string;
  widthPx?: number;
  heightPx?: number;
  mimeType?: ImageAsset["mimeType"];
  contentHash?: string;
};

export type VisualPickResult = {
  visualId?: string;
  assetId?: string;
  alt?: string;
};

export function nodeFactoryId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

export function assetFactoryId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function imageMimeType(
  type: string,
): "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" | undefined {
  return type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/webp" ||
    type === "image/svg+xml"
    ? type
    : undefined;
}

export function nextZIndex(slide: SlideNode | undefined): number {
  if (!slide || slide.children.length === 0) return 1;
  return (
    Math.max(...slide.children.map((node) => node.layout?.zIndex ?? 0)) + 1
  );
}

function clampFrame(frame: LayoutBox["frame"]): LayoutBox["frame"] {
  const w = Math.max(
    0.5,
    Math.min(100, Number.isFinite(frame.w) ? frame.w : 0.5),
  );
  const h = Math.max(
    0.5,
    Math.min(100, Number.isFinite(frame.h) ? frame.h : 0.5),
  );
  return {
    x: Math.max(0, Math.min(100 - w, Number.isFinite(frame.x) ? frame.x : 0)),
    y: Math.max(0, Math.min(100 - h, Number.isFinite(frame.y) ? frame.y : 0)),
    w,
    h,
  };
}

export function defaultTextNode(zIndex: number): SlideChildNode {
  const id = nodeFactoryId("text");
  const frame = { x: 12, y: 16, w: 42, h: 12 } satisfies LayoutBox["frame"];
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame, zIndex },
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p-1`, text: "Text" }] },
  };
}

export function textFrameAtPoint(point: {
  x: number;
  y: number;
}): LayoutBox["frame"] {
  const frame = { x: 12, y: 16, w: 42, h: 12 } satisfies LayoutBox["frame"];
  return clampFrame({
    x: point.x - frame.w / 2,
    y: point.y - frame.h / 2,
    w: frame.w,
    h: frame.h,
  });
}

export function textNodeAtPoint(
  point: { x: number; y: number },
  zIndex: number,
): SlideChildNode {
  const id = nodeFactoryId("text");
  const frame = textFrameAtPoint(point);
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame, zIndex },
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p-1`, text: "Text" }] },
  };
}

export function defaultShapeNode(zIndex: number): SlideChildNode {
  return {
    id: nodeFactoryId("shape"),
    type: "shape",
    role: "card",
    layout: { frame: { x: 16, y: 20, w: 28, h: 18 }, zIndex },
    style: { ref: "surface.card" },
    content: { shape: "rect" },
  };
}

export function defaultTableNode(zIndex: number): SlideChildNode {
  return {
    id: nodeFactoryId("table"),
    type: "table",
    role: "table",
    layout: { frame: { x: 12, y: 18, w: 56, h: 24 }, zIndex },
    style: { ref: "surface.table" },
    content: {
      columns: [
        { id: "col-1", label: "Column 1" },
        { id: "col-2", label: "Column 2" },
      ],
      rows: [
        { id: "row-1", cells: [{ text: "" }, { text: "" }] },
        { id: "row-2", cells: [{ text: "" }, { text: "" }] },
      ],
    },
  };
}

export function defaultImageNode(zIndex: number): SlideChildNode {
  return {
    id: nodeFactoryId("image"),
    type: "image",
    role: "image",
    layout: { frame: { x: 18, y: 18, w: 40, h: 28 }, zIndex },
    style: { ref: "media.inline" },
    content: { assetId: "placeholder", alt: "Image" },
  };
}

export function defaultVisualNode(zIndex: number): SlideChildNode {
  return {
    id: nodeFactoryId("visual"),
    type: "visual",
    role: "visual",
    layout: { frame: { x: 18, y: 18, w: 46, h: 30 }, zIndex },
    style: { ref: "chart.primary" },
    content: { visualId: "visual-placeholder" },
  };
}

export function defaultConnectorNode(zIndex: number): SlideChildNode {
  return {
    id: nodeFactoryId("connector"),
    type: "connector",
    role: "connector",
    layout: { frame: { x: 20, y: 45, w: 32, h: 10 }, zIndex },
    style: { ref: "connector.primary" },
    content: {
      from: { kind: "point", point: { x: 0, y: 50 } },
      to: { kind: "point", point: { x: 100, y: 50 } },
      routing: "straight",
    },
  };
}

export function deckWithPickedVisualAsset(
  deck: Deck,
  picked: VisualPickResult,
): Deck {
  if (!picked.assetId) return deck;
  const visualId = picked.visualId ?? picked.assetId;
  return {
    ...deck,
    assets: {
      ...deck.assets,
      visuals: {
        ...deck.assets.visuals,
        [picked.assetId]: {
          id: picked.assetId,
          visualId,
          ...(picked.alt !== undefined ? { alt: picked.alt } : {}),
        },
      },
    },
  };
}

export function visualContentPatchFromPick(
  picked: VisualPickResult,
): Record<string, unknown> {
  return {
    ...(picked.visualId !== undefined ? { visualId: picked.visualId } : {}),
    ...(picked.assetId !== undefined ? { assetId: picked.assetId } : {}),
    ...(picked.alt !== undefined ? { alt: picked.alt } : {}),
  };
}

export function deckWithUploadedImageAsset({
  deck,
  upload,
  fileName,
  fileType,
  now = () => new Date().toISOString(),
  createAssetId = assetFactoryId,
}: {
  deck: Deck;
  upload: ImageUploadResult;
  fileName: string;
  fileType: string;
  now?: () => string;
  createAssetId?: (prefix: string) => string;
}):
  | {
      deckWithAsset: Deck;
      assetId: string;
      alt: string;
    }
  | undefined {
  if (!upload.src) return undefined;
  const assetId = upload.assetId ?? createAssetId("image");
  const alt = upload.alt ?? fileName;
  const mimeType = upload.mimeType ?? imageMimeType(fileType);
  return {
    deckWithAsset: {
      ...deck,
      assets: {
        ...deck.assets,
        images: {
          ...deck.assets.images,
          [assetId]: {
            id: assetId,
            src: upload.src,
            alt,
            ...(upload.widthPx ? { widthPx: upload.widthPx } : {}),
            ...(upload.heightPx ? { heightPx: upload.heightPx } : {}),
            ...(mimeType ? { mimeType } : {}),
            ...(upload.contentHash ? { contentHash: upload.contentHash } : {}),
            origin: { kind: "upload", importedAt: now() },
          },
        },
      },
    },
    assetId,
    alt,
  };
}
