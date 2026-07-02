import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PRESENTATION_NAVIGATION_SHORTCUT_IDS,
  PRESENT_MODE_SHORTCUTS,
  clampPresentSlideIndex,
  fitPresentCanvasToViewport,
  formatPresentElapsedTime,
  formatPresentProgress,
  presentCanvasAspectRatio,
  presentHashFromSlideIndex,
  presentProgress,
  presentSlideIndexFromHash,
  resolvePresentSwipeNavigation,
} from "./present-shell";

test("present shell helpers preserve shared navigation and viewport behavior", () => {
  assert.equal(clampPresentSlideIndex(10, 3), 2);
  assert.equal(clampPresentSlideIndex(-1, 3), 0);
  assert.equal(formatPresentProgress(1, 3), "2 / 3");
  assert.deepEqual(presentProgress(1, 3), {
    label: "2 / 3",
    percentage: 50,
  });

  assert.equal(presentSlideIndexFromHash("#3", 5), 2);
  assert.equal(presentSlideIndexFromHash("100", 5), 4);
  assert.equal(presentSlideIndexFromHash("bad", 5), 0);
  assert.equal(presentHashFromSlideIndex(2), "#3");

  assert.equal(resolvePresentSwipeNavigation(-60), "next");
  assert.equal(resolvePresentSwipeNavigation(60), "prev");
  assert.equal(resolvePresentSwipeNavigation(10), null);

  assert.deepEqual(
    fitPresentCanvasToViewport({ width: 1200, height: 600 }, 16 / 9),
    {
      width: 1066.6666666666665,
      height: 600,
    },
  );
  assert.deepEqual(
    fitPresentCanvasToViewport({ width: 0, height: 0 }, 16 / 9),
    {
      width: 16,
      height: 9,
    },
  );
  assert.equal(presentCanvasAspectRatio({ width: 4, height: 3 }), 4 / 3);
  assert.equal(presentCanvasAspectRatio(null), 16 / 9);
});

test("present shell exposes public navigation and private presenter shortcuts", () => {
  assert.equal(PRESENTATION_NAVIGATION_SHORTCUT_IDS.next, "presentation.next");
  assert.ok(
    PRESENT_MODE_SHORTCUTS.some((shortcut) => shortcut.action === "laser"),
  );
  assert.ok(
    PRESENT_MODE_SHORTCUTS.some((shortcut) => shortcut.action === "fullscreen"),
  );
  assert.equal(formatPresentElapsedTime(3661), "01:01:01");
});
