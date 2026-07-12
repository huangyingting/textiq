import assert from "node:assert/strict";
import { test } from "node:test";

import type { Deck } from "./deck-core";
import {
  setDeckSlideFormat,
  setPresentationTheme,
} from "./deck-mutation-deck-settings";
import { makeDeck, makeSlide } from "./deck-mutation-test-fixtures";

// ---------------------------------------------------------------------------
// setPresentationTheme
// ---------------------------------------------------------------------------

test("setPresentationTheme sets the theme id when design is absent", () => {
  const deck = makeDeck([makeSlide()]);
  const result = setPresentationTheme(deck, "modern");
  assert.equal(result.design?.themeId, "modern");
});

test("setPresentationTheme replaces an existing theme id and preserves other design fields", () => {
  const deck: Deck = makeDeck([makeSlide()], {
    design: { themeId: "classic", customFlag: true },
  });
  const result = setPresentationTheme(deck, "modern");
  assert.equal(result.design?.themeId, "modern");
  assert.equal(result.design?.customFlag, true);
});

test("setPresentationTheme clears themeOverrides so the built-in token set is visible", () => {
  const deck: Deck = makeDeck([makeSlide()], {
    design: { themeId: "classic", themeOverrides: { accent: "#fff" } },
  });
  const result = setPresentationTheme(deck, "modern");
  assert.ok(!result.design || !("themeOverrides" in result.design));
});

// ---------------------------------------------------------------------------
// setDeckSlideFormat
// ---------------------------------------------------------------------------

test("setDeckSlideFormat sets the format when canvas is absent", () => {
  const deck = makeDeck([makeSlide()]);
  const result = setDeckSlideFormat(deck, "4:3");
  assert.equal(result.canvas?.format, "4:3");
});

test("setDeckSlideFormat replaces an existing format", () => {
  const deck: Deck = makeDeck([makeSlide()], { canvas: { format: "16:9" } });
  const result = setDeckSlideFormat(deck, "4:3");
  assert.equal(result.canvas?.format, "4:3");
});

test("setDeckSlideFormat is a no-op (same reference) when the format is unchanged", () => {
  const deck: Deck = makeDeck([makeSlide()], { canvas: { format: "16:9" } });
  const result = setDeckSlideFormat(deck, "16:9");
  assert.equal(result, deck);
});
