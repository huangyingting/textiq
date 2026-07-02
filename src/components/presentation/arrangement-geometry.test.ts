import assert from "node:assert/strict";
import { test } from "node:test";

import type { LayoutBox, SlideChildNode } from "@/lib/presentation/schema";
import {
  buildAlignSelectionPatches,
  buildDistributeSelectionPatches,
  buildLayerReorderPatches,
  buildMatchSizeSelectionPatches,
  buildZOrderSelectionOperations,
  collectSelectedLayoutEntries,
} from "./arrangement-geometry";

function textNode(
  id: string,
  frame?: LayoutBox["frame"],
  options: { zIndex?: number; locked?: boolean; hidden?: boolean } = {},
): SlideChildNode {
  return {
    id,
    type: "text",
    ...(frame ? { layout: { frame, zIndex: options.zIndex ?? 1 } } : {}),
    ...(options.locked !== undefined ? { locked: options.locked } : {}),
    ...(options.hidden !== undefined ? { hidden: options.hidden } : {}),
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p1`, text: id }] },
  };
}

function groupNode(
  id: string,
  zIndex: number,
  children: SlideChildNode[],
): SlideChildNode {
  return {
    id,
    type: "group",
    component: "custom",
    layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex },
    children,
  };
}

function patchFrame(
  patches: Map<string, Partial<LayoutBox>>,
  id: string,
): LayoutBox["frame"] {
  const frame = patches.get(id)?.frame;
  assert.ok(frame, `expected frame patch for ${id}`);
  return frame;
}

test("collectSelectedLayoutEntries preserves current hidden/locked/layoutless filtering and group traversal", () => {
  const nodes: SlideChildNode[] = [
    textNode("visible", { x: 10, y: 10, w: 10, h: 10 }, { zIndex: 1 }),
    textNode("hidden", { x: 20, y: 20, w: 10, h: 10 }, { hidden: true }),
    textNode("locked", { x: 30, y: 30, w: 10, h: 10 }, { locked: true }),
    textNode("layoutless"),
    groupNode("group", 6, [
      textNode("group-child", { x: 40, y: 40, w: 10, h: 10 }, { zIndex: 7 }),
    ]),
  ];

  const entries = collectSelectedLayoutEntries(nodes, [
    "hidden",
    "locked",
    "layoutless",
    "group-child",
    "visible",
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["hidden", "group-child", "visible"],
  );
});

test("buildAlignSelectionPatches aligns left/center/right/top/middle/bottom", () => {
  const nodes: SlideChildNode[] = [
    textNode("a", { x: 10, y: 20, w: 10, h: 10 }),
    textNode("b", { x: 40, y: 40, w: 20, h: 20 }),
    textNode("c", { x: 70, y: 10, w: 30, h: 30 }),
  ];
  const entries = collectSelectedLayoutEntries(nodes, ["a", "b", "c"]);

  const alignLeft = buildAlignSelectionPatches(entries, "left");
  assert.equal(patchFrame(alignLeft, "a").x, 10);
  assert.equal(patchFrame(alignLeft, "b").x, 10);
  assert.equal(patchFrame(alignLeft, "c").x, 10);

  const alignCenter = buildAlignSelectionPatches(entries, "center");
  assert.equal(patchFrame(alignCenter, "a").x, 50);
  assert.equal(patchFrame(alignCenter, "b").x, 45);
  assert.equal(patchFrame(alignCenter, "c").x, 40);

  const alignRight = buildAlignSelectionPatches(entries, "right");
  assert.equal(patchFrame(alignRight, "a").x, 90);
  assert.equal(patchFrame(alignRight, "b").x, 80);
  assert.equal(patchFrame(alignRight, "c").x, 70);

  const alignTop = buildAlignSelectionPatches(entries, "top");
  assert.equal(patchFrame(alignTop, "a").y, 10);
  assert.equal(patchFrame(alignTop, "b").y, 10);
  assert.equal(patchFrame(alignTop, "c").y, 10);

  const alignMiddle = buildAlignSelectionPatches(entries, "middle");
  assert.equal(patchFrame(alignMiddle, "a").y, 30);
  assert.equal(patchFrame(alignMiddle, "b").y, 25);
  assert.equal(patchFrame(alignMiddle, "c").y, 20);

  const alignBottom = buildAlignSelectionPatches(entries, "bottom");
  assert.equal(patchFrame(alignBottom, "a").y, 50);
  assert.equal(patchFrame(alignBottom, "b").y, 40);
  assert.equal(patchFrame(alignBottom, "c").y, 30);
});

test("buildDistributeSelectionPatches distributes horizontal and vertical gaps", () => {
  const nodes: SlideChildNode[] = [
    textNode("a", { x: 0, y: 0, w: 10, h: 10 }),
    textNode("b", { x: 30, y: 30, w: 20, h: 20 }),
    textNode("c", { x: 80, y: 80, w: 10, h: 10 }),
  ];
  const entries = collectSelectedLayoutEntries(nodes, ["a", "b", "c"]);

  const horizontal = buildDistributeSelectionPatches(entries, "horizontal");
  assert.equal(patchFrame(horizontal, "a").x, 0);
  assert.equal(patchFrame(horizontal, "b").x, 35);
  assert.equal(patchFrame(horizontal, "c").x, 80);

  const vertical = buildDistributeSelectionPatches(entries, "vertical");
  assert.equal(patchFrame(vertical, "a").y, 0);
  assert.equal(patchFrame(vertical, "b").y, 35);
  assert.equal(patchFrame(vertical, "c").y, 80);
});

test("buildMatchSizeSelectionPatches supports width, height, and both modes", () => {
  const nodes: SlideChildNode[] = [
    textNode("a", { x: 0, y: 0, w: 10, h: 20 }),
    textNode("b", { x: 20, y: 0, w: 30, h: 40 }),
    textNode("c", { x: 60, y: 0, w: 50, h: 10 }),
  ];
  const entries = collectSelectedLayoutEntries(nodes, ["a", "b", "c"]);

  const width = buildMatchSizeSelectionPatches(entries, "width");
  assert.equal(patchFrame(width, "b").w, 10);
  assert.equal(patchFrame(width, "b").h, 40);
  assert.equal(patchFrame(width, "c").w, 10);
  assert.equal(patchFrame(width, "c").h, 10);

  const height = buildMatchSizeSelectionPatches(entries, "height");
  assert.equal(patchFrame(height, "b").w, 30);
  assert.equal(patchFrame(height, "b").h, 20);
  assert.equal(patchFrame(height, "c").w, 50);
  assert.equal(patchFrame(height, "c").h, 20);

  const both = buildMatchSizeSelectionPatches(entries, "both");
  assert.equal(patchFrame(both, "b").w, 10);
  assert.equal(patchFrame(both, "b").h, 20);
  assert.equal(patchFrame(both, "c").w, 10);
  assert.equal(patchFrame(both, "c").h, 20);
});

test("buildLayerReorderPatches flattens groups and reassigns z-indexes", () => {
  const nodes: SlideChildNode[] = [
    textNode("a", { x: 0, y: 0, w: 10, h: 10 }, { zIndex: 1 }),
    textNode("b", { x: 0, y: 0, w: 10, h: 10 }, { zIndex: 2 }),
    groupNode("group", 5, [
      textNode("group-child", { x: 0, y: 0, w: 10, h: 10 }, { zIndex: 3 }),
    ]),
  ];

  const patches = buildLayerReorderPatches(nodes, "b", 0);
  assert.equal(patches.get("b")?.zIndex, 4);
  assert.equal(patches.get("group")?.zIndex, 3);
  assert.equal(patches.get("group-child")?.zIndex, 2);
  assert.equal(patches.get("a")?.zIndex, 1);
});

test("buildZOrderSelectionOperations computes forward/backward/front/back moves", () => {
  const nodes: SlideChildNode[] = [
    textNode("a", { x: 0, y: 0, w: 10, h: 10 }, { zIndex: 4 }),
    textNode("b", { x: 0, y: 0, w: 10, h: 10 }, { zIndex: 10 }),
    groupNode("group", 7, [
      textNode("group-child", { x: 0, y: 0, w: 10, h: 10 }, { zIndex: 2 }),
    ]),
  ];

  assert.deepEqual(
    buildZOrderSelectionOperations(nodes, ["a", "group-child"], "forward"),
    [
      { id: "a", zIndex: 5 },
      { id: "group-child", zIndex: 3 },
    ],
  );

  assert.deepEqual(
    buildZOrderSelectionOperations(nodes, ["a", "group-child"], "backward"),
    [
      { id: "a", zIndex: 3 },
      { id: "group-child", zIndex: 1 },
    ],
  );

  assert.deepEqual(
    buildZOrderSelectionOperations(nodes, ["a", "group-child"], "front"),
    [
      { id: "a", zIndex: 11 },
      { id: "group-child", zIndex: 12 },
    ],
  );

  assert.deepEqual(
    buildZOrderSelectionOperations(nodes, ["a", "group-child"], "back"),
    [
      { id: "a", zIndex: 3 },
      { id: "group-child", zIndex: 2 },
    ],
  );
});

test("buildZOrderSelectionOperations ignores missing z-index values when computing front/back bounds", () => {
  const nodes: SlideChildNode[] = [
    textNode("layoutless"),
    textNode("also-layoutless"),
  ];

  assert.deepEqual(
    buildZOrderSelectionOperations(nodes, ["layoutless", "missing"], "front"),
    [
      { id: "layoutless", zIndex: 1 },
      { id: "missing", zIndex: 2 },
    ],
  );

  assert.deepEqual(
    buildZOrderSelectionOperations(nodes, ["layoutless", "missing"], "back"),
    [
      { id: "layoutless", zIndex: -1 },
      { id: "missing", zIndex: -2 },
    ],
  );
});
