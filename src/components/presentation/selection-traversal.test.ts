import assert from "node:assert/strict";
import { test } from "node:test";

import type { LayoutBox, SlideChildNode } from "@/lib/presentation/schema";

import {
  adjacentInlineEditableNodeId,
  adjacentNodeId,
  childIdsForGroup,
  findNodeById,
  flattenEditorNodes,
  layoutFramesExcluding,
  nodesInReadingOrder,
  parentGroupIdForNode,
} from "./selection-traversal";

function textNode(
  id: string,
  frame?: LayoutBox["frame"],
  options: { hidden?: boolean; readingOrder?: number } = {},
): SlideChildNode {
  return {
    id,
    type: "text",
    ...(frame ? { layout: { frame, zIndex: 1 } } : {}),
    ...(options.hidden !== undefined ? { hidden: options.hidden } : {}),
    ...(options.readingOrder !== undefined
      ? { accessibility: { readingOrder: options.readingOrder } }
      : {}),
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p`, text: id }] },
  };
}

function shapeNode(id: string, frame: LayoutBox["frame"]): SlideChildNode {
  return {
    id,
    type: "shape",
    layout: { frame, zIndex: 1 },
    style: { ref: "surface.card" },
    content: { shape: "rect" },
  };
}

function imageNode(id: string, frame: LayoutBox["frame"]): SlideChildNode {
  return {
    id,
    type: "image",
    layout: { frame, zIndex: 1 },
    style: { ref: "media.inline" },
    content: { assetId: `${id}-asset` },
  };
}

function groupNode(
  id: string,
  children: SlideChildNode[],
  frame: LayoutBox["frame"] = { x: 0, y: 0, w: 10, h: 10 },
): SlideChildNode {
  return {
    id,
    type: "group",
    component: "custom",
    layout: { frame, zIndex: 1 },
    children,
  };
}

test("findNodeById traverses nested groups", () => {
  const nodes: SlideChildNode[] = [
    textNode("a", { x: 0, y: 0, w: 10, h: 10 }),
    groupNode("g1", [
      groupNode("g2", [textNode("target", { x: 1, y: 1, w: 5, h: 5 })]),
    ]),
  ];

  assert.equal(findNodeById(nodes, "target")?.id, "target");
  assert.equal(findNodeById(nodes, "missing"), undefined);
});

test("flattenEditorNodes preserves group and descendant order", () => {
  const nodes: SlideChildNode[] = [
    textNode("a", { x: 0, y: 0, w: 10, h: 10 }),
    groupNode("g1", [
      textNode("b", { x: 1, y: 1, w: 5, h: 5 }),
      groupNode("g2", [textNode("c", { x: 2, y: 2, w: 5, h: 5 })]),
    ]),
    textNode("d", { x: 3, y: 3, w: 5, h: 5 }),
  ];

  assert.deepEqual(
    flattenEditorNodes(nodes).map((node) => node.id),
    ["a", "g1", "b", "g2", "c", "d"],
  );
});

test("nodesInReadingOrder keeps layouted visible nodes and sorts by reading order then position", () => {
  const nodes: SlideChildNode[] = [
    textNode("layoutless"),
    textNode("hidden", { x: 0, y: 0, w: 10, h: 10 }, { hidden: true }),
    textNode("pos-b", { x: 20, y: 10, w: 10, h: 10 }),
    textNode(
      "ordered-2",
      { x: 100, y: 100, w: 10, h: 10 },
      { readingOrder: 2 },
    ),
    textNode("ordered-1", { x: 50, y: 50, w: 10, h: 10 }, { readingOrder: 1 }),
    textNode("pos-a", { x: 5, y: 30, w: 10, h: 10 }),
  ];

  assert.deepEqual(
    nodesInReadingOrder(nodes).map((node) => node.id),
    ["ordered-1", "ordered-2", "pos-b", "pos-a"],
  );
});

test("adjacentNodeId wraps based on reading-order traversal", () => {
  const nodes: SlideChildNode[] = [
    textNode("n1", { x: 0, y: 0, w: 10, h: 10 }),
    textNode("n2", { x: 20, y: 0, w: 10, h: 10 }),
    textNode("n3", { x: 40, y: 0, w: 10, h: 10 }),
  ];

  assert.equal(adjacentNodeId(nodes, "n2", 1), "n3");
  assert.equal(adjacentNodeId(nodes, "n1", -1), "n3");
  assert.equal(adjacentNodeId(nodes, undefined, -1), "n3");
});

test("adjacentInlineEditableNodeId only traverses text nodes", () => {
  const nodes: SlideChildNode[] = [
    textNode("text", { x: 0, y: 0, w: 10, h: 10 }),
    imageNode("image", { x: 10, y: 0, w: 10, h: 10 }),
    shapeNode("shape", { x: 20, y: 0, w: 10, h: 10 }),
  ];

  assert.equal(adjacentInlineEditableNodeId(nodes, "text", 1), "text");
  assert.equal(adjacentInlineEditableNodeId(nodes, "image", 1), "text");
  assert.equal(adjacentInlineEditableNodeId(nodes, "image", -1), "text");
});

test("parentGroupIdForNode returns direct parent group id", () => {
  const nodes: SlideChildNode[] = [
    groupNode("outer", [
      groupNode("inner", [textNode("leaf", { x: 0, y: 0, w: 5, h: 5 })]),
    ]),
  ];

  assert.equal(parentGroupIdForNode(nodes, "leaf"), "inner");
  assert.equal(parentGroupIdForNode(nodes, "outer"), null);
  assert.equal(parentGroupIdForNode(nodes, "missing"), null);
});

test("childIdsForGroup returns flattened child ids for nested groups", () => {
  const nodes: SlideChildNode[] = [
    groupNode("g1", [
      textNode("a", { x: 0, y: 0, w: 5, h: 5 }),
      groupNode("g2", [textNode("b", { x: 1, y: 1, w: 5, h: 5 })]),
    ]),
  ];

  assert.deepEqual(childIdsForGroup(nodes, "g1"), ["a", "g2", "b"]);
  assert.deepEqual(childIdsForGroup(nodes, "missing"), []);
});

test("layoutFramesExcluding keeps descendant frames when excluding ancestor ids", () => {
  const nodes: SlideChildNode[] = [
    textNode("root", { x: 0, y: 0, w: 5, h: 5 }),
    groupNode("g1", [
      textNode("child-a", { x: 10, y: 10, w: 5, h: 5 }),
      textNode("child-b", { x: 20, y: 20, w: 5, h: 5 }),
      textNode("layoutless"),
    ]),
  ];

  const frames = layoutFramesExcluding(nodes, new Set(["g1", "child-b"]));

  assert.deepEqual(frames, [
    { x: 0, y: 0, w: 5, h: 5 },
    { x: 10, y: 10, w: 5, h: 5 },
  ]);
});
