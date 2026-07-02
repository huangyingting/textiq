import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SlideChildNode } from "@/lib/presentation/schema";

import {
  connectorEndpointsEqual,
  nearestConnectorAnchor,
} from "./stage-connector-interactions";

const targetNode: SlideChildNode = {
  id: "target",
  type: "shape",
  layout: { frame: { x: 20, y: 20, w: 20, h: 20 }, zIndex: 1 },
  style: { ref: "surface.card" },
  content: { shape: "rect" },
};

const ignoredConnector: SlideChildNode = {
  id: "connector",
  type: "connector",
  layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 2 },
  style: { ref: "connector.primary" },
  content: {
    from: { kind: "point", point: { x: 0, y: 0 } },
    to: { kind: "point", point: { x: 100, y: 100 } },
    routing: "straight",
  },
};

describe("stage connector interactions", () => {
  test("compares connector endpoints by kind and payload", () => {
    assert.equal(
      connectorEndpointsEqual(
        { kind: "node", nodeId: "a", anchor: "left" },
        { kind: "node", nodeId: "a", anchor: "left" },
      ),
      true,
    );
    assert.equal(
      connectorEndpointsEqual(
        { kind: "node", nodeId: "a", anchor: "left" },
        { kind: "node", nodeId: "a", anchor: "right" },
      ),
      false,
    );
    assert.equal(
      connectorEndpointsEqual(
        { kind: "point", point: { x: 10, y: 20 } },
        { kind: "point", point: { x: 10, y: 20 } },
      ),
      true,
    );
  });

  test("finds nearest non-connector anchor inside the threshold", () => {
    assert.deepEqual(
      nearestConnectorAnchor(
        [targetNode, ignoredConnector],
        { x: 40, y: 30 },
        "moving",
      ),
      { kind: "node", nodeId: "target", anchor: "right" },
    );
    assert.equal(
      nearestConnectorAnchor([targetNode], { x: 40, y: 30 }, "target"),
      null,
    );
    assert.equal(
      nearestConnectorAnchor([targetNode], { x: 70, y: 70 }, "moving"),
      null,
    );
  });
});
