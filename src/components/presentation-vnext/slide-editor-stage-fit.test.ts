import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMinimalDeckV7 } from "@/test/builders/deck-v7";

import {
  canvasAspectRatio,
  canvasFrameStyle,
  canvasStageFit,
  stageScrollContentStyle,
} from "./slide-editor-stage-fit";

test("editor stage fit reserves desktop inspector overlay space", () => {
  const deck = buildMinimalDeckV7();
  const mobileFit = canvasStageFit(
    deck,
    100,
    { width: 1200, height: 700 },
    false,
  );
  const desktopFit = canvasStageFit(
    deck,
    100,
    { width: 1200, height: 700 },
    true,
  );

  assert.equal(canvasAspectRatio(deck), 16 / 9);
  assert.ok(desktopFit.frame.width < mobileFit.frame.width);
  assert.deepEqual(canvasFrameStyle(desktopFit), {
    position: "absolute",
    left: desktopFit.frame.left,
    top: desktopFit.frame.top,
    width: desktopFit.frame.width,
    height: desktopFit.frame.height,
  });
  assert.deepEqual(stageScrollContentStyle(desktopFit), {
    position: "relative",
    width: desktopFit.scrollContentSize.width,
    height: desktopFit.scrollContentSize.height,
  });
});
