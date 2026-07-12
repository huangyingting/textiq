import assert from "node:assert/strict";
import { test } from "node:test";

import { executeBackgroundFamilyCommand } from "./slide-command-background-executor";
import { makeDeck, makeSlide } from "./deck-mutation-test-fixtures";
import type {
  SetSlideAccentCommand,
  SetSlideBackgroundAssetCommand,
  SetSlideBackgroundCommand,
  SetSlideBackgroundGradientCommand,
  SetSlideBackgroundImageCommand,
} from "./slide-command-contracts";

function deckWithSlide() {
  return makeDeck([makeSlide({ id: "s1" }), makeSlide({ id: "s2" })]);
}

// ---------------------------------------------------------------------------
// SET_SLIDE_BACKGROUND
// ---------------------------------------------------------------------------

test("SET_SLIDE_BACKGROUND sets a solid background and emits a matching patch", () => {
  const deck = deckWithSlide();
  const cmd: SetSlideBackgroundCommand = {
    type: "SET_SLIDE_BACKGROUND",
    slideId: "s1",
    background: "#112233",
  };
  const result = executeBackgroundFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.affectedSlideIds, ["s1"]);
  assert.deepEqual(result.deck.slides[0]!.designOverrides?.background, {
    type: "solid",
    color: { value: "#112233" },
  });
  assert.equal(result.patches[0]!.op, "slide.set_background");
  assert.deepEqual(result.patches[0]!.slideFields, {
    s1: {
      designOverrides: {
        background: { type: "solid", color: { value: "#112233" } },
      },
    },
  });
});

test("SET_SLIDE_BACKGROUND clearing the background (undefined) still succeeds with empty design fields", () => {
  const deck = deckWithSlide();
  const cmd: SetSlideBackgroundCommand = {
    type: "SET_SLIDE_BACKGROUND",
    slideId: "s1",
    background: undefined,
  };
  const result = executeBackgroundFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.patches[0]!.slideFields, {
    s1: { designOverrides: {} },
  });
});

test("SET_SLIDE_BACKGROUND fails and leaves the deck untouched for a missing slide", () => {
  const deck = deckWithSlide();
  const cmd: SetSlideBackgroundCommand = {
    type: "SET_SLIDE_BACKGROUND",
    slideId: "missing",
    background: "#000000",
  };
  const result = executeBackgroundFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
  assert.equal(result.deck, deck);
  assert.deepEqual(result.patches, []);
});

// ---------------------------------------------------------------------------
// SET_SLIDE_BACKGROUND_GRADIENT
// ---------------------------------------------------------------------------

test("SET_SLIDE_BACKGROUND_GRADIENT sets a gradient background with an angle", () => {
  const deck = deckWithSlide();
  const cmd: SetSlideBackgroundGradientCommand = {
    type: "SET_SLIDE_BACKGROUND_GRADIENT",
    slideId: "s2",
    gradient: { from: "#ffffff", to: "#000000", angle: 45 },
  };
  const result = executeBackgroundFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.affectedSlideIds, ["s2"]);
  assert.deepEqual(result.deck.slides[1]!.designOverrides?.background, {
    type: "gradient",
    from: { value: "#ffffff" },
    to: { value: "#000000" },
    angle: 45,
  });
  assert.equal(result.patches[0]!.op, "slide.set_background_gradient");
});

test("SET_SLIDE_BACKGROUND_GRADIENT fails for a missing slide", () => {
  const deck = deckWithSlide();
  const cmd: SetSlideBackgroundGradientCommand = {
    type: "SET_SLIDE_BACKGROUND_GRADIENT",
    slideId: "missing",
    gradient: { from: "#fff", to: "#000" },
  };
  const result = executeBackgroundFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

// ---------------------------------------------------------------------------
// SET_SLIDE_BACKGROUND_IMAGE
// ---------------------------------------------------------------------------

test("SET_SLIDE_BACKGROUND_IMAGE sets an image background url", () => {
  const deck = deckWithSlide();
  const cmd: SetSlideBackgroundImageCommand = {
    type: "SET_SLIDE_BACKGROUND_IMAGE",
    slideId: "s1",
    image: "https://example.com/bg.png",
  };
  const result = executeBackgroundFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.deck.slides[0]!.designOverrides?.background, {
    type: "image",
    url: "https://example.com/bg.png",
  });
  assert.equal(result.patches[0]!.op, "slide.set_background_image");
});

test("SET_SLIDE_BACKGROUND_IMAGE fails for a missing slide", () => {
  const deck = deckWithSlide();
  const result = executeBackgroundFamilyCommand(deck, {
    type: "SET_SLIDE_BACKGROUND_IMAGE",
    slideId: "missing",
    image: "https://example.com/bg.png",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

// ---------------------------------------------------------------------------
// SET_SLIDE_BACKGROUND_ASSET
// ---------------------------------------------------------------------------

test("SET_SLIDE_BACKGROUND_ASSET sets an asset-backed image background", () => {
  const deck = deckWithSlide();
  const cmd: SetSlideBackgroundAssetCommand = {
    type: "SET_SLIDE_BACKGROUND_ASSET",
    slideId: "s1",
    opts: { url: "https://example.com/asset.png", assetId: "asset-1" },
  };
  const result = executeBackgroundFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.deck.slides[0]!.designOverrides?.background, {
    type: "image",
    url: "https://example.com/asset.png",
    assetId: "asset-1",
  });
  assert.equal(result.patches[0]!.op, "slide.set_background_asset");
});

test("SET_SLIDE_BACKGROUND_ASSET clearing opts still succeeds with empty design fields", () => {
  const deck = deckWithSlide();
  const result = executeBackgroundFamilyCommand(deck, {
    type: "SET_SLIDE_BACKGROUND_ASSET",
    slideId: "s1",
    opts: undefined,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.patches[0]!.slideFields, {
    s1: { designOverrides: {} },
  });
});

test("SET_SLIDE_BACKGROUND_ASSET fails for a missing slide", () => {
  const deck = deckWithSlide();
  const result = executeBackgroundFamilyCommand(deck, {
    type: "SET_SLIDE_BACKGROUND_ASSET",
    slideId: "missing",
    opts: { url: "https://example.com/asset.png", assetId: "asset-1" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

// ---------------------------------------------------------------------------
// SET_SLIDE_ACCENT
// ---------------------------------------------------------------------------

test("SET_SLIDE_ACCENT sets the accent color", () => {
  const deck = deckWithSlide();
  const cmd: SetSlideAccentCommand = {
    type: "SET_SLIDE_ACCENT",
    slideId: "s2",
    accent: "#ff00ff",
  };
  const result = executeBackgroundFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.deck.slides[1]!.designOverrides?.accent, {
    value: "#ff00ff",
  });
  assert.equal(result.patches[0]!.op, "slide.set_accent");
});

test("SET_SLIDE_ACCENT fails for a missing slide and leaves the deck reference untouched", () => {
  const deck = deckWithSlide();
  const result = executeBackgroundFamilyCommand(deck, {
    type: "SET_SLIDE_ACCENT",
    slideId: "missing",
    accent: "#ff00ff",
  });
  assert.equal(result.ok, false);
  assert.equal(result.deck, deck);
});
