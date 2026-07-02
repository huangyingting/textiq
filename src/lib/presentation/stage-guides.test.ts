import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alignmentGuidesForFrames,
  snapFrameToStageGuides,
} from "./stage-guides";

test("snapFrameToStageGuides snaps near center lines", () => {
  const result = snapFrameToStageGuides({ x: 39.5, y: 20, w: 21, h: 10 }, 1);

  assert.equal(result.frame.x, 39.5);
  assert.ok(
    result.guides.some(
      (guide) => guide.axis === "x" && guide.positionPct === 50,
    ),
  );
});

test("snapFrameToStageGuides snaps near page margins", () => {
  const result = snapFrameToStageGuides({ x: 9.6, y: 89.4, w: 20, h: 10 }, 1);

  assert.equal(result.frame.x, 10);
  assert.equal(result.frame.y, 90);
  assert.deepEqual(result.guides, [
    { axis: "x", positionPct: 10 },
    { axis: "y", positionPct: 90 },
  ]);
});

test("snapFrameToStageGuides leaves distant frames unchanged", () => {
  const frame = { x: 22, y: 27, w: 18, h: 11 };
  const result = snapFrameToStageGuides(frame, 0.5);

  assert.deepEqual(result.frame, frame);
  assert.deepEqual(result.guides, []);
});

test("snapFrameToStageGuides snaps to custom alignment guides", () => {
  const result = snapFrameToStageGuides({ x: 28.4, y: 42, w: 10, h: 10 }, 1, [
    { axis: "x", positionPct: 28 },
  ]);

  assert.equal(result.frame.x, 28);
  assert.deepEqual(result.guides, [{ axis: "x", positionPct: 28 }]);
});

test("alignmentGuidesForFrames returns edge and center guides", () => {
  const guides = alignmentGuidesForFrames([{ x: 10, y: 20, w: 30, h: 40 }]);

  assert.deepEqual(guides, [
    { axis: "x", positionPct: 10 },
    { axis: "x", positionPct: 25 },
    { axis: "x", positionPct: 40 },
    { axis: "y", positionPct: 20 },
    { axis: "y", positionPct: 40 },
    { axis: "y", positionPct: 60 },
  ]);
});
