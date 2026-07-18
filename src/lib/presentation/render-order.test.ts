import assert from "node:assert/strict";
import { test } from "node:test";

import {
  effectiveVisualZIndex,
  flattenNodesInRenderOrder,
  orderSiblingsByVisualOrder,
} from "./render-order";

type Node = {
  id: string;
  hidden?: boolean;
  layout?: { zIndex?: number };
  children?: Node[];
};

test("orderSiblingsByVisualOrder sorts by effective z-index with stable source ties", () => {
  const nodes: Node[] = [
    { id: "high-first", layout: { zIndex: 20 } },
    { id: "low", layout: { zIndex: -5 } },
    { id: "high-later", layout: { zIndex: 20 } },
  ];

  assert.deepEqual(
    orderSiblingsByVisualOrder(nodes).map((node) => node.id),
    ["low", "high-first", "high-later"],
  );
});

test("effective visual z-index falls back invalid and missing values to stable zero", () => {
  const nodes: Node[] = [
    { id: "positive", layout: { zIndex: 20 } },
    { id: "missing", layout: {} },
    { id: "nan", layout: { zIndex: Number.NaN } },
    { id: "positive-infinity", layout: { zIndex: Number.POSITIVE_INFINITY } },
    { id: "negative-infinity", layout: { zIndex: Number.NEGATIVE_INFINITY } },
    { id: "zero", layout: { zIndex: 0 } },
    { id: "negative", layout: { zIndex: -5 } },
  ];

  assert.deepEqual(nodes.map(effectiveVisualZIndex), [20, 0, 0, 0, 0, 0, -5]);
  assert.deepEqual(
    orderSiblingsByVisualOrder(nodes).map((node) => node.id),
    [
      "negative",
      "missing",
      "nan",
      "positive-infinity",
      "negative-infinity",
      "zero",
      "positive",
    ],
  );
});

test("visual traversal sorts within each stacking context and prunes hidden subtrees", () => {
  const nodes: Node[] = [
    {
      id: "front-parent",
      layout: { zIndex: 20 },
      children: [
        { id: "front-child-high", layout: { zIndex: 1000 } },
        { id: "front-child-low", layout: { zIndex: -1000 } },
      ],
    },
    {
      id: "hidden-back-parent",
      hidden: true,
      layout: { zIndex: 10 },
      children: [{ id: "hidden-child", layout: { zIndex: 5000 } }],
    },
  ];

  assert.deepEqual(
    flattenNodesInRenderOrder(nodes, (node) => node.children, {
      mode: "visual",
      isHidden: (node) => node.hidden === true,
    }).map((node) => node.id),
    ["front-parent", "front-child-low", "front-child-high"],
  );
});

test("management traversal preserves canonical order and hidden descendants", () => {
  const nodes: Node[] = [
    { id: "later-visual", layout: { zIndex: 20 } },
    {
      id: "hidden",
      hidden: true,
      layout: { zIndex: -20 },
      children: [{ id: "managed-child", layout: { zIndex: 0 } }],
    },
  ];

  assert.deepEqual(
    flattenNodesInRenderOrder(nodes, (node) => node.children, {
      mode: "management",
    }).map((node) => node.id),
    ["hidden", "managed-child", "later-visual"],
  );
});
