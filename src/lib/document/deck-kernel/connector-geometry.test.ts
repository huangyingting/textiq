import assert from "node:assert/strict";
import { test } from "node:test";

import type { ElementBox, SlideElement } from "./deck-elements";
import { snapLineEndpoint } from "./connector-geometry";

test("nearestAnchor equal-distance tie: center wins over top by first-wins priority", () => {
  // Box at origin, 10×10 units, stageAspect=1.
  // Point {x:5, y:2.5}: dist to center {5,5} = 2.5 and dist to top {5,0} = 2.5 — exact tie.
  // nearestAnchor seeds with "center" and advances only on strict <, so center always wins ties.
  const box: ElementBox = { x: 0, y: 0, w: 10, h: 10 };
  const element: SlideElement = {
    id: "shape-1",
    kind: "shape",
    box,
    zIndex: 0,
    content: { kind: "shape", shape: "rect" },
  };
  const result = snapLineEndpoint(
    { x: 5, y: 2.5 },
    "line-1",
    [element],
    () => box,
    1,
    10,
  );
  assert.deepEqual(result.binding, { elementId: "shape-1", anchor: "center" });
});
