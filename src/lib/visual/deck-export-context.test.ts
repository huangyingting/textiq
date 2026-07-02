import assert from "node:assert/strict";
import { test } from "node:test";

import { createBlankDeck } from "@/lib/presentation/empty-deck";

import { resolveDeckExportContext } from "./deck-export-context";

test("resolveDeckExportContext uses saved Deck when present", () => {
  const blank = createBlankDeck({ title: "Saved deck presentation" });
  const deck = {
    ...blank,
    slides: [
      {
        ...blank.slides[0],
        id: "slide-b",
        notes: "Second slide notes",
      },
      {
        ...blank.slides[0],
        id: "slide-a",
        notes: "First slide notes",
      },
    ],
  };

  const context = resolveDeckExportContext(deck, null);
  assert.equal(context.kind, "presentation");
  if (context.kind === "presentation") {
    assert.equal(context.deck.slides[0]?.id, "slide-b");
    assert.equal(context.deck.slides[0]?.notes, "Second slide notes");
    assert.equal(context.deck.slides[1]?.id, "slide-a");
    assert.equal(context.deck.slides[1]?.notes, "First slide notes");
  }
});

test("resolveDeckExportContext returns error for invalid Deck payloads", () => {
  const invalidDeck = {
    ...createBlankDeck(),
    slides: [],
  };

  const context = resolveDeckExportContext(invalidDeck, null);
  assert.equal(context.kind, "error");
  if (context.kind === "error") {
    assert.match(context.message, /Deck/);
  }
});

test("resolveDeckExportContext rejects missing Deck payloads", () => {
  const context = resolveDeckExportContext(null, null);
  assert.equal(context.kind, "error");
  if (context.kind === "error") {
    assert.match(context.message, /Deck/);
  }
});
