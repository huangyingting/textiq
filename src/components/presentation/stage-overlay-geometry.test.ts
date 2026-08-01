import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  applyAspectLock,
  clientAngleDegrees,
  clientDeltaPct,
  clampCrop,
  clampFrame,
  cropForHandleDrag,
  frameCenterClientPoint,
  framesEqual,
  resizeFrame,
  snapRotationDegrees,
} from "./stage-overlay-geometry";

describe("stage overlay geometry", () => {
  test("clamps frames to the percent stage contract", () => {
    assert.deepEqual(clampFrame({ x: -10, y: 99, w: 150, h: Number.NaN }), {
      x: 0,
      y: 99,
      w: 100,
      h: 0.5,
    });
    assert.deepEqual(clampFrame({ x: 95, y: 96, w: 10, h: 8 }), {
      x: 90,
      y: 92,
      w: 10,
      h: 8,
    });
  });

  test("resizes from directional handles and preserves minimum dimensions", () => {
    assert.deepEqual(resizeFrame({ x: 10, y: 20, w: 30, h: 40 }, "nw", 5, 8), {
      x: 15,
      y: 28,
      w: 25,
      h: 32,
    });
    assert.deepEqual(resizeFrame({ x: 10, y: 20, w: 3, h: 3 }, "nw", 8, 9), {
      x: 12.5,
      y: 22.5,
      w: 0.5,
      h: 0.5,
    });
  });

  test("locks aspect ratio using the dominant resize axis", () => {
    assert.deepEqual(
      applyAspectLock(
        { x: 0, y: 0, w: 20, h: 10 },
        { x: 0, y: 0, w: 40, h: 15 },
      ),
      { x: 0, y: 0, w: 40, h: 20 },
    );
    assert.deepEqual(
      applyAspectLock(
        { x: 0, y: 0, w: 20, h: 10 },
        { x: 0, y: 0, w: 25, h: 30 },
      ),
      { x: 0, y: 0, w: 60, h: 30 },
    );
  });

  test("updates crop handles in image-relative percentages", () => {
    const startCrop = { top: 2, right: 3, bottom: 4, left: 5 };
    const frame = { x: 10, y: 20, w: 40, h: 50 };
    assert.equal(clampCrop(95.96), 95);
    assert.deepEqual(
      cropForHandleDrag({
        handle: "left",
        startCrop,
        startPoint: { x: 20, y: 20 },
        nextPoint: { x: 24, y: 20 },
        frame,
      }),
      { top: 2, right: 3, bottom: 4, left: 15 },
    );
    assert.deepEqual(
      cropForHandleDrag({
        handle: "bottom",
        startCrop,
        startPoint: { x: 20, y: 40 },
        nextPoint: { x: 20, y: 35 },
        frame,
      }),
      { top: 2, right: 3, bottom: 14, left: 5 },
    );
    assert.deepEqual(
      cropForHandleDrag({
        handle: "right",
        startCrop: { top: 0, right: 0, bottom: 0, left: 95 },
        startPoint: { x: 50, y: 20 },
        nextPoint: { x: 0, y: 20 },
        frame,
      }),
      { top: 0, right: 3, bottom: 0, left: 95 },
    );
  });

  test("computes client deltas, centers, angle snapping, and equality", () => {
    assert.deepEqual(
      clientDeltaPct({
        startClientX: 10,
        startClientY: 20,
        nextClientX: 30,
        nextClientY: 5,
        rectWidth: 200,
        rectHeight: 100,
      }),
      { x: 10, y: -15 },
    );
    assert.deepEqual(
      frameCenterClientPoint(
        { x: 10, y: 20, w: 30, h: 40 },
        { left: 100, top: 200, width: 500, height: 250 },
      ),
      { x: 225, y: 300 },
    );
    assert.equal(clientAngleDegrees({ x: 10, y: 0 }, { x: 0, y: 0 }), 0);
    assert.equal(snapRotationDegrees(22, true), 15);
    assert.equal(snapRotationDegrees(-7.26, false), 352.7);
    assert.equal(
      framesEqual({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 }),
      true,
    );
  });
});
