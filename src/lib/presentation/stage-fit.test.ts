import assert from "node:assert/strict";
import { test } from "node:test";

import { fitCanvasToViewport } from "./stage-fit";

test("fitCanvasToViewport treats 100% as fit without scroll", () => {
  const fit = fitCanvasToViewport({
    viewport: { width: 900, height: 500 },
    aspectRatio: 16 / 9,
    zoomPercent: 100,
  });

  assert.equal(fit.needsScroll, false);
  assert.ok(fit.frame.width <= 900);
  assert.ok(fit.frame.height <= 500);
  assert.equal(fit.scrollContentSize.width, 900);
  assert.equal(fit.scrollContentSize.height, 500);
});

test("fitCanvasToViewport scrolls only when zoom exceeds fit", () => {
  const fit = fitCanvasToViewport({
    viewport: { width: 900, height: 500 },
    aspectRatio: 16 / 9,
    zoomPercent: 150,
  });

  assert.equal(fit.needsScroll, true);
  assert.ok(fit.frame.width > 900 || fit.frame.height > 500);
  assert.ok(
    fit.scrollContentSize.width > 900 || fit.scrollContentSize.height > 500,
  );
});

test("fitCanvasToViewport keeps 100% canvas within the desktop safe area", () => {
  const fit = fitCanvasToViewport({
    viewport: { width: 1100, height: 560 },
    aspectRatio: 16 / 9,
    zoomPercent: 100,
    rightOverlayWidth: 352,
  });
  const safeViewportWidth = 1100 - 352;
  const frameRight = fit.frame.left + fit.frame.width;

  assert.ok(frameRight <= safeViewportWidth + 0.5);
  assert.equal(fit.needsScroll, false);
  assert.equal(fit.scrollContentSize.width, 1100);
});

test("fitCanvasToViewport respects inspector-safe width near desktop breakpoints", () => {
  for (const width of [1024, 1200]) {
    const fit = fitCanvasToViewport({
      viewport: { width, height: 600 },
      aspectRatio: 16 / 9,
      zoomPercent: 100,
      rightOverlayWidth: 352,
    });
    const safeViewportWidth = width - 352;
    const frameRight = fit.frame.left + fit.frame.width;

    assert.ok(frameRight <= safeViewportWidth + 0.5);
    assert.equal(fit.needsScroll, false);
  }
});

test("fitCanvasToViewport adds horizontal scroll room to reveal right edge behind overlay", () => {
  const viewport = { width: 1120, height: 360 };
  const rightOverlayWidth = 352;
  const fit = fitCanvasToViewport({
    viewport,
    aspectRatio: 16 / 9,
    zoomPercent: 125,
    rightOverlayWidth,
  });
  const safeViewportWidth = viewport.width - rightOverlayWidth;
  const frameRight = fit.frame.left + fit.frame.width;
  const requiredScrollLeft = Math.max(0, frameRight - safeViewportWidth);
  const availableScrollLeft = fit.scrollContentSize.width - viewport.width;

  assert.equal(fit.needsScroll, true);
  assert.ok(availableScrollLeft + 0.5 >= requiredScrollLeft);
});
