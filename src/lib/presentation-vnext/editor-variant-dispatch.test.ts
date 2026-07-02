/**
 * Focused tests for v7 editor variant dispatch helpers.
 *
 * Verifies the detection/open logic that keeps slide editor runtime routing
 * DeckV7-only after the open boundary.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LEGACY_DECK_SCHEMA_VERSION } from "../document/deck-kernel/deck";
import { DECK_SCHEMA_VERSION_V7 } from "./schema";
import { looksLikeDeckV7, openDeckFromJson } from "./open-deck";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_V7 = {
  schemaVersion: DECK_SCHEMA_VERSION_V7,
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
// looksLikeDeckV7 — variant detection
// ---------------------------------------------------------------------------

describe("looksLikeDeckV7 — variant detection for editor dispatch", () => {
  test("returns true for a v7 deck (schemaVersion: 7)", () => {
    assert.equal(looksLikeDeckV7(MINIMAL_V7), true);
    assert.equal(
      looksLikeDeckV7({ schemaVersion: DECK_SCHEMA_VERSION_V7 }),
      true,
    );
  });

  test("returns false for a v6 deck", () => {
    assert.equal(looksLikeDeckV7(MINIMAL_V6), false);
  });

  test("returns false for null, non-objects, and unknown versions", () => {
    assert.equal(looksLikeDeckV7(null), false);
    assert.equal(looksLikeDeckV7(undefined), false);
    assert.equal(looksLikeDeckV7("7"), false);
    assert.equal(looksLikeDeckV7(7), false);
    assert.equal(
      looksLikeDeckV7({ schemaVersion: DECK_SCHEMA_VERSION_V7 + 1 }),
      false,
    );
    assert.equal(looksLikeDeckV7({}), false);
  });
});

// ---------------------------------------------------------------------------
// openDeckFromJson — open helper for DeckV7-only runtime
// ---------------------------------------------------------------------------

describe("openDeckFromJson — open helper variant behaviour", () => {
  test("v7 input: returns ok=true with schemaVersion=7", () => {
    const result = openDeckFromJson(MINIMAL_V7);
    assert.ok(result.ok);
    assert.equal(result.deck.schemaVersion, DECK_SCHEMA_VERSION_V7);
  });

  test("v6 input: rejects superseded deck payloads", () => {
    const result = openDeckFromJson(MINIMAL_V6);
    assert.ok(!result.ok);
    assert.match(
      result.error,
      new RegExp(`Expected schemaVersion ${DECK_SCHEMA_VERSION_V7}`),
    );
  });

  test("unknown input: returns ok=false", () => {
    assert.equal(openDeckFromJson(null).ok, false);
    assert.equal(
      openDeckFromJson({ schemaVersion: DECK_SCHEMA_VERSION_V7 + 92 }).ok,
      false,
    );
    assert.equal(openDeckFromJson("string").ok, false);
  });

  test("v7 deck with missing required fields returns ok=false", () => {
    const bad = { schemaVersion: DECK_SCHEMA_VERSION_V7, slides: null };
    const result = openDeckFromJson(bad);
    assert.ok(!result.ok);
    assert.ok(result.error.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Preview mapping
// ---------------------------------------------------------------------------

describe("Preview mapping", () => {
  test("a v7 deck from the API passes through openDeckFromJson unchanged", () => {
    const v7Deck = MINIMAL_V7;
    const result = openDeckFromJson(v7Deck);
    assert.ok(result.ok);
    assert.equal(result.deck.schemaVersion, DECK_SCHEMA_VERSION_V7);
    assert.equal(result.deck.slides[0].id, "slide-0001");
  });
});
