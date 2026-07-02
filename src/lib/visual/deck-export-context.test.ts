import assert from "node:assert/strict";
import { test } from "node:test";

import type { DocumentBlock } from "@/lib/content";
import { createBlankDeckV7 } from "@/lib/presentation-vnext/empty-deck";
import { LEGACY_DECK_SCHEMA_VERSION, type Deck } from "../presentation/deck";
import type { Visual } from "@/lib/visual/schema";

import { resolveDeckExportContext } from "./deck-export-context";

const BLOCKS: DocumentBlock[] = [
  {
    kind: "text",
    blockType: "paragraph",
    text: "Document heading",
    blockId: "block-text-1",
  },
  {
    kind: "visual",
    visualId: "visual-1",
    visual: { chartType: "bar" } as unknown as Visual,
  },
];

const LEGACY_DECK: Deck = {
  schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
  canvas: { format: "16:9" },
  design: { themeId: "default" },
  masters: [{ id: "master-default", name: "Default", elements: [] }],
  defaultMasterId: "master-default",
  slides: [
    {
      id: "legacy-slide",
      index: 0,
      title: "Legacy saved deck",
      notes: "legacy notes",
      elements: [],
    },
  ],
} as Deck;

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

  const context = resolveDeckExportContext(BLOCKS, deckV7, null);
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

  const context = resolveDeckExportContext(BLOCKS, invalidDeckV7, null);
  assert.equal(context.kind, "error");
  if (context.kind === "error") {
    assert.match(context.message, /DeckV7/);
  }
});

test("resolveDeckExportContext keeps legacy saved decks for export", () => {
  const context = resolveDeckExportContext(BLOCKS, LEGACY_DECK, null);
  assert.equal(context.kind, "legacy");
  if (context.kind === "legacy") {
    assert.equal(context.deck.slides[0]?.title, "Legacy saved deck");
  }
});

test("resolveDeckExportContext falls back to block-derived legacy deck when missing saved deck", () => {
  const context = resolveDeckExportContext(BLOCKS, null, null);
  assert.equal(context.kind, "legacy");
  if (context.kind === "legacy") {
    const visualBlock = BLOCKS.find(
      (block): block is Extract<DocumentBlock, { kind: "visual" }> =>
        block.kind === "visual",
    );
    assert.ok(context.deck.slides.length > 0);
    assert.equal(context.visuals.get("visual-1"), visualBlock?.visual);
  }
});
