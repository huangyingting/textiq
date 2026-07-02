import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import type { SlideChildNode } from "@/lib/presentation-vnext/schema";
import {
  parseTextIqNodePayload,
  TEXTIQ_NODE_CLIPBOARD_MIME,
} from "@/lib/presentation-vnext/clipboard/node-payload";
import {
  buildTextIqNodeClipboardItemData,
  canReadTextIqNodeClipboard,
  clipboardImageBlobToFile,
  readTextIqNodeClipboard,
  readTextIqNodeClipboardPayload,
  writeTextIqNodesToClipboard,
} from "./node-clipboard";

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
const originalClipboardItem = globalThis.ClipboardItem;

const node: SlideChildNode = {
  id: "text-1",
  type: "text",
  content: { paragraphs: [{ id: "paragraph-1", text: "Copied text" }] },
};

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
}

class TestClipboardItem {
  readonly data: Record<string, Blob>;
  readonly types: string[];

  constructor(data: Record<string, Blob>) {
    this.data = data;
    this.types = Object.keys(data);
  }

  async getType(type: string): Promise<Blob> {
    const blob = this.data[type];
    if (!blob) throw new Error(`Missing ${type}`);
    return blob;
  }
}

describe("TextIQ browser node clipboard helpers", () => {
  afterEach(() => {
    if (originalNavigator)
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    globalThis.ClipboardItem = originalClipboardItem;
  });

  test("writes TextIQ and plain-text clipboard representations", async () => {
    let written: TestClipboardItem[] = [];
    setNavigator({
      clipboard: {
        write: async (items: TestClipboardItem[]) => {
          written = items;
        },
      },
    });
    globalThis.ClipboardItem =
      TestClipboardItem as unknown as typeof ClipboardItem;

    const png = new Blob(["png"], { type: "image/png" });
    const result = await writeTextIqNodesToClipboard([node], {
      renderPng: async () => png,
    });
    assert.equal(result.ok, true);
    assert.equal(result.imageIncluded, true);
    assert.equal(result.htmlIncluded, true);
    assert.equal(result.plainTextIncluded, true);
    assert.equal(result.textIqPayloadIncluded, true);
    assert.equal(written.length, 1);

    const item = written[0];
    assert.deepEqual(
      item.types.sort(),
      [
        TEXTIQ_NODE_CLIPBOARD_MIME,
        "image/png",
        "text/html",
        "text/plain",
      ].sort(),
    );
    const payload = await item
      .getType(TEXTIQ_NODE_CLIPBOARD_MIME)
      .then((blob) => blob.text());
    const parsed = parseTextIqNodePayload(payload);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok ? parsed.nodes : [], [node]);
    assert.equal(
      await item.getType("text/plain").then((blob) => blob.text()),
      "1 TextIQ node\nCopied text",
    );
    assert.match(
      await item.getType("text/html").then((blob) => blob.text()),
      /Copied text/,
    );
    assert.equal(
      await item.getType("image/png").then((blob) => blob.text()),
      "png",
    );
  });

  test("assembles copy-out clipboard data with PNG, HTML, text, and TextIQ payload", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const data = buildTextIqNodeClipboardItemData([node], png);

    assert.deepEqual(
      Object.keys(data).sort(),
      [
        TEXTIQ_NODE_CLIPBOARD_MIME,
        "image/png",
        "text/html",
        "text/plain",
      ].sort(),
    );
    assert.equal(await data["image/png"]?.text(), "png");
    assert.match(await data["text/html"]?.text(), /Copied text/);
    assert.equal(
      await data["text/plain"]?.text(),
      "1 TextIQ node\nCopied text",
    );
  });

  test("returns failure states when clipboard writes are unsupported, denied, or fail", async () => {
    setNavigator({ clipboard: {} });
    globalThis.ClipboardItem =
      TestClipboardItem as unknown as typeof ClipboardItem;
    assert.deepEqual(await writeTextIqNodesToClipboard([node]), {
      ok: false,
      state: "unsupported",
      imageIncluded: false,
      htmlIncluded: false,
      plainTextIncluded: false,
      textIqPayloadIncluded: false,
      plainTextFallbackWritten: false,
    });

    setNavigator({
      clipboard: {
        write: async () => undefined,
      },
      permissions: {
        query: async () => ({ state: "denied" }),
      },
    });
    assert.equal(
      (await writeTextIqNodesToClipboard([node])).state,
      "permission-denied",
    );

    setNavigator({
      clipboard: {
        write: async () => {
          throw new Error("denied");
        },
      },
    });
    assert.equal(
      (await writeTextIqNodesToClipboard([node])).state,
      "copy-failed",
    );
  });

  test("falls back to non-image formats and then plain text when rich writes fail", async () => {
    let writeCalls = 0;
    let fallbackText = "";
    setNavigator({
      clipboard: {
        write: async (items: TestClipboardItem[]) => {
          writeCalls += 1;
          if (items[0]?.types.includes("image/png")) throw new Error("image");
        },
        writeText: async (text: string) => {
          fallbackText = text;
        },
      },
    });
    globalThis.ClipboardItem =
      TestClipboardItem as unknown as typeof ClipboardItem;

    const retry = await writeTextIqNodesToClipboard([node], {
      renderPng: async () => new Blob(["png"], { type: "image/png" }),
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.imageIncluded, false);
    assert.equal(writeCalls, 2);

    setNavigator({
      clipboard: {
        write: async () => {
          throw new Error("rich");
        },
        writeText: async (text: string) => {
          fallbackText = text;
        },
      },
    });
    const plainTextOnly = await writeTextIqNodesToClipboard([node]);
    assert.equal(plainTextOnly.state, "copy-failed");
    assert.equal(plainTextOnly.plainTextFallbackWritten, true);
    assert.equal(fallbackText, "1 TextIQ node\nCopied text");
  });

  test("reads the first TextIQ payload from clipboard items", async () => {
    const item = new TestClipboardItem({
      [TEXTIQ_NODE_CLIPBOARD_MIME]: new Blob(["payload"], {
        type: TEXTIQ_NODE_CLIPBOARD_MIME,
      }),
    });
    setNavigator({
      clipboard: {
        read: async () => [
          new TestClipboardItem({ "text/plain": new Blob(["ignored"]) }),
          item,
        ],
      },
    });

    assert.equal(canReadTextIqNodeClipboard(), true);
    assert.equal(await readTextIqNodeClipboardPayload(), "payload");
  });

  test("reads TextIQ, image, HTML, and plain text clipboard representations", async () => {
    const imageBlob = new Blob(["png"], { type: "image/png" });
    setNavigator({
      clipboard: {
        read: async () => [
          new TestClipboardItem({ "image/png": imageBlob }),
          new TestClipboardItem({
            "text/html": new Blob(["<p>Hello</p>"], { type: "text/html" }),
            "text/plain": new Blob(["Hello"], { type: "text/plain" }),
          }),
          new TestClipboardItem({
            [TEXTIQ_NODE_CLIPBOARD_MIME]: new Blob(["payload"], {
              type: TEXTIQ_NODE_CLIPBOARD_MIME,
            }),
          }),
        ],
      },
    });

    const read = await readTextIqNodeClipboard();
    assert.equal(read.textIqPayload, "payload");
    assert.equal(read.image?.blob, imageBlob);
    assert.equal(read.image?.type, "image/png");
    assert.equal(read.html, "<p>Hello</p>");
    assert.equal(read.plainText, "Hello");

    const file = clipboardImageBlobToFile(imageBlob, "image/png");
    assert.equal(file.name, "clipboard-image.png");
    assert.equal(file.type, "image/png");
    assert.equal(file.size, imageBlob.size);
  });

  test("falls back to null when reads are unsupported, absent, or denied", async () => {
    setNavigator({ clipboard: {} });
    assert.equal(canReadTextIqNodeClipboard(), false);
    assert.equal(await readTextIqNodeClipboardPayload(), null);
    assert.equal((await readTextIqNodeClipboard()).state, "unsupported");

    setNavigator({
      clipboard: { read: async () => [] },
      permissions: {
        query: async () => ({ state: "denied" }),
      },
    });
    assert.equal((await readTextIqNodeClipboard()).state, "permission-denied");

    setNavigator({
      clipboard: {
        read: async () => [
          new TestClipboardItem({ "text/plain": new Blob(["plain"]) }),
        ],
      },
    });
    assert.equal(await readTextIqNodeClipboardPayload(), null);

    setNavigator({
      clipboard: {
        read: async () => {
          throw new Error("denied");
        },
      },
    });
    assert.equal(await readTextIqNodeClipboardPayload(), null);
    assert.equal((await readTextIqNodeClipboard()).state, "paste-failed");
  });
});
