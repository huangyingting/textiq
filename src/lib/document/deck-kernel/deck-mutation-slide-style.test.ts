import assert from "node:assert/strict";
import { test } from "node:test";

import type { SlideBackgroundDesign } from "./deck-core";
import {
  setSlideAccent,
  setSlideBackground,
  setSlideBackgroundAsset,
  setSlideBackgroundGradient,
  setSlideBackgroundImage,
} from "./deck-mutation-slide-style";
import { makeDeck, makeSlide } from "./deck-mutation-test-fixtures";

// ---------------------------------------------------------------------------
// setSlideBackground
// ---------------------------------------------------------------------------

test("setSlideBackground sets a solid color override", () => {
  const deck = makeDeck([makeSlide()]);
  const result = setSlideBackground(deck, 0, "#ff0000");
  assert.deepEqual(result.slides[0]!.designOverrides!.background, {
    type: "solid",
    color: { value: "#ff0000" },
  });
});

test("setSlideBackground clears the background and drops an empty designOverrides object", () => {
  const deck = makeDeck([
    makeSlide({
      designOverrides: {
        background: { type: "solid", color: { value: "#ff0000" } },
      },
    }),
  ]);
  const result = setSlideBackground(deck, 0, undefined);
  assert.ok(!("designOverrides" in result.slides[0]!));
});

test("setSlideBackground clearing preserves sibling designOverrides keys", () => {
  const deck = makeDeck([
    makeSlide({
      designOverrides: {
        background: { type: "solid", color: { value: "#ff0000" } },
        accent: { value: "#00ff00" },
      },
    }),
  ]);
  const result = setSlideBackground(deck, 0, undefined);
  assert.ok(!("background" in result.slides[0]!.designOverrides!));
  assert.deepEqual(result.slides[0]!.designOverrides!.accent, {
    value: "#00ff00",
  });
});

test("setSlideBackground is a no-op deck-wrapper for an out-of-range index", () => {
  const deck = makeDeck([makeSlide()]);
  assert.equal(setSlideBackground(deck, 9, "#fff"), deck);
});

// ---------------------------------------------------------------------------
// setSlideAccent
// ---------------------------------------------------------------------------

test("setSlideAccent sets an accent color override", () => {
  const deck = makeDeck([makeSlide()]);
  const result = setSlideAccent(deck, 0, "#123456");
  assert.deepEqual(result.slides[0]!.designOverrides!.accent, {
    value: "#123456",
  });
});

test("setSlideAccent clears the accent override", () => {
  const deck = makeDeck([
    makeSlide({ designOverrides: { accent: { value: "#123456" } } }),
  ]);
  const result = setSlideAccent(deck, 0, undefined);
  assert.ok(!("designOverrides" in result.slides[0]!));
});

// ---------------------------------------------------------------------------
// setSlideBackgroundGradient
// ---------------------------------------------------------------------------

test("setSlideBackgroundGradient sets a gradient with an explicit angle", () => {
  const deck = makeDeck([makeSlide()]);
  const result = setSlideBackgroundGradient(deck, 0, {
    from: "#000000",
    to: "#ffffff",
    angle: 45,
  });
  assert.deepEqual(result.slides[0]!.designOverrides!.background, {
    type: "gradient",
    from: { value: "#000000" },
    to: { value: "#ffffff" },
    angle: 45,
  });
});

test("setSlideBackgroundGradient omits angle when not provided", () => {
  const deck = makeDeck([makeSlide()]);
  const result = setSlideBackgroundGradient(deck, 0, {
    from: "#000000",
    to: "#ffffff",
  });
  const background = result.slides[0]!.designOverrides!
    .background as SlideBackgroundDesign;
  assert.ok(!("angle" in background));
});

test("setSlideBackgroundGradient replaces a prior background image", () => {
  const deck = makeDeck([
    makeSlide({
      designOverrides: { background: { type: "image", url: "old.png" } },
    }),
  ]);
  const result = setSlideBackgroundGradient(deck, 0, {
    from: "#000000",
    to: "#ffffff",
  });
  const background = result.slides[0]!.designOverrides!
    .background as SlideBackgroundDesign;
  assert.equal(background.type, "gradient");
});

test("setSlideBackgroundGradient clears the background when undefined", () => {
  const deck = makeDeck([
    makeSlide({
      designOverrides: {
        background: {
          type: "gradient",
          from: { value: "#000" },
          to: { value: "#fff" },
        },
      },
    }),
  ]);
  const result = setSlideBackgroundGradient(deck, 0, undefined);
  assert.ok(!("designOverrides" in result.slides[0]!));
});

// ---------------------------------------------------------------------------
// setSlideBackgroundImage
// ---------------------------------------------------------------------------

test("setSlideBackgroundImage sets an image background", () => {
  const deck = makeDeck([makeSlide()]);
  const result = setSlideBackgroundImage(deck, 0, "photo.png");
  assert.deepEqual(result.slides[0]!.designOverrides!.background, {
    type: "image",
    url: "photo.png",
  });
});

test("setSlideBackgroundImage clears the background when undefined", () => {
  const deck = makeDeck([
    makeSlide({
      designOverrides: { background: { type: "image", url: "photo.png" } },
    }),
  ]);
  const result = setSlideBackgroundImage(deck, 0, undefined);
  assert.ok(!("designOverrides" in result.slides[0]!));
});

// ---------------------------------------------------------------------------
// setSlideBackgroundAsset
// ---------------------------------------------------------------------------

test("setSlideBackgroundAsset sets an image background with both url and assetId", () => {
  const deck = makeDeck([makeSlide()]);
  const result = setSlideBackgroundAsset(deck, 0, {
    url: "resolved.png",
    assetId: "asset-1",
  });
  assert.deepEqual(result.slides[0]!.designOverrides!.background, {
    type: "image",
    url: "resolved.png",
    assetId: "asset-1",
  });
});

test("setSlideBackgroundAsset clears the background asset and image when undefined", () => {
  const deck = makeDeck([
    makeSlide({
      designOverrides: {
        background: {
          type: "image",
          url: "resolved.png",
          assetId: "asset-1",
        },
      },
    }),
  ]);
  const result = setSlideBackgroundAsset(deck, 0, undefined);
  assert.ok(!("designOverrides" in result.slides[0]!));
});
