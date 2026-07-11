import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDeck,
  buildImageElement,
  buildShapeElement,
  buildSlide,
  buildTextElement,
  buildVisualElement,
} from "@/test/builders/deck";

import { stripOrphanedVisuals } from "./strip-orphans";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function knownSet(...ids: string[]): ReadonlySet<string> {
  return new Set(ids);
}

// ---------------------------------------------------------------------------
// Deck-level structural contracts
// ---------------------------------------------------------------------------

test("stripOrphanedVisuals always returns a new deck object (not identity)", () => {
  const deck = buildDeck({ slides: [buildSlide()] });
  const result = stripOrphanedVisuals(deck, knownSet());
  assert.notStrictEqual(result, deck);
});

test("stripOrphanedVisuals preserves all non-slides deck fields verbatim", () => {
  const deck = buildDeck({
    slides: [buildSlide()],
    deckContentHash: "abc123",
  });
  const result = stripOrphanedVisuals(deck, knownSet());
  assert.equal(result.design?.themeId, deck.design?.themeId);
  assert.equal(result.defaultMasterId, deck.defaultMasterId);
  assert.equal(result.deckContentHash, "abc123");
  assert.equal(result.canvas?.format, deck.canvas?.format);
});

test("stripOrphanedVisuals with empty slides array returns deck with empty slides", () => {
  const deck = buildDeck({ slides: [] });
  const result = stripOrphanedVisuals(deck, knownSet());
  assert.deepEqual(result.slides, []);
});

// ---------------------------------------------------------------------------
// Input immutability
// ---------------------------------------------------------------------------

test("stripOrphanedVisuals does not mutate the input deck", () => {
  const visual = buildVisualElement({ id: "v-el", visualId: "v-orphan" });
  const slide = buildSlide({ id: "s1", elements: [visual] });
  const deck = buildDeck({ slides: [slide] });

  const deckBefore = JSON.stringify(deck);
  stripOrphanedVisuals(deck, knownSet());
  assert.equal(JSON.stringify(deck), deckBefore);
});

test("stripOrphanedVisuals does not mutate the input slide elements array", () => {
  const visual = buildVisualElement({ id: "v-el", visualId: "v1" });
  const slide = buildSlide({ id: "s1", elements: [visual] });
  const deck = buildDeck({ slides: [slide] });

  const originalElements = deck.slides[0].elements!;
  const elementsBefore = originalElements.length;
  stripOrphanedVisuals(deck, knownSet("v1"));
  assert.equal(originalElements.length, elementsBefore);
});

// ---------------------------------------------------------------------------
// Identity return — slide returned by reference when nothing changed
// ---------------------------------------------------------------------------

test("slide with no orphans is returned by identity", () => {
  const visual = buildVisualElement({ id: "v-el", visualId: "v1" });
  const slide = buildSlide({ id: "s1", elements: [visual] });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet("v1"));
  assert.strictEqual(result.slides[0], deck.slides[0]);
});

test("slide with no visual elements is returned by identity", () => {
  const slide = buildSlide({
    id: "s1",
    elements: [buildTextElement({ id: "t1" })],
  });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet());
  assert.strictEqual(result.slides[0], deck.slides[0]);
});

test("slide with empty elements array is returned by identity", () => {
  const slide = buildSlide({ id: "s1", elements: [] });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet());
  assert.strictEqual(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// Unknown visual removal
// ---------------------------------------------------------------------------

test("visual element with unknown visualId is removed", () => {
  const visual = buildVisualElement({ id: "v-el", visualId: "v-orphan" });
  const slide = buildSlide({ id: "s1", elements: [visual] });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet());
  assert.equal(result.slides[0].elements?.length, 0);
});

test("all visual elements are dropped when knownVisualIds is empty", () => {
  const elements = [
    buildVisualElement({ id: "v1", visualId: "vis-a" }),
    buildVisualElement({ id: "v2", visualId: "vis-b" }),
    buildVisualElement({ id: "v3", visualId: "vis-c" }),
  ];
  const slide = buildSlide({ id: "s1", elements });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet());
  assert.equal(result.slides[0].elements?.length, 0);
});

test("orphaned visual removed from multi-slide deck leaves other slides intact", () => {
  const slideA = buildSlide({
    id: "s-a",
    elements: [buildVisualElement({ id: "v-orphan", visualId: "gone" })],
  });
  const slideB = buildSlide({
    id: "s-b",
    elements: [buildTextElement({ id: "t1" })],
  });
  const deck = buildDeck({ slides: [slideA, slideB] });

  const result = stripOrphanedVisuals(deck, knownSet());
  assert.equal(result.slides[0].elements?.length, 0);
  assert.strictEqual(result.slides[1], deck.slides[1]);
});

// ---------------------------------------------------------------------------
// Known visual preservation
// ---------------------------------------------------------------------------

