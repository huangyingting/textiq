/**
 * Focused tests for presentation editor variant dispatch helpers.
 *
 * Verifies the detection/open logic that keeps slide editor runtime routing
 * Deck-only after the open boundary.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LEGACY_DECK_SCHEMA_VERSION } from "../document/deck-kernel/deck";
import { DECK_SCHEMA_VERSION } from "./schema";
import { looksLikeDeck, openDeckFromJson } from "./open-deck";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_ = {
  schemaVersion: DECK_SCHEMA_VERSION,
  canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
  theme: { packageId: "neutral" },
  assets: { images: {} },
  slides: [
    {
      id: "slide-0001",
      type: "slide",
      template: { kind: "cover" },
      style: { ref: "slide.cover" },
      children: [],
    },
  ],
};

const MINIMAL_V6 = {
  schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
  canvas: { format: "16:9" },
  design: { themeId: "default" },
  slides: [
    {
      id: "s1",
      title: "Title Slide",
      elements: [
        {
          id: "e1",
          kind: "text",
          role: "title",
          box: { x: 8, y: 8, w: 84, h: 14 },
          zIndex: 1,
          content: { text: "Hello" },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// looksLikeDeck — variant detection
// ---------------------------------------------------------------------------

describe("looksLikeDeck — variant detection for editor dispatch", () => {
  test("returns true for a presentation deck (schemaVersion: 7)", () => {
    assert.equal(looksLikeDeck(MINIMAL_), true);
    assert.equal(looksLikeDeck({ schemaVersion: DECK_SCHEMA_VERSION }), true);
  });

  test("returns false for a v6 deck", () => {
    assert.equal(looksLikeDeck(MINIMAL_V6), false);
  });

  test("returns false for null, non-objects, and unknown versions", () => {
    assert.equal(looksLikeDeck(null), false);
    assert.equal(looksLikeDeck(undefined), false);
    assert.equal(looksLikeDeck("7"), false);
    assert.equal(looksLikeDeck(7), false);
    assert.equal(
      looksLikeDeck({ schemaVersion: DECK_SCHEMA_VERSION + 1 }),
      false,
    );
    assert.equal(looksLikeDeck({}), false);
  });
});

// ---------------------------------------------------------------------------
// openDeckFromJson — open helper for Deck-only runtime
// ---------------------------------------------------------------------------

describe("openDeckFromJson — open helper variant behaviour", () => {
  test("presentation input: returns ok=true with schemaVersion=7", () => {
    const result = openDeckFromJson(MINIMAL_);
    assert.ok(result.ok);
    assert.equal(result.deck.schemaVersion, DECK_SCHEMA_VERSION);
  });

  test("v6 input: rejects superseded deck payloads", () => {
    const result = openDeckFromJson(MINIMAL_V6);
    assert.ok(!result.ok);
    assert.match(
      result.error,
      new RegExp(`Expected schemaVersion ${DECK_SCHEMA_VERSION}`),
    );
  });

  test("unknown input: returns ok=false", () => {
    assert.equal(openDeckFromJson(null).ok, false);
    assert.equal(
      openDeckFromJson({ schemaVersion: DECK_SCHEMA_VERSION + 92 }).ok,
      false,
    );
    assert.equal(openDeckFromJson("string").ok, false);
  });

  test("presentation deck with missing required fields returns ok=false", () => {
    const bad = { schemaVersion: DECK_SCHEMA_VERSION, slides: null };
    const result = openDeckFromJson(bad);
    assert.ok(!result.ok);
    assert.ok(result.error.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Preview mapping
// ---------------------------------------------------------------------------

describe("Preview mapping", () => {
  test("a presentation deck from the API passes through openDeckFromJson unchanged", () => {
    const presentationDeck = MINIMAL_;
    const result = openDeckFromJson(presentationDeck);
    assert.ok(result.ok);
    assert.equal(result.deck.schemaVersion, DECK_SCHEMA_VERSION);
    assert.equal(result.deck.slides[0].id, "slide-0001");
  });
});
