import type { SlideChildNode } from "@/lib/presentation-vnext/schema";
import {
  serializeTextIqNodePayload,
  textIqNodePlainTextFallback,
  TEXTIQ_NODE_CLIPBOARD_MIME,
} from "@/lib/presentation-vnext/clipboard/node-payload";

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

export async function readTextIqNodeClipboardPayload(): Promise<string | null> {
  try {
    /* node:coverage ignore next */
    if (!canReadTextIqNodeClipboard()) return null;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes(TEXTIQ_NODE_CLIPBOARD_MIME)) continue;
      const blob = await item.getType(TEXTIQ_NODE_CLIPBOARD_MIME);
      return await blob.text();
    }
  } catch {
    return null;
  }
  return null;
}
