import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMinimalDeck } from "@/test/builders/presentation-deck";

import {
  canvasAspectRatio,
  canvasFrameStyle,
  canvasStageFit,
  stageScrollContentStyle,
} from "./slide-editor-stage-fit";

test("editor stage fit uses the provided viewport without inspector overlay reservation", () => {
  const deck = buildMinimalDeck();
  const fit = canvasStageFit(deck, 100, { width: 1200, height: 700 });

  assert.equal(canvasAspectRatio(deck), 16 / 9);
  assert.deepEqual(canvasFrameStyle(fit), {
    position: "absolute",
    left: fit.frame.left,
    top: fit.frame.top,
    width: fit.frame.width,
    height: fit.frame.height,
  });
  assert.deepEqual(stageScrollContentStyle(fit), {
    position: "relative",
    width: fit.scrollContentSize.width,
    height: fit.scrollContentSize.height,
  });
});
