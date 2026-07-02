import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dataUrlToBlob, selectedNodeBounds } from "./raster-browser-export";
import type { ResolvedRenderNode } from "./render-tree";

function renderNode(
  id: string,
  frame: { x: number; y: number; w: number; h: number },
  children: ResolvedRenderNode[] = [],
): ResolvedRenderNode {
  return { id, layout: { frame }, children } as unknown as ResolvedRenderNode;
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
});