test("visual element with known visualId is preserved", () => {
  const visual = buildVisualElement({ id: "v-el", visualId: "v1" });
  const slide = buildSlide({ id: "s1", elements: [visual] });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet("v1"));
  const elements = result.slides[0].elements ?? [];
  assert.equal(elements.length, 1);
  assert.equal(elements[0].kind, "visual");
  if (elements[0].kind === "visual") {
    assert.equal(elements[0].content.visualId, "v1");
  }
});

test("multiple known visuals are all preserved", () => {
  const elements = [
    buildVisualElement({ id: "v1", visualId: "vis-a" }),
    buildVisualElement({ id: "v2", visualId: "vis-b" }),
  ];
  const slide = buildSlide({ id: "s1", elements });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet("vis-a", "vis-b"));
  assert.equal(result.slides[0].elements?.length, 2);
});

// ---------------------------------------------------------------------------
// Mixed element arrays
// ---------------------------------------------------------------------------

test("mixed slide: unknown visual dropped; other element kinds retained", () => {
  const text = buildTextElement({ id: "t1" });
  const image = buildImageElement({ id: "img1" });
  const shape = buildShapeElement({ id: "sh1" });
  const orphan = buildVisualElement({ id: "v-orphan", visualId: "gone" });
  const known = buildVisualElement({ id: "v-known", visualId: "kept" });

  const slide = buildSlide({
    id: "s1",
    elements: [text, image, shape, orphan, known],
  });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet("kept"));
  const outElements = result.slides[0].elements ?? [];
  assert.equal(outElements.length, 4);

  const ids = outElements.map((e) => e.id);
  assert.ok(ids.includes("t1"), "text element preserved");
  assert.ok(ids.includes("img1"), "image element preserved");
  assert.ok(ids.includes("sh1"), "shape element preserved");
  assert.ok(ids.includes("v-known"), "known visual preserved");
  assert.ok(!ids.includes("v-orphan"), "orphaned visual removed");
});

test("when visual is dropped slide becomes a new object (not identity)", () => {
  const orphan = buildVisualElement({ id: "v-orphan", visualId: "gone" });
  const slide = buildSlide({ id: "s1", elements: [orphan] });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet());
  assert.notStrictEqual(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// Ordering and determinism
// ---------------------------------------------------------------------------

test("element ordering is preserved after stripping orphans", () => {
  const e1 = buildTextElement({ id: "t1" });
  const e2 = buildVisualElement({ id: "v-keep", visualId: "k1" });
  const e3 = buildVisualElement({ id: "v-drop", visualId: "gone" });
  const e4 = buildShapeElement({ id: "sh1" });

  const slide = buildSlide({ id: "s1", elements: [e1, e2, e3, e4] });
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet("k1"));
  const ids = (result.slides[0].elements ?? []).map((e) => e.id);
  assert.deepEqual(ids, ["t1", "v-keep", "sh1"]);
});

test("stripOrphanedVisuals is deterministic across repeated calls", () => {
  const elements = [
    buildVisualElement({ id: "v1", visualId: "keep" }),
    buildVisualElement({ id: "v2", visualId: "drop" }),
    buildTextElement({ id: "t1" }),
  ];
  const slide = buildSlide({ id: "s1", elements });
  const deck = buildDeck({ slides: [slide] });

  const r1 = stripOrphanedVisuals(deck, knownSet("keep"));
  const r2 = stripOrphanedVisuals(deck, knownSet("keep"));
  assert.deepEqual(
    (r1.slides[0].elements ?? []).map((e) => e.id),
    (r2.slides[0].elements ?? []).map((e) => e.id),
  );
});

// ---------------------------------------------------------------------------
// Boundary: slide with undefined elements
// ---------------------------------------------------------------------------

test("slide with undefined elements field is returned by identity", () => {
  // Slide.elements is optional — some slides may omit it entirely.
  const slide: import("./deck-kernel/deck-core").Slide = {
    id: "s-no-elements",
    index: 0,
    title: "No elements",
    notes: "",
  };
  const deck = buildDeck({ slides: [slide] });

  const result = stripOrphanedVisuals(deck, knownSet());
  assert.strictEqual(result.slides[0], deck.slides[0]);
});

// ---------------------------------------------------------------------------
// Multi-slide mixed identity: only changed slides become new objects
// ---------------------------------------------------------------------------

test("unmodified slides are returned by identity even when other slides change", () => {
  const orphan = buildVisualElement({ id: "v-orphan", visualId: "gone" });
  const slideA = buildSlide({ id: "s-a", elements: [orphan] }); // will change
  const slideB = buildSlide({
    id: "s-b",
    elements: [buildTextElement({ id: "t1" })],
  }); // unchanged
  const slideC = buildSlide({
    id: "s-c",
    elements: [buildVisualElement({ id: "v-known", visualId: "known" })],
  }); // unchanged (known visual)
  const deck = buildDeck({ slides: [slideA, slideB, slideC] });

  const result = stripOrphanedVisuals(deck, knownSet("known"));
  assert.notStrictEqual(result.slides[0], deck.slides[0], "s-a should be new");
  assert.strictEqual(result.slides[1], deck.slides[1], "s-b identity");
  assert.strictEqual(result.slides[2], deck.slides[2], "s-c identity");
});
