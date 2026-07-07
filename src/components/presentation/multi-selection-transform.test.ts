import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  multiSelectionBounds,
  rotateMultiSelectionFrames,
  scaleMultiSelectionFrames,
  type MultiSelectionTransformEntry,
} from "./multi-selection-transform";

describe("multi-selection transform helpers", () => {
  const entries: MultiSelectionTransformEntry[] = [
    { id: "a", frame: { x: 10, y: 20, w: 10, h: 10 }, rotation: 15 },
    { id: "b", frame: { x: 40, y: 50, w: 20, h: 20 } },
  ];

  test("computes union bounds for selected frames", () => {
    assert.deepEqual(multiSelectionBounds(entries), {
      x: 10,
      y: 20,
      w: 50,
      h: 50,
    });
    assert.equal(multiSelectionBounds([]), null);
  });

  test("scales frames proportionally inside a new bounding box", () => {
    const patches = scaleMultiSelectionFrames(
      entries,
      {
        x: 10,
        y: 20,
        w: 50,
        h: 50,
      },
      {
        x: 20,
        y: 30,
        w: 100,
        h: 100,
      },
    );

    assert.deepEqual(patches.get("a")?.frame, {
      x: 20,
      y: 30,
      w: 20,
      h: 20,
    });
    assert.deepEqual(patches.get("b")?.frame, {
      x: 80,
      y: 90,
      w: 40,
      h: 40,
    });
  });

  test("rotates frames around the selection center and updates node rotation", () => {
    const patches = rotateMultiSelectionFrames(entries, 35, 45, 90);
    assert.deepEqual(patches.get("a")?.frame, {
      x: 50,
      y: 20,
      w: 10,
      h: 10,
    });
    assert.equal(patches.get("a")?.rotation, 105);
    assert.deepEqual(patches.get("b")?.frame, {
      x: 10,
      y: 50,
      w: 20,
      h: 20,
    });
    assert.equal(patches.get("b")?.rotation, 90);
  });

  test("rotates frame centers in physical canvas space on widescreen slides", () => {
    const patches = rotateMultiSelectionFrames(
      [{ id: "wide", frame: { x: 50, y: 35, w: 10, h: 10 } }],
      40,
      40,
      90,
      16 / 9,
    );
    const frame = patches.get("wide")?.frame;

    assert.ok(frame);
    assert.equal(frame.x, 35);
    assert.ok(Math.abs(frame.y - 61.66666666666667) < 0.0000001);
  });
});
