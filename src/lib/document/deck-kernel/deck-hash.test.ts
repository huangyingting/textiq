import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeDeckContentHash,
  deckContentSignature,
  isDeckStale,
  normalizeTitle,
  stampDeckContentHash,
} from "./deck-hash";
import { makeDeck, makeShape, makeSlide } from "./deck-mutation-test-fixtures";
import type { TextElement, VisualElement, TableElement } from "./deck-elements";

function bulletElement(id: string, text: string): TextElement {
  return {
    id,
    kind: "text",
    role: "bullet",
    box: { x: 10, y: 10, w: 20, h: 20 },
    zIndex: 0,
    content: { kind: "text", text, paragraphs: [{ text }] },
  };
}

function visualElement(id: string, visualId: string): VisualElement {
  return {
    id,
    kind: "visual",
    box: { x: 10, y: 10, w: 20, h: 20 },
    zIndex: 0,
    content: { kind: "visual", visualId },
  };
}

function tableElement(id: string): TableElement {
  return {
    id,
    kind: "table",
    box: { x: 10, y: 10, w: 20, h: 20 },
    zIndex: 0,
    content: {
      kind: "table",
      header: true,
      caption: "Caption",
      columns: [
        { id: "col-a", label: "Col A" },
        { id: "col-b", label: "Col B" },
      ],
      rows: [{ id: "row-1", cells: [{ text: "1" }, { text: "2" }] }],
    },
  };
}

// ---------------------------------------------------------------------------
// normalizeTitle
// ---------------------------------------------------------------------------

test("normalizeTitle trims and lower-cases", () => {
  assert.equal(normalizeTitle("  Hello World  "), "hello world");
  assert.equal(normalizeTitle("ALREADY LOWER"), "already lower");
  assert.equal(normalizeTitle(""), "");
});

// ---------------------------------------------------------------------------
// computeDeckContentHash — determinism
// ---------------------------------------------------------------------------

test("computeDeckContentHash is deterministic for the same deck content", () => {
  const deck = makeDeck([
    makeSlide({ id: "s1", title: "Title", notes: "Notes" }),
  ]);
  assert.equal(computeDeckContentHash(deck), computeDeckContentHash(deck));
  // Re-deriving an equivalent (but distinct object identity) deck yields the
  // same hash — the whole point of the staleness signal.
  const rebuilt = makeDeck([
    makeSlide({ id: "s1", title: "Title", notes: "Notes" }),
  ]);
  assert.equal(computeDeckContentHash(deck), computeDeckContentHash(rebuilt));
});

test("computeDeckContentHash changes when title, notes, theme, or template differ", () => {
  const base = makeDeck([makeSlide({ id: "s1", title: "A", notes: "N" })]);
  const baseHash = computeDeckContentHash(base);

  const differentTitle = makeDeck([
    makeSlide({ id: "s1", title: "B", notes: "N" }),
  ]);
  assert.notEqual(computeDeckContentHash(differentTitle), baseHash);

  const differentNotes = makeDeck([
    makeSlide({ id: "s1", title: "A", notes: "M" }),
  ]);
  assert.notEqual(computeDeckContentHash(differentNotes), baseHash);

  const differentTheme = makeDeck(
    [makeSlide({ id: "s1", title: "A", notes: "N" })],
    { design: { themeId: "midnight" } },
  );
  assert.notEqual(computeDeckContentHash(differentTheme), baseHash);

  const differentTemplate = makeDeck([
    makeSlide({ id: "s1", title: "A", notes: "N", templateId: "title" }),
  ]);
  assert.notEqual(computeDeckContentHash(differentTemplate), baseHash);
});

test("computeDeckContentHash changes when bullet text, visual ids, or table content differ", () => {
  const withBullet = makeDeck([
    makeSlide({ id: "s1", elements: [bulletElement("e1", "First point")] }),
  ]);
  const withDifferentBullet = makeDeck([
    makeSlide({ id: "s1", elements: [bulletElement("e1", "Second point")] }),
  ]);
  assert.notEqual(
    computeDeckContentHash(withBullet),
    computeDeckContentHash(withDifferentBullet),
  );

  const withVisual = makeDeck([
    makeSlide({ id: "s1", elements: [visualElement("e2", "vis-1")] }),
  ]);
  const withDifferentVisual = makeDeck([
    makeSlide({ id: "s1", elements: [visualElement("e2", "vis-2")] }),
  ]);
  assert.notEqual(
    computeDeckContentHash(withVisual),
    computeDeckContentHash(withDifferentVisual),
  );

  const withTable = makeDeck([
    makeSlide({ id: "s1", elements: [tableElement("e3")] }),
  ]);
  const withoutTable = makeDeck([makeSlide({ id: "s1", elements: [] })]);
  assert.notEqual(
    computeDeckContentHash(withTable),
    computeDeckContentHash(withoutTable),
  );
});

