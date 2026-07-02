import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConnectorEndpoint, LayoutBox } from "./schema";
import {
  connectorAnchorPoint,
  connectorEndpointFromSlidePoint,
  connectorEndpointToPointFallback,
} from "./connector-geometry";

test("connectorAnchorPoint resolves each anchor on the node frame", () => {
  const frame: LayoutBox["frame"] = { x: 20, y: 30, w: 40, h: 10 };

  assert.deepEqual(connectorAnchorPoint(frame, "top"), { x: 40, y: 30 });
  assert.deepEqual(connectorAnchorPoint(frame, "right"), { x: 60, y: 35 });
  assert.deepEqual(connectorAnchorPoint(frame, "bottom"), { x: 40, y: 40 });
  assert.deepEqual(connectorAnchorPoint(frame, "left"), { x: 20, y: 35 });
  assert.deepEqual(connectorAnchorPoint(frame, "center"), { x: 40, y: 35 });
});

test("connectorEndpointFromSlidePoint converts slide points and clamps to [0,100]", () => {
  const frame: LayoutBox["frame"] = { x: 10, y: 20, w: 40, h: 50 };

  assert.deepEqual(connectorEndpointFromSlidePoint({ x: 30, y: 45 }, frame), {
    kind: "point",
    point: { x: 50, y: 50 },
  });
  assert.deepEqual(connectorEndpointFromSlidePoint({ x: -10, y: 999 }, frame), {
    kind: "point",
    point: { x: 0, y: 100 },
  });
});

test("connectorEndpointFromSlidePoint returns zero on non-positive axis sizes", () => {
  assert.deepEqual(
    connectorEndpointFromSlidePoint(
      { x: 40, y: 70 },
      { x: 20, y: 30, w: 0, h: 20 },
    ),
    { kind: "point", point: { x: 0, y: 100 } },
  );
  assert.deepEqual(
    connectorEndpointFromSlidePoint(
      { x: 40, y: 70 },
      { x: 20, y: 30, w: 20, h: -1 },
    ),
    { kind: "point", point: { x: 100, y: 0 } },
  );
});

test("connectorEndpointToPointFallback converts node endpoints via anchor geometry", () => {
  const connectorFrame: LayoutBox["frame"] = { x: 10, y: 10, w: 40, h: 40 };
  const endpoint: ConnectorEndpoint = {
    kind: "node",
    nodeId: "target-1",
    anchor: "right",
  };

  const converted = connectorEndpointToPointFallback(
    endpoint,
    connectorFrame,
    () => ({ x: 20, y: 20, w: 20, h: 10 }),
  );

  assert.deepEqual(converted, {
    kind: "point",
    point: { x: 75, y: 37.5 },
  });
});

test("connectorEndpointToPointFallback preserves node endpoints for zero-size connectors", () => {
  const endpoint: ConnectorEndpoint = {
    kind: "node",
    nodeId: "target-1",
    anchor: "left",
  };

  const converted = connectorEndpointToPointFallback(
    endpoint,
    { x: 10, y: 10, w: 0, h: 20 },
    () => ({ x: 20, y: 20, w: 20, h: 10 }),
  );

  assert.strictEqual(converted, endpoint);
});
