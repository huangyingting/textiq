import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import type { SlideChildNode } from "@/lib/presentation-vnext/schema";
import {
  parseTextIqNodePayload,
  TEXTIQ_NODE_CLIPBOARD_MIME,
} from "@/lib/presentation-vnext/clipboard/node-payload";
import {
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

    assert.equal(await writeTextIqNodesToClipboard([node]), true);
    assert.equal(written.length, 1);

    const item = written[0];
    assert.deepEqual(
      item.types.sort(),
      [TEXTIQ_NODE_CLIPBOARD_MIME, "text/plain"].sort(),
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
  });

  test("returns false when clipboard writes are unsupported or fail", async () => {
    setNavigator({ clipboard: {} });
    globalThis.ClipboardItem =
      TestClipboardItem as unknown as typeof ClipboardItem;
    assert.equal(await writeTextIqNodesToClipboard([node]), false);

    setNavigator({
      clipboard: {
        write: async () => {
          throw new Error("denied");
        },
      },
    });
    assert.equal(await writeTextIqNodesToClipboard([node]), false);
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
  });
});
