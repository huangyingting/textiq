import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  nextSemanticSelectUnderNodeId,
  pointPctFromEvent,
  pointerMovedBeyondThreshold,
  shouldEnterInlineNodeEditOnClick,
} from "./stage-pointer-interactions";

describe("stage pointer interactions", () => {
  test("cycles semantic select-under candidates from the current selection", () => {
    assert.equal(
      nextSemanticSelectUnderNodeId(
        ["top", "middle", "bottom"],
        new Set(["middle"]),
      ),
      "bottom",
    );
    assert.equal(
      nextSemanticSelectUnderNodeId(
        ["top", "middle", "bottom"],
        new Set(["bottom"]),
      ),
      "top",
    );
    assert.equal(
      nextSemanticSelectUnderNodeId(["top"], new Set(["other"])),
      "top",
    );
  });

  test("converts client coordinates into clamped canvas percentages", () => {
    assert.deepEqual(
      pointPctFromEvent(
        { clientX: 160, clientY: 90 },
        { left: 60, top: 40, width: 200, height: 100 },
      ),
      { x: 50, y: 50 },
    );
    assert.deepEqual(
      pointPctFromEvent(
        { clientX: -10, clientY: 500 },
        { left: 60, top: 40, width: 200, height: 100 },
      ),
      { x: 0, y: 100 },
    );
  });

  test("uses strict click movement threshold parity", () => {
    assert.equal(
      pointerMovedBeyondThreshold({
        startX: 10,
        startY: 10,
        nextX: 14,
        nextY: 14,
        thresholdPx: 4,
      }),
      false,
    );
    assert.equal(
      pointerMovedBeyondThreshold({
        startX: 10,
        startY: 10,
        nextX: 15,
        nextY: 14,
        thresholdPx: 4,
      }),
      true,
    );
  });

  test("matches legacy inline-edit entry gating", () => {
    assert.equal(
      shouldEnterInlineNodeEditOnClick({
        mode: "move",
        moved: false,
        wasPrimarySelected: true,
        selectedCount: 1,
        isInlineEditable: true,
      }),
      true,
    );
    assert.equal(
      shouldEnterInlineNodeEditOnClick({
        mode: "move",
        moved: true,
        wasPrimarySelected: true,
        selectedCount: 1,
        isInlineEditable: true,
      }),
      false,
    );
    assert.equal(
      shouldEnterInlineNodeEditOnClick({
        mode: "move",
        moved: false,
        wasPrimarySelected: false,
        selectedCount: 1,
        isInlineEditable: true,
      }),
      false,
    );
    assert.equal(
      shouldEnterInlineNodeEditOnClick({
        mode: "resize",
        moved: false,
        wasPrimarySelected: true,
        selectedCount: 1,
        isInlineEditable: true,
      }),
      false,
    );
  });
});
