import assert from "node:assert/strict";
import { test } from "node:test";

import { buildImageElement, buildVisualElement } from "@/test/builders/deck";
import { buildVisual } from "@/test/builders/visual";
import { buildDeckImageOp, buildDeckVisualOp } from "./deck-fallback-ops";

const box = { x: 10, y: 20, w: 30, h: 10 };

test("buildDeckImageOp returns null for empty sources", () => {
  assert.equal(
    buildDeckImageOp(buildImageElement({ src: "  " }), box, undefined),
    null,
  );
});

test("buildDeckImageOp combines content, box, crop, and design defaults", () => {
  const op = buildDeckImageOp(
    buildImageElement({
      src: "data:image/png;base64,abc",
      alt: "Chart",
      crop: { top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 },
      radius: 50,
      fitMode: "contain",
    }),
    box,
    { fitMode: "cover", maskShape: "circle", radiusPct: 25 },
  );

  assert.deepEqual(op, {
    kind: "image",
    ...box,
    src: "data:image/png;base64,abc",
    alt: "Chart",
    fitMode: "contain",
    maskShape: "circle",
    crop: { top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 },
    radius: 5,
  });
});

test("buildDeckImageOp uses image defaults when element overrides are absent", () => {
  const op = buildDeckImageOp(
    buildImageElement({ src: "data:image/png;base64,abc" }),
    box,
    { fitMode: "cover", maskShape: "rounded", radiusPct: 20 },
  );
  assert.equal(op?.fitMode, "cover");
  assert.equal(op?.maskShape, "rounded");
  assert.equal(op?.radius, 2);
});

test("buildDeckVisualOp returns native specs for representable visuals fitted within the box", () => {
  const op = buildDeckVisualOp(
    buildVisualElement({ visualId: "visual-1" }),
    buildVisual({ width: 600, height: 300 }),
    { x: 0, y: 0, w: 60, h: 60 },
    undefined,
  );
  assert.equal(op.kind, "visual-native");
  assert.ok(op.specs.length > 0);
});

test("buildDeckVisualOp falls back for unsupported visual kinds and transformed boxes", () => {
  const element = buildVisualElement({ visualId: "visual-1" });
  assert.deepEqual(
    buildDeckVisualOp(element, buildVisual({ type: "funnel" }), box, undefined),
    { kind: "visual-fallback", ...box, visualId: "visual-1" },
  );
  assert.deepEqual(
    buildDeckVisualOp(
      element,
      buildVisual(),
      { ...box, rotation: 5 },
      undefined,
    ),
    { kind: "visual-fallback", ...box, rotation: 5, visualId: "visual-1" },
  );
  assert.deepEqual(
    buildDeckVisualOp(
      element,
      buildVisual(),
      { ...box, shadow: true },
      undefined,
    ),
    { kind: "visual-fallback", ...box, shadow: true, visualId: "visual-1" },
  );
  assert.deepEqual(
    buildDeckVisualOp(
      element,
      buildVisual(),
      { ...box, opacity: 0.5 },
      undefined,
    ),
    { kind: "visual-fallback", ...box, opacity: 0.5, visualId: "visual-1" },
  );
});

test("buildDeckVisualOp applies a default visual style bridge when provided", () => {
  const op = buildDeckVisualOp(
    buildVisualElement({ visualId: "visual-1" }),
    buildVisual(),
    { x: 0, y: 0, w: 60, h: 60 },
    { styleThemeId: "monochrome" },
  );
  assert.equal(op.kind, "visual-native");
});
