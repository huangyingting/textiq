import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Window } from "happy-dom";

import {
  arrayBufferToDataUrl,
  dataUrlToBlob,
  inlineImageSources,
  selectedNodeBounds,
} from "./raster-browser-export";
import type { ResolvedRenderNode } from "./render-tree";

function renderNode(
  id: string,
  frame: { x: number; y: number; w: number; h: number },
  children: ResolvedRenderNode[] = [],
): ResolvedRenderNode {
  return { id, layout: { frame }, children } as unknown as ResolvedRenderNode;
}

async function withHappyDom(
  run: (window: Window) => Promise<void>,
): Promise<void> {
  const window = new Window({ url: "https://textiq.test/slides" });
  const savedFetch = globalThis.fetch;
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: window.document,
  });
  try {
    await run(window);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedDocument) {
      Object.defineProperty(globalThis, "document", savedDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    window.close();
  }
}

describe("raster browser export pure helpers", () => {
  test("computes clamped bounds for selected nested render nodes", () => {
    const bounds = selectedNodeBounds(
      [
        renderNode("outside", { x: 10, y: 10, w: 5, h: 5 }),
        renderNode("group", { x: 0, y: 0, w: 100, h: 100 }, [
          renderNode("a", { x: -5, y: 20, w: 15, h: 10 }),
          renderNode("b", { x: 90, y: 95, w: 20, h: 20 }),
        ]),
      ],
      new Set(["a", "b"]),
    );

    assert.deepEqual(bounds, { x: 0, y: 20, w: 100, h: 80 });
    assert.equal(selectedNodeBounds([], new Set(["missing"])), null);
  });

  test("converts data URLs to typed blobs", async () => {
    const blob = dataUrlToBlob("data:text/plain;base64,SGVsbG8=");

    assert.equal(blob.type, "text/plain");
    assert.equal(await blob.text(), "Hello");

    const fallback = dataUrlToBlob("data:;base64,");
    assert.equal(fallback.type, "image/png");
    assert.equal(await fallback.text(), "");
  });

  test("arrayBufferToDataUrl encodes buffer as a base64 data URI", () => {
    const buffer = new TextEncoder().encode("Hello").buffer as ArrayBuffer;
    const dataUrl = arrayBufferToDataUrl(buffer, "text/plain");
    assert.equal(dataUrl, "data:text/plain;base64,SGVsbG8=");
  });

  test("arrayBufferToDataUrl round-trips through dataUrlToBlob", async () => {
    const original = "TextIQ export";
    const buffer = new TextEncoder().encode(original).buffer as ArrayBuffer;
    const dataUrl = arrayBufferToDataUrl(buffer, "text/plain");
    const blob = dataUrlToBlob(dataUrl);
    assert.equal(blob.type, "text/plain");
    assert.equal(await blob.text(), original);
  });
});

describe("inlineImageSources", () => {
  test("replaces non-data img src with fetched data URI", async () => {
    await withHappyDom(async (window) => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      globalThis.fetch = async () =>
        ({
          blob: async () => new Blob([pngBytes], { type: "image/png" }),
        }) as unknown as Response;

      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const img = window.document.createElement("img");
      img.setAttribute("src", "/api/slide-assets/x");
      container.appendChild(img);

      await inlineImageSources(container as unknown as Element);

      const expected = arrayBufferToDataUrl(
        pngBytes.buffer as ArrayBuffer,
        "image/png",
      );
      assert.equal(img.getAttribute("src"), expected);
    });
  });

  test("leaves already-data: img src unchanged", async () => {
    await withHappyDom(async (window) => {
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        return {} as Response;
      };

      const dataUri = "data:image/png;base64,iVBORw0KGgo=";
      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const img = window.document.createElement("img");
      img.setAttribute("src", dataUri);
      container.appendChild(img);

      await inlineImageSources(container as unknown as Element);

      assert.equal(img.getAttribute("src"), dataUri);
      assert.equal(fetchCalled, false);
    });
  });

  test("leaves img src unchanged on fetch failure", async () => {
    await withHappyDom(async (window) => {
      globalThis.fetch = async () => {
        throw new Error("network error");
      };

      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const img = window.document.createElement("img");
      img.setAttribute("src", "/api/slide-assets/fail");
      container.appendChild(img);

      await assert.doesNotReject(() =>
        inlineImageSources(container as unknown as Element),
      );

      assert.equal(img.getAttribute("src"), "/api/slide-assets/fail");
    });
  });
});
