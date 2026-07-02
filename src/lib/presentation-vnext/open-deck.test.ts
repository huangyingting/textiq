import assert from "node:assert/strict";
import { test, describe } from "node:test";

import * as legacyDeckBoundary from "../document/deck-kernel/deck";
import { LEGACY_DECK_SCHEMA_VERSION } from "../document/deck-kernel/deck";
import { DECK_SCHEMA_VERSION_V7 } from "./schema";
import {
  decideDeckOpen,
  openAiGeneratedDeck,
  openDeckFromJson,
  looksLikeDeckV7,
} from "./open-deck";

// ---------------------------------------------------------------------------
// Minimal v7 fixture
// ---------------------------------------------------------------------------

const MINIMAL_V7 = {
  schemaVersion: DECK_SCHEMA_VERSION_V7,
  id: "deck-0001",
  title: "Identity deck",
  canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
  theme: { packageId: "neutral", brandKitId: "brand-0001" },
  assets: {
    images: {
      "asset-0001": {
        id: "asset-0001",
        src: "https://example.com/asset.png",
        alt: "Asset",
      },
    },
  },
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

// ---------------------------------------------------------------------------
// Minimal v6 fixture
// ---------------------------------------------------------------------------

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
          source: {
            documentId: "doc-1",
            blockId: "block-1",
            blockKind: "text",
          },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// openDeckFromJson — v7 pass-through
// ---------------------------------------------------------------------------

describe("openDeckFromJson — v7 pass-through", () => {
  test("keeps legacy and current deck schema versions explicitly split", () => {
    assert.equal(LEGACY_DECK_SCHEMA_VERSION, 6);
    assert.equal(DECK_SCHEMA_VERSION_V7, 7);
    assert.notEqual(LEGACY_DECK_SCHEMA_VERSION, DECK_SCHEMA_VERSION_V7);
    assert.equal(
      "CURRENT_DECK_SCHEMA_VERSION" in legacyDeckBoundary,
      false,
      "Legacy deck boundary must not expose an ambiguous CURRENT_* schema constant",
    );
  });

  test("accepts a valid v7 deck", () => {
    const result = openDeckFromJson(MINIMAL_V7);
    assert.ok(result.ok);
    assert.equal(result.deck.schemaVersion, DECK_SCHEMA_VERSION_V7);
  });

  test("preserves valid v7 deck JSON and identities unchanged", () => {
    const result = openDeckFromJson(MINIMAL_V7);
    assert.ok(result.ok);
    assert.equal(result.source, "v7");
    assert.equal(result.deck, MINIMAL_V7);
    assert.equal(result.deck.id, "deck-0001");
    assert.equal(result.deck.theme.packageId, "neutral");
    assert.equal(result.deck.theme.brandKitId, "brand-0001");
    assert.equal(result.deck.assets.images["asset-0001"]?.id, "asset-0001");
    assert.equal(result.deck.slides[0].id, "slide-0001");
  });

  test("routes AI deck proposals through the same v7 validation boundary", () => {
    const valid = openAiGeneratedDeck(MINIMAL_V7);
    assert.ok(valid.ok);
    assert.equal(valid.source, "v7");
    assert.equal(valid.deck, MINIMAL_V7);

    const invalid = openAiGeneratedDeck({
      schemaVersion: DECK_SCHEMA_VERSION_V7,
      slides: [],
    });
    assert.ok(!invalid.ok);
    assert.match(invalid.error, /v7 deck validation failed/);
  });

  test("returns ok=false with validation errors for a malformed v7 deck", () => {
    const bad = { ...MINIMAL_V7, slides: [] }; // slides must be non-empty
    const result = openDeckFromJson(bad);
    assert.ok(!result.ok);
    assert.ok(result.error.length > 0);
  });

  test("returns ok=false for a v7 deck missing required fields", () => {
    const bad = { schemaVersion: DECK_SCHEMA_VERSION_V7, slides: null };
    const result = openDeckFromJson(bad);
    assert.ok(!result.ok);
  });
});

// ---------------------------------------------------------------------------
// openDeckFromJson — unknown / missing version
// ---------------------------------------------------------------------------

describe("openDeckFromJson — unknown schema version", () => {
  test("returns ok=false for a non-object input", () => {
    assert.ok(!openDeckFromJson(null).ok);
    assert.ok(!openDeckFromJson("string").ok);
    assert.ok(!openDeckFromJson(42).ok);
    assert.ok(!openDeckFromJson([]).ok);
  });

  test("returns ok=false for an object with no schemaVersion", () => {
    const result = openDeckFromJson({ slides: [] });
    assert.ok(!result.ok);
  });

  test("returns ok=false for superseded v6 deck payloads", () => {
    const result = openDeckFromJson(MINIMAL_V6);
    assert.ok(!result.ok);
    assert.match(
      result.error,
      new RegExp(`Expected schemaVersion ${DECK_SCHEMA_VERSION_V7}`),
    );
    assert.deepEqual(result.diagnostics, []);
  });

  test("returns ok=false for a string schemaVersion", () => {
    const result = openDeckFromJson({
      schemaVersion: String(DECK_SCHEMA_VERSION_V7),
      slides: [],
    });
    assert.ok(!result.ok);
  });
});

// ---------------------------------------------------------------------------
// decideDeckOpen
// ---------------------------------------------------------------------------

describe("decideDeckOpen", () => {
  test("starts blank only for absent deck JSON", () => {
    assert.deepEqual(decideDeckOpen(null), { mode: "blank" });
    assert.deepEqual(decideDeckOpen(undefined), { mode: "blank" });
  });

  test("routes invalid non-empty v7 input to recovery instead of blank", () => {
    const result = decideDeckOpen({
      schemaVersion: DECK_SCHEMA_VERSION_V7,
      slides: [],
    });
    assert.equal(result.mode, "recovery");
    if (result.mode === "recovery") {
      assert.match(result.error, /v7 deck validation failed/);
      assert.ok(
        (result.errors ?? []).some((error) => error.includes("slides")),
      );
    }
  });

  test("routes superseded v6 input to recovery", () => {
    const result = decideDeckOpen(MINIMAL_V6);
    assert.equal(result.mode, "recovery");
    if (result.mode === "recovery") {
      assert.match(
        result.error,
        new RegExp(`Expected schemaVersion ${DECK_SCHEMA_VERSION_V7}`),
      );
      assert.deepEqual(result.diagnostics, []);
    }
  });
});

// ---------------------------------------------------------------------------
// looksLikeDeckV7
// ---------------------------------------------------------------------------

describe("looksLikeDeckV7", () => {
  test("returns true for an object with schemaVersion 7", () => {
    assert.equal(
      looksLikeDeckV7({ schemaVersion: DECK_SCHEMA_VERSION_V7 }),
      true,
    );
  });

  test("returns false for schemaVersion 6", () => {
    assert.equal(
      looksLikeDeckV7({ schemaVersion: LEGACY_DECK_SCHEMA_VERSION }),
      false,
    );
  });

  test("returns false for null and non-objects", () => {
    assert.equal(looksLikeDeckV7(null), false);
    assert.equal(looksLikeDeckV7("7"), false);
    assert.equal(looksLikeDeckV7(7), false);
  });

  test("returns false for an object without schemaVersion", () => {
    assert.equal(looksLikeDeckV7({}), false);
  });
});
