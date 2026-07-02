import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasPctToContainerPx,
  containerPxToCanvasPct,
  fitCanvasToContainer,
} from "./fit-helpers";

function assertAlmostEqual(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 0.000001);
}

test("fitCanvasToContainer keeps a 16:9 canvas inside padded stage bounds", () => {
  const fit = fitCanvasToContainer(1000, 700, 1600, 900, 40);
  const scaledWidth = 1600 * fit.scale;
  const scaledHeight = 900 * fit.scale;

  assertAlmostEqual(fit.scale, 0.575);
  assertAlmostEqual(scaledWidth, 920);
  assertAlmostEqual(scaledHeight, 517.5);
  assertAlmostEqual(fit.offsetX, 40);
  assertAlmostEqual(fit.offsetY, 91.25);
});

test("fitCanvasToContainer keeps the canvas visible in a narrow editor stage", () => {
  const fit = fitCanvasToContainer(720, 520, 1600, 900, 24);
  const scaledWidth = 1600 * fit.scale;
  const scaledHeight = 900 * fit.scale;

  assertAlmostEqual(fit.scale, 0.42);
  assert.ok(scaledWidth <= 720 - 48);
  assert.ok(scaledHeight <= 520 - 48);
  assert.ok(fit.offsetX >= 24);
  assert.ok(fit.offsetY >= 24);
});

test("canvas percent and container pixel conversions round-trip through the stage fit", () => {
  const fit = fitCanvasToContainer(960, 600, 1600, 900, 30);
  const point = canvasPctToContainerPx(25, 75, 1600, 900, fit);
  const pct = containerPxToCanvasPct(point.x, point.y, 1600, 900, fit);

  assert.equal(pct.x, 25);
  assert.equal(pct.y, 75);
});

// ---------------------------------------------------------------------------
// Stage fit/zoom edge cases (UI migration scenarios)
// ---------------------------------------------------------------------------

test("fitCanvasToContainer with zero padding centers the canvas exactly", () => {
  // Container 800x450, canvas 1600x900 (same aspect) — scale = 0.5
  const fit = fitCanvasToContainer(800, 450, 1600, 900, 0);
  assertAlmostEqual(fit.scale, 0.5);
  assertAlmostEqual(fit.offsetX, 0);
  assertAlmostEqual(fit.offsetY, 0);
});

test("fitCanvasToContainer returns scale=1 when canvas fits exactly", () => {
  const fit = fitCanvasToContainer(1600, 900, 1600, 900, 0);
  assertAlmostEqual(fit.scale, 1);
  assertAlmostEqual(fit.offsetX, 0);
  assertAlmostEqual(fit.offsetY, 0);
});

test("fitCanvasToContainer handles zero-dimension container without crash", () => {
  // Zero-width container — should produce scale=1 fallback, not NaN/Infinity
  const fit = fitCanvasToContainer(0, 0, 1600, 900);
  assert.ok(Number.isFinite(fit.scale));
  assert.ok(Number.isFinite(fit.offsetX));
  assert.ok(Number.isFinite(fit.offsetY));
  assert.ok(fit.scale >= 0);
});

test("fitCanvasToContainer: canvas larger than container produces scale < 1", () => {
  const fit = fitCanvasToContainer(400, 300, 1600, 900, 0);
  assert.ok(fit.scale < 1, `Expected scale < 1, got ${fit.scale}`);
  assert.ok(1600 * fit.scale <= 400, "Scaled width must fit in container");
  assert.ok(900 * fit.scale <= 300, "Scaled height must fit in container");
});

test("canvasPctToContainerPx maps canvas origin (0,0) to stage offset", () => {
  const fit = fitCanvasToContainer(1000, 600, 1600, 900, 30);
  const origin = canvasPctToContainerPx(0, 0, 1600, 900, fit);
  assertAlmostEqual(origin.x, fit.offsetX);
  assertAlmostEqual(origin.y, fit.offsetY);
});

test("containerPxToCanvasPct at canvas origin returns (0,0)", () => {
  const fit = fitCanvasToContainer(1000, 600, 1600, 900, 30);
  const pct = containerPxToCanvasPct(fit.offsetX, fit.offsetY, 1600, 900, fit);
  assertAlmostEqual(pct.x, 0);
  assertAlmostEqual(pct.y, 0);
});
