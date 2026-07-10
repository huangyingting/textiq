import assert from "node:assert/strict";
import { test } from "node:test";

import type { ElementBox, SlideElement } from "./deck-elements";
import { snapLineEndpoint } from "./connector-geometry";

test("nearestAnchor equal-distance tie: top wins over left by tuple-order priority (non-seed anchors)", () => {
  // Box at (0, 0), 10×10 units, stageAspect=1.
  // Point at the top-left corner {x:0, y:0}:
  //   dist to top   {5, 0} = sqrt((0-5)²+(0-0)²) = 5
  //   dist to left  {0, 5} = sqrt((0-0)²+(0-5)²) = 5   ← exact tie
  //   dist to center{5, 5} = sqrt((0-5)²+(0-5)²) ≈ 7.07 ← center loses
  // CONNECTOR_ANCHORS = ["center","top","bottom","left","right"]
  // nearestAnchor seeds with center (≈7.07), then iterates with strict-<:
  //   "center" at ≈7.07 — no update (equals seed)
  //   "top"    at 5     — beats seed → nearest=top, nearestDistance=5
  //   "bottom" at ≈11.2 — no update
  //   "left"   at 5     — equals nearestDistance, NOT < → no update
  //   "right"  at ≈11.2 — no update
  // "top" wins because it precedes "left" in the canonical tuple;
  // this is the first-wins tie-break contract for non-seed anchors.
  const box: ElementBox = { x: 0, y: 0, w: 10, h: 10 };
  const element: SlideElement = {
    id: "shape-1",
    kind: "shape",
    box,
    zIndex: 0,
    content: { kind: "shape", shape: "rect" },
  };
  const result = snapLineEndpoint(
    { x: 0, y: 0 },
    "line-1",
    [element],
    () => box,
    1,
    10,
  );
  assert.deepEqual(result.binding, { elementId: "shape-1", anchor: "top" });
});
