import type { SlideChildNode } from "@/lib/presentation-vnext/schema";
import {
  buildTextIqNodeCopyOutPayload,
  TEXTIQ_NODE_CLIPBOARD_MIME,
} from "@/lib/presentation-vnext/clipboard/node-payload";

export type TextIqNodeClipboardState =
  | "available"
  | "unsupported"
  | "permission-denied"
  | "copy-failed"
  | "paste-failed";

export type TextIqNodeClipboardImage = {
  blob: Blob;
  type: string;
};

export type TextIqNodeClipboardWriteResult = {
  ok: boolean;
  state: TextIqNodeClipboardState;
  imageIncluded: boolean;
  htmlIncluded: boolean;
  plainTextIncluded: boolean;
  textIqPayloadIncluded: boolean;
  plainTextFallbackWritten: boolean;
};

export type TextIqNodeClipboardRead = {
  state: Exclude<TextIqNodeClipboardState, "copy-failed">;
  textIqPayload: string | null;
  image: TextIqNodeClipboardImage | null;
  html: string | null;
  plainText: string | null;
};

export type TextIqNodeClipboardWriteOptions = {
  renderPng?: () => Promise<Blob | null>;
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

function clipboardUnsupported(): boolean {
  /* node:coverage ignore next */
  return typeof navigator === "undefined" || navigator.clipboard === undefined;
}

function canWriteClipboardItems(): boolean {
  /* node:coverage ignore next */
  return (
    !clipboardUnsupported() &&
    typeof navigator.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined" &&
    typeof Blob !== "undefined"
  );
}

async function clipboardPermissionState(
  name: "clipboard-read" | "clipboard-write",
): Promise<PermissionState | "prompt"> {
  try {
    /* node:coverage ignore next */
    if (typeof navigator === "undefined" || !navigator.permissions?.query)
      return "prompt";
    const status = await navigator.permissions.query({
      name: name as PermissionName,
    });
    return status.state;
  } catch {
    return "prompt";
  }
}

function writeResult(
  state: TextIqNodeClipboardWriteResult["state"],
  included: {
    image?: boolean;
    html?: boolean;
    plainText?: boolean;
    textIqPayload?: boolean;
    plainTextFallback?: boolean;
  } = {},
): TextIqNodeClipboardWriteResult {
  return {
    ok: state === "available",
    state,
    imageIncluded: included.image ?? false,
    htmlIncluded: included.html ?? false,
    plainTextIncluded: included.plainText ?? false,
    textIqPayloadIncluded: included.textIqPayload ?? false,
    plainTextFallbackWritten: included.plainTextFallback ?? false,
  };
}

export function buildTextIqNodeClipboardItemData(
  nodes: readonly SlideChildNode[],
  imageBlob?: Blob | null,
): Record<string, Blob> {
  const payload = buildTextIqNodeCopyOutPayload(nodes);
  return {
    [TEXTIQ_NODE_CLIPBOARD_MIME]: new Blob([payload.textIqPayload], {
      type: TEXTIQ_NODE_CLIPBOARD_MIME,
    }),
    "text/html": new Blob([payload.html], { type: "text/html" }),
    "text/plain": new Blob([payload.plainText], { type: "text/plain" }),
    ...(imageBlob
      ? { "image/png": new Blob([imageBlob], { type: "image/png" }) }
      : {}),
  };
}

async function writeClipboardItem(
  data: Record<string, Blob>,
): Promise<TextIqNodeClipboardWriteResult> {
  const item = new ClipboardItem(data);
  await navigator.clipboard.write([item]);
  return writeResult("available", {
    image: data["image/png"] !== undefined,
    html: data["text/html"] !== undefined,
    plainText: data["text/plain"] !== undefined,
    textIqPayload: data[TEXTIQ_NODE_CLIPBOARD_MIME] !== undefined,
  });
}

export async function writeTextIqNodesToClipboard(
  nodes: readonly SlideChildNode[],
  options: TextIqNodeClipboardWriteOptions = {},
): Promise<TextIqNodeClipboardWriteResult> {
  let imageBlob: Blob | null = null;
  if (options.renderPng) {
    try {
      imageBlob = await options.renderPng();
    } catch {
      imageBlob = null;
    }
  }

  try {
    if (!canWriteClipboardItems()) return writeResult("unsupported");
    if ((await clipboardPermissionState("clipboard-write")) === "denied") {
      return writeResult("permission-denied");
    }

    const data = buildTextIqNodeClipboardItemData(nodes, imageBlob);
    try {
      return await writeClipboardItem(data);
    } catch {
      if (imageBlob) {
        try {
          return await writeClipboardItem(
            buildTextIqNodeClipboardItemData(nodes, null),
          );
        } catch {
          // Fall through to plain-text fallback below.
        }
      }
      try {
        const { plainText } = buildTextIqNodeCopyOutPayload(nodes);
        if (typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(plainText);
          return writeResult("copy-failed", {
            plainText: true,
            plainTextFallback: true,
          });
        }
      } catch {
        return writeResult("copy-failed");
      }
      return writeResult("copy-failed");
    }
  } catch {
    return writeResult("copy-failed");
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
    state: "available",
    textIqPayload: null,
    image: null,
    html: null,
    plainText: null,
  };
  try {
    /* node:coverage ignore next */
    if (!canReadTextIqNodeClipboard())
      return { ...result, state: "unsupported" };
    if ((await clipboardPermissionState("clipboard-read")) === "denied") {
      return { ...result, state: "permission-denied" };
    }
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
    return { ...result, state: "paste-failed" };
  }
  return result;
}

export async function readTextIqNodeClipboardPayload(): Promise<string | null> {
  return (await readTextIqNodeClipboard()).textIqPayload;
}
