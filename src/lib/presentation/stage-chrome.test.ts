import assert from "node:assert/strict";
import { test } from "node:test";

import {
  selectionFrameChrome,
  STAGE_CHROME_Z_INDEX,
  stageElementOverlayZIndex,
} from "./stage-chrome";

test("stageElementOverlayZIndex keeps unselected overlays in slide order", () => {
  assert.equal(
    stageElementOverlayZIndex({ elementZIndex: 7, selected: false }),
    8,
  );
});

test("stageElementOverlayZIndex lifts selected overlays into the chrome layer", () => {
  assert.equal(
    stageElementOverlayZIndex({ elementZIndex: 7, selected: true }),
    STAGE_CHROME_Z_INDEX.selectedElementOverlay,
  );
});

test("presentation stage chrome layers keep feedback above slide content", () => {
  assert.ok(
    STAGE_CHROME_Z_INDEX.preselectedFrame >
      STAGE_CHROME_Z_INDEX.selectedElementOverlay,
  );
  assert.ok(
    STAGE_CHROME_Z_INDEX.selectedFrame > STAGE_CHROME_Z_INDEX.preselectedFrame,
  );
  assert.ok(
    STAGE_CHROME_Z_INDEX.multiSelectionBounds >
      STAGE_CHROME_Z_INDEX.selectedFrame,
  );
  assert.ok(
    STAGE_CHROME_Z_INDEX.cropHandle > STAGE_CHROME_Z_INDEX.multiSelectionBounds,
  );
  assert.ok(STAGE_CHROME_Z_INDEX.marquee > STAGE_CHROME_Z_INDEX.snapGuide);
  assert.ok(STAGE_CHROME_Z_INDEX.inlineEditor > STAGE_CHROME_Z_INDEX.marquee);
});

test("selectionFrameChrome keeps selected above preselected", () => {
  const selected = selectionFrameChrome("selected");
  const preselected = selectionFrameChrome("preselected");
  assert.equal(selected.borderWidthPx, 2);
  assert.equal(preselected.borderWidthPx, 2);
  assert.equal(selected.opacity, 1);
  assert.ok(preselected.opacity < selected.opacity);
  assert.ok(selected.zIndex > preselected.zIndex);
});
