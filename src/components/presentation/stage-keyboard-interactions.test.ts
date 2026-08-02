import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LayoutBox, SlideChildNode } from "@/lib/presentation/schema";

import { moveKeyboardConnectorEndpointPresentation } from "./stage-keyboard-interactions";

function shapeNode(
  id: string,
  frame: { x: number; y: number; w: number; h: number },
): SlideChildNode {
  return {
    id,
    type: "shape",
    role: "callout",
    layout: { frame, zIndex: 1 },
    style: { ref: "surface.callout" },
    content: { shape: "rect" },
  };
}

function connectorNode(): Extract<SlideChildNode, { type: "connector" }> & {
  layout: LayoutBox;
} {
  return {
    id: "connector-1",
    type: "connector",
    role: "connector",
    layout: { frame: { x: 30, y: 25, w: 40, h: 1 }, zIndex: 2 },
    style: { ref: "connector.primary" },
    content: {
      from: { kind: "node", nodeId: "source", anchor: "right" },
      to: { kind: "node", nodeId: "target", anchor: "left" },
      routing: "straight",
    },
  };
}

describe("keyboard connector endpoint geometry", () => {
  test("detaches and moves a bound endpoint while preserving the opposite binding", () => {
    const source = shapeNode("source", { x: 10, y: 20, w: 20, h: 10 });
    const target = shapeNode("target", { x: 70, y: 20, w: 20, h: 10 });
    const connector = connectorNode();

    assert.deepEqual(
      moveKeyboardConnectorEndpointPresentation({
        nodes: [source, target, connector],
        connector,
        endpoint: "to",
        delta: { x: 1, y: 0 },
      }),
      {
        frame: { x: 30, y: 25, w: 41, h: 1 },
        from: { kind: "node", nodeId: "source", anchor: "right" },
        to: { kind: "point", point: { x: 100, y: 0 } },
      },
    );
  });

  test("preserves a free opposite endpoint in slide coordinates when the frame changes", () => {
    const source = shapeNode("source", { x: 10, y: 20, w: 20, h: 10 });
    const connector = connectorNode();
    connector.content.to = { kind: "point", point: { x: 100, y: 0 } };
    connector.layout = {
      ...connector.layout,
      frame: { x: 30, y: 25, w: 41, h: 1 },
    };

    assert.deepEqual(
      moveKeyboardConnectorEndpointPresentation({
        nodes: [source, connector],
        connector,
        endpoint: "from",
        delta: { x: 0, y: -5 },
      }),
      {
        frame: { x: 30, y: 20, w: 41, h: 5 },
        from: { kind: "point", point: { x: 0, y: 0 } },
        to: { kind: "point", point: { x: 100, y: 100 } },
      },
    );
  });

  test("clamps free endpoint movement to the slide bounds", () => {
    const connector = connectorNode();
    connector.content.from = { kind: "point", point: { x: 0, y: 0 } };
    connector.content.to = { kind: "point", point: { x: 100, y: 100 } };
    connector.layout = {
      ...connector.layout,
      frame: { x: 0, y: 0, w: 100, h: 100 },
    };

    assert.deepEqual(
      moveKeyboardConnectorEndpointPresentation({
        nodes: [connector],
        connector,
        endpoint: "from",
        delta: { x: -5, y: -5 },
      }),
      {
        frame: { x: 0, y: 0, w: 100, h: 100 },
        from: { kind: "point", point: { x: 0, y: 0 } },
        to: { kind: "point", point: { x: 100, y: 100 } },
      },
    );
  });
});
