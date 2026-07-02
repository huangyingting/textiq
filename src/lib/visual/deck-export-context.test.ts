import assert from "node:assert/strict";
import { test } from "node:test";

import { createBlankDeckV7 } from "@/lib/presentation-vnext/empty-deck";

import { resolveDeckExportContext } from "./deck-export-context";

test("resolveDeckExportContext uses saved DeckV7 when present", () => {
  const blank = createBlankDeckV7({ title: "Saved deck v7" });
  const deckV7 = {
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

  const context = resolveDeckExportContext(deckV7, null);
  assert.equal(context.kind, "v7");
  if (context.kind === "v7") {
    assert.equal(context.deck.slides[0]?.id, "slide-b");
    assert.equal(context.deck.slides[0]?.notes, "Second slide notes");
    assert.equal(context.deck.slides[1]?.id, "slide-a");
    assert.equal(context.deck.slides[1]?.notes, "First slide notes");
  }
});

test("resolveDeckExportContext returns error for invalid DeckV7 payloads", () => {
  const invalidDeckV7 = {
    ...createBlankDeckV7(),
    slides: [],
  };

  const context = resolveDeckExportContext(invalidDeckV7, null);
  assert.equal(context.kind, "error");
  if (context.kind === "error") {
    assert.match(context.message, /DeckV7/);
  }
});

test("resolveDeckExportContext rejects missing DeckV7 payloads", () => {
  const context = resolveDeckExportContext(null, null);
  assert.equal(context.kind, "error");
  if (context.kind === "error") {
    assert.match(context.message, /DeckV7/);
  }
});
