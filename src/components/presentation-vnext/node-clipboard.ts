import type { SlideChildNode } from "@/lib/presentation-vnext/schema";
import {
  serializeTextIqNodePayload,
  textIqNodePlainTextFallback,
  TEXTIQ_NODE_CLIPBOARD_MIME,
} from "@/lib/presentation-vnext/clipboard/node-payload";

export type TextIqNodeClipboardImage = {
  blob: Blob;
  type: string;
};

export type TextIqNodeClipboardRead = {
  textIqPayload: string | null;
  image: TextIqNodeClipboardImage | null;
  html: string | null;
  plainText: string | null;
};

const CLIPBOARD_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function canReadTextIqNodeClipboard(): boolean {
  /* node:coverage ignore next */
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.read === "function"
  );
}

export async function writeTextIqNodesToClipboard(
  nodes: readonly SlideChildNode[],
): Promise<boolean> {
  try {
    const payload = serializeTextIqNodePayload(nodes);
    /* node:coverage ignore next */
    if (
      typeof navigator === "undefined" ||
      typeof navigator.clipboard?.write !== "function" ||
      typeof ClipboardItem === "undefined" ||
      typeof Blob === "undefined"
    ) {
      return false;
    }
    const item = new ClipboardItem({
      [TEXTIQ_NODE_CLIPBOARD_MIME]: new Blob([payload], {
        type: TEXTIQ_NODE_CLIPBOARD_MIME,
      }),
      "text/plain": new Blob([textIqNodePlainTextFallback(nodes)], {
        type: "text/plain",
      }),
    });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

function clipboardImageType(types: readonly string[]): string | null {
  return (
    types.find((type) =>
      Object.prototype.hasOwnProperty.call(CLIPBOARD_IMAGE_EXTENSIONS, type),
    ) ?? null
  );
}

async function readClipboardItemText(
  item: ClipboardItem,
  type: string,
): Promise<string | null> {
  if (!item.types.includes(type)) return null;
  const blob = await item.getType(type);
  return await blob.text();
}

export function clipboardImageBlobToFile(blob: Blob, type: string): File {
  const extension = CLIPBOARD_IMAGE_EXTENSIONS[type] ?? "png";
  return new File([blob], `clipboard-image.${extension}`, {
    type,
    lastModified: 0,
  });
}

export async function readTextIqNodeClipboard(): Promise<TextIqNodeClipboardRead> {
  const result: TextIqNodeClipboardRead = {
    textIqPayload: null,
    image: null,
    html: null,
    plainText: null,
  };
  try {
    /* node:coverage ignore next */
    if (!canReadTextIqNodeClipboard()) return result;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (result.textIqPayload === null) {
        result.textIqPayload = await readClipboardItemText(
          item,
          TEXTIQ_NODE_CLIPBOARD_MIME,
        );
      }
      if (result.image === null) {
        const type = clipboardImageType(item.types);
        if (type) result.image = { blob: await item.getType(type), type };
      }
      if (result.html === null) {
        result.html = await readClipboardItemText(item, "text/html");
      }
      if (result.plainText === null) {
        result.plainText = await readClipboardItemText(item, "text/plain");
      }
    }
  } catch {
    return result;
  }
  return result;
}

export async function readTextIqNodeClipboardPayload(): Promise<string | null> {
  return (await readTextIqNodeClipboard()).textIqPayload;
}
