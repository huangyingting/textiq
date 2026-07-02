import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildShapeNode,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";

import { layeredZIndexForNodeType, nextLayeredZIndex } from "./layer-bands";

test("layeredZIndexForNodeType gives text the highest default content band", () => {
  const shape = layeredZIndexForNodeType("shape", 900);
  const image = layeredZIndexForNodeType("image", 1);
  const visual = layeredZIndexForNodeType("visual", 1);
  const table = layeredZIndexForNodeType("table", 1);
  const group = layeredZIndexForNodeType("group", 1);
  const connector = layeredZIndexForNodeType("connector", 1);
  const text = layeredZIndexForNodeType("text", 1);

  assert.ok(shape < image);
  assert.ok(shape < visual);
  assert.ok(image < table);
  assert.ok(table < group);
  assert.ok(group < connector);
  assert.ok(connector < text);
});

test("nextLayeredZIndex allocates inside the requested type band", () => {
  const slide = buildSlide("content", [
    buildShapeNode({
      id: "shape-a",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1005 },
    }),
    buildTextNode({
      id: "text-a",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 4007 },
    }),
  ]);

  assert.equal(nextLayeredZIndex(slide, "shape"), 1006);
  assert.equal(nextLayeredZIndex(slide, "text"), 4008);
  assert.equal(nextLayeredZIndex(slide, "image"), 2001);
});