test("computeDeckContentHash ignores non-bullet text, non-visual/table kinds, and empty visual ids", () => {
  const withTitle: TextElement = {
    id: "e1",
    kind: "text",
    role: "title",
    box: { x: 10, y: 10, w: 20, h: 20 },
    zIndex: 0,
    content: { kind: "text", text: "Title text", paragraphs: [] },
  };
  const withEmptyVisualId = visualElement("e2", "");
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      elements: [withTitle, withEmptyVisualId, makeShape("shape-1")],
    }),
  ]);
  const bareDeck = makeDeck([makeSlide({ id: "s1", elements: [] })]);
  assert.equal(
    computeDeckContentHash(deck),
    computeDeckContentHash(bareDeck),
    "title text, shapes, and empty visual ids do not affect the content signature",
  );
});

test("computeDeckContentHash ignores manual styling: colors, element ids, and slide index", () => {
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      index: 0,
      title: "Same title",
      designOverrides: {
        accent: { value: "#ff0000" },
        background: { type: "solid", color: { value: "#000000" } },
      },
      elements: [bulletElement("original-id", "Bullet text")],
    }),
  ]);
  const restyled = makeDeck([
    makeSlide({
      id: "s1",
      index: 5,
      title: "Same title",
      designOverrides: {
        accent: { value: "#00ff00" },
        background: { type: "solid", color: { value: "#ffffff" } },
      },
      elements: [bulletElement("different-id", "Bullet text")],
    }),
  ]);
  assert.equal(
    computeDeckContentHash(deck),
    computeDeckContentHash(restyled),
    "designOverrides (accent/background), element ids, and slide index are excluded from the signature",
  );
});

test("deckContentSignature reflects theme and slide ordering", () => {
  const deck = makeDeck(
    [
      makeSlide({ id: "s1", title: "One" }),
      makeSlide({ id: "s2", title: "Two" }),
    ],
    { design: { themeId: "aurora" } },
  );
  const signature = deckContentSignature(deck);
  assert.ok(signature.startsWith("theme:aurora"));
  assert.ok(signature.includes("t:One"));
  assert.ok(signature.includes("t:Two"));
  assert.ok(signature.indexOf("t:One") < signature.indexOf("t:Two"));
});

// ---------------------------------------------------------------------------
// stampDeckContentHash — pure/immutable
// ---------------------------------------------------------------------------

test("stampDeckContentHash returns a copy with the given hash and does not mutate the input", () => {
  const deck = makeDeck([makeSlide({ id: "s1" })]);
  const stamped = stampDeckContentHash(deck, "abc123");
  assert.equal(stamped.deckContentHash, "abc123");
  assert.equal(deck.deckContentHash, undefined);
  assert.notEqual(stamped, deck);
  // Everything else is preserved.
  assert.deepEqual(stamped.slides, deck.slides);
});

// ---------------------------------------------------------------------------
// isDeckStale
// ---------------------------------------------------------------------------

test("isDeckStale returns false when the deck carries no stored hash", () => {
  const deck = makeDeck([makeSlide({ id: "s1" })]);
  assert.equal(isDeckStale(deck, "anything"), false);
  assert.equal(
    isDeckStale({ ...deck, deckContentHash: "" }, "anything"),
    false,
  );
});

test("isDeckStale returns false when the stored hash matches the current hash", () => {
  const deck = makeDeck([makeSlide({ id: "s1", title: "Match" })]);
  const currentHash = computeDeckContentHash(deck);
  const stamped = stampDeckContentHash(deck, currentHash);
  assert.equal(isDeckStale(stamped, currentHash), false);
});

test("isDeckStale returns true when the stored hash differs from the current hash", () => {
  const deck = makeDeck([makeSlide({ id: "s1", title: "Original" })]);
  const stamped = stampDeckContentHash(deck, "stale-hash-value");
  const currentHash = computeDeckContentHash(deck);
  assert.notEqual(currentHash, "stale-hash-value");
  assert.equal(isDeckStale(stamped, currentHash), true);
});
