import assert from "node:assert/strict";
import { test } from "node:test";

import type { SlideChildNode } from "./schema";
import {
  normalizeSelectionFrame,
  selectNodesInFrame,
} from "./selection-geometry";

function textNode(
  id: string,
  frame: { x: number; y: number; w: number; h: number },
): SlideChildNode {
  return {
    id,
    type: "text",
    layout: { frame, zIndex: 1 },
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p`, text: id }] },
  };
}

test("normalizeSelectionFrame returns positive dimensions from any drag direction", () => {
  assert.deepEqual(
    normalizeSelectionFrame({ x: 80, y: 70 }, { x: 20, y: 10 }),
    { x: 20, y: 10, w: 60, h: 60 },
  );
});

test("selectNodesInFrame returns intersecting node ids", () => {
  const nodes = [
    textNode("a", { x: 10, y: 10, w: 10, h: 10 }),
    textNode("b", { x: 50, y: 50, w: 10, h: 10 }),
  ];

  assert.deepEqual(selectNodesInFrame(nodes, { x: 5, y: 5, w: 20, h: 20 }), [
    "a",
  ]);
});

test("selectNodesInFrame includes nested group children", () => {
  const nodes: SlideChildNode[] = [
    {
      id: "group-1",
      type: "group",
      component: "custom",
      layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 1 },
      children: [textNode("child", { x: 35, y: 35, w: 10, h: 10 })],
    },
  ];

  assert.deepEqual(selectNodesInFrame(nodes, { x: 30, y: 30, w: 20, h: 20 }), [
    "group-1",
    "child",
  ]);
});

test("selectNodesInFrame skips hidden top-level nodes", () => {
  const nodes: SlideChildNode[] = [
    { ...textNode("hidden", { x: 10, y: 10, w: 10, h: 10 }), hidden: true },
    textNode("visible", { x: 12, y: 12, w: 10, h: 10 }),
  ];

  assert.deepEqual(selectNodesInFrame(nodes, { x: 5, y: 5, w: 30, h: 30 }), [
    "visible",
  ]);
});

test("selectNodesInFrame skips hidden group descendants", () => {
  const nodes: SlideChildNode[] = [
    {
      id: "visible-group",
      type: "group",
      component: "custom",
      layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 1 },
      children: [
        {
          ...textNode("hidden-child", { x: 20, y: 20, w: 10, h: 10 }),
          hidden: true,
        },
        textNode("visible-child", { x: 35, y: 35, w: 10, h: 10 }),
        {
          id: "hidden-nested-group",
          type: "group",
          component: "custom",
          hidden: true,
          layout: { frame: { x: 40, y: 40, w: 30, h: 30 }, zIndex: 2 },
          children: [
            textNode("hidden-nested-child", { x: 45, y: 45, w: 10, h: 10 }),
          ],
        },
      ],
    },
    {
      id: "hidden-top-group",
      type: "group",
      component: "custom",
      hidden: true,
      layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 2 },
      children: [
        textNode("hidden-top-group-child", { x: 30, y: 30, w: 10, h: 10 }),
      ],
    },
  ];

  assert.deepEqual(selectNodesInFrame(nodes, { x: 15, y: 15, w: 50, h: 50 }), [
    "visible-group",
    "visible-child",
  ]);
});
