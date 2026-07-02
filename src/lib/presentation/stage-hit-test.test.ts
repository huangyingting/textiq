import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  LayoutBox,
  SlideChildNode,
  ConnectorNode,
  ShapeNode,
  TextNode,
} from "./schema";
import { hitTestSlideNodes } from "./stage-hit-test";

function frame(x: number, y: number, w: number, h: number): LayoutBox["frame"] {
  return { x, y, w, h };
}

function textNode(
  id: string,
  zIndex: number,
  box: LayoutBox["frame"],
  text = "Revenue",
): TextNode {
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame: box, zIndex },
    style: { ref: "text.body" },
    content: {
      paragraphs: [{ id: `${id}-p`, text }],
    },
  };
}

function rectNode(
  id: string,
  zIndex: number,
  box: LayoutBox["frame"],
): ShapeNode {
  return {
    id,
    type: "shape",
    role: "card",
    layout: { frame: box, zIndex },
    style: { ref: "surface.card" },
    content: { shape: "rect" },
  };
}

function connectorNode(
  id: string,
  zIndex: number,
  box: LayoutBox["frame"],
): ConnectorNode {
  return {
    id,
    type: "connector",
    role: "connector",
    layout: { frame: box, zIndex },
    style: { ref: "connector.primary" },
    content: {
      from: { kind: "point", point: { x: 0, y: 50 } },
      to: { kind: "point", point: { x: 100, y: 50 } },
      routing: "straight",
    },
  };
}

test("hitTestSlideNodes prefers covered text content over large covering shapes", () => {
  const nodes: SlideChildNode[] = [
    textNode("covered-text", 0, frame(10, 40, 80, 20), "Revenue"),
    rectNode("large-cover", 20, frame(0, 0, 100, 100)),
  ];

  const hits = hitTestSlideNodes({ x: 12, y: 50 }, nodes, {
    includeLocked: true,
  });

  assert.equal(hits[0]?.node.id, "covered-text");
  assert.equal(hits[0]?.reason, "text-content");
});

test("hitTestSlideNodes prefers shape edges over covered text", () => {
  const nodes: SlideChildNode[] = [
    textNode("covered-text", 0, frame(10, 40, 80, 20), "Revenue"),
    rectNode("large-cover", 20, frame(10, 30, 80, 40)),
  ];

  const hits = hitTestSlideNodes({ x: 10.5, y: 50 }, nodes, {
    includeLocked: true,
  });

  assert.equal(hits[0]?.node.id, "large-cover");
  assert.equal(hits[0]?.reason, "shape-edge");
});

test("hitTestSlideNodes keeps selected covering nodes sticky", () => {
  const nodes: SlideChildNode[] = [
    textNode("covered-text", 0, frame(10, 40, 80, 20), "Revenue"),
    rectNode("selected-cover", 20, frame(0, 0, 100, 100)),
  ];

  const hits = hitTestSlideNodes({ x: 12, y: 50 }, nodes, {
    includeLocked: true,
    selectedNodeIds: new Set(["selected-cover"]),
  });

  assert.equal(hits[0]?.node.id, "selected-cover");
});

test("hitTestSlideNodes can ignore selected bonus for hover preselection", () => {
  const nodes: SlideChildNode[] = [
    textNode("covered-text", 0, frame(10, 40, 80, 20), "Revenue"),
    rectNode("selected-cover", 20, frame(0, 0, 100, 100)),
  ];

  const hits = hitTestSlideNodes({ x: 12, y: 50 }, nodes, {
    includeLocked: true,
    selectedNodeBonus: false,
    selectedNodeIds: new Set(["selected-cover"]),
  });

  assert.equal(hits[0]?.node.id, "covered-text");
});

test("hitTestSlideNodes hits connector strokes with tolerance", () => {
  const nodes: SlideChildNode[] = [
    rectNode("background", 0, frame(0, 0, 100, 100)),
    connectorNode("connector", 10, frame(10, 45, 80, 10)),
  ];

  assert.equal(
    hitTestSlideNodes({ x: 50, y: 50 }, nodes, { includeLocked: true })[0]?.node
      .id,
    "connector",
  );
  assert.equal(
    hitTestSlideNodes({ x: 50, y: 70 }, nodes, { includeLocked: true })[0]?.node
      .id,
    "background",
  );
});
