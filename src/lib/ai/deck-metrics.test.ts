import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  Deck,
  Slide,
  SlideElement,
  TextElementStyle,
} from "../document/deck-kernel/deck";
import { LEGACY_DECK_SCHEMA_VERSION } from "../document/deck-kernel/deck";
import {
  computeDeckMetrics,
  countWords,
  deckEditDistance,
} from "@/lib/ai/deck-metrics";

// ---------------------------------------------------------------------------
// Fixture builders (schema-valid by construction)
// ---------------------------------------------------------------------------

const TEXT_STYLE: TextElementStyle = {
  fontSize: 5,
  bold: false,
  italic: false,
  align: "left",
};

const BOX = { x: 0, y: 0, w: 100, h: 100 } as const;

function fixtureElement(element: unknown): SlideElement {
  return element as unknown as SlideElement;
}

function fixtureSlide(slide: unknown): Slide {
  return slide as unknown as Slide;
}

function fixtureDeck(deck: unknown): Deck {
  return deck as unknown as Deck;
}

function textElement(id: string, text: string): SlideElement {
  return fixtureElement({
    id,
    box: { ...BOX },
    zIndex: 0,
    kind: "text",
    role: "body",
    content: { kind: "text", text, paragraphs: [{ text }] },
    designOverrides: { textStyle: { ...TEXT_STYLE } },
  });
}

function bulletsElement(id: string, bullets: string[]): SlideElement {
  return fixtureElement({
    id,
    box: { ...BOX },
    zIndex: 1,
    kind: "text",
    role: "bullet",
    content: {
      kind: "text",
      text: bullets.join("\n"),
      paragraphs: bullets.map((text) => ({
        text,
        listType: "bullet" as const,
      })),
    },
    designOverrides: { textStyle: { ...TEXT_STYLE } },
  });
}

function visualElement(id: string, visualId: string): SlideElement {
  return fixtureElement({
    id,
    box: { ...BOX },
    zIndex: 2,
    kind: "visual",
    role: "visual",
    content: { kind: "visual", visualId },
  });
}

function imageElement(id: string): SlideElement {
  return fixtureElement({
    id,
    box: { ...BOX },
    zIndex: 3,
    kind: "image",
    role: "media",
    content: { kind: "image", src: "asset-1" },
  });
}

function slide(index: number, title: string, elements: SlideElement[]): Slide {
  return fixtureSlide({
    id: "test-id",
    index,
    title,
    notes: "",
    elements,
  });
}

function deck(slides: Slide[]): Deck {
  return fixtureDeck({
    schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
    canvas: { format: "16:9" },
    design: { themeId: "indigo" },
    masters: [{ id: "master-default", name: "Default", elements: [] }],
    defaultMasterId: "master-default",
    slides,
  });
}

// An empty deck: no slides.
function emptyDeck(): Deck {
  return deck([]);
}

// A concise "1 idea per slide" deck: short text, no visuals.
function conciseDeck(): Deck {
  return deck([
    slide(0, "Intro", [textElement("e0", "Hello world")]), // 2 words
    slide(1, "Body", [textElement("e1", "One simple idea here")]), // 4 words
    slide(2, "End", [textElement("e2", "Thank you")]), // 2 words
  ]);
}

// A visual-heavy deck: every slide has a visual element.
function visualHeavyDeck(): Deck {
  return deck([
    slide(0, "A", [
      textElement("a-t", "Chart one"), // 2 words
      visualElement("a-v", "vis-1"),
    ]),
    slide(1, "B", [
      bulletsElement("b-b", ["alpha beta", "gamma"]), // 3 words
      visualElement("b-v", "vis-2"),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

test("countWords handles blank, single, and multi-word strings", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("word"), 1);
  assert.equal(countWords("two words"), 2);
  assert.equal(countWords("  spaced   out  text "), 3);
});

// ---------------------------------------------------------------------------
// computeDeckMetrics
// ---------------------------------------------------------------------------

test("computeDeckMetrics: empty deck has zeroed metrics and is valid", () => {
  const metrics = computeDeckMetrics(emptyDeck());
  assert.equal(metrics.slideCount, 0);
  assert.equal(metrics.totalWordCount, 0);
  assert.equal(metrics.wordsPerSlide, 0);
  assert.equal(metrics.slidesWithVisual, 0);
  assert.equal(metrics.percentSlidesWithVisual, 0);
  assert.equal(metrics.schemaValid, true);
  assert.equal(metrics.sourceWordCount, undefined);
  assert.equal(metrics.slidesPerSourceWord, undefined);
});

test("computeDeckMetrics: concise deck counts words/slide and no visuals", () => {
  const metrics = computeDeckMetrics(conciseDeck());
  assert.equal(metrics.slideCount, 3);
  assert.equal(metrics.totalWordCount, 8); // 2 + 4 + 2
  assert.equal(metrics.wordsPerSlide, 8 / 3);
  assert.equal(metrics.slidesWithVisual, 0);
  assert.equal(metrics.percentSlidesWithVisual, 0);
  assert.equal(metrics.schemaValid, true);
});

test("computeDeckMetrics: visual-heavy deck reports full visual share", () => {
  const metrics = computeDeckMetrics(visualHeavyDeck());
  assert.equal(metrics.slideCount, 2);
  assert.equal(metrics.totalWordCount, 5); // 2 + 3
  assert.equal(metrics.wordsPerSlide, 2.5);
  assert.equal(metrics.slidesWithVisual, 2);
  assert.equal(metrics.percentSlidesWithVisual, 1);
  assert.equal(metrics.schemaValid, true);
});

test("computeDeckMetrics: partial visual share is a fraction", () => {
  const mixed = deck([
    slide(0, "A", [textElement("a", "no visual here")]),
    slide(1, "B", [visualElement("b", "vis-1")]),
  ]);
  const metrics = computeDeckMetrics(mixed);
  assert.equal(metrics.slidesWithVisual, 1);
  assert.equal(metrics.percentSlidesWithVisual, 0.5);
});

test("computeDeckMetrics: counts image elements as visual-bearing slides", () => {
  const metrics = computeDeckMetrics(
    deck([slide(0, "Image", [imageElement("image-1")])]),
  );
  assert.equal(metrics.slidesWithVisual, 1);
  assert.equal(metrics.percentSlidesWithVisual, 1);
  assert.equal(metrics.totalWordCount, 0);
});

test("computeDeckMetrics: slides without text elements contribute zero words", () => {
  const metrics = computeDeckMetrics(
    deck([
      slide(0, "Empty", []),
      slide(1, "Visual only", [visualElement("visual-only", "vis-1")]),
    ]),
  );

  assert.equal(metrics.slideCount, 2);
  assert.equal(metrics.totalWordCount, 0);
  assert.equal(metrics.wordsPerSlide, 0);
  assert.equal(metrics.slidesWithVisual, 1);
  assert.equal(metrics.percentSlidesWithVisual, 0.5);
});

test("computeDeckMetrics: tolerates malformed slide element lists", () => {
  const malformed = deck([
    { id: "bad", index: 0, title: "Bad", notes: "", elements: null } as never,
  ]);
  const metrics = computeDeckMetrics(malformed);
  assert.equal(metrics.totalWordCount, 0);
  assert.equal(metrics.slidesWithVisual, 0);
  assert.equal(metrics.schemaValid, false);
});

test("computeDeckMetrics: echoes sourceWordCount and derives slidesPerSourceWord", () => {
  const metrics = computeDeckMetrics(conciseDeck(), { sourceWordCount: 30 });
  assert.equal(metrics.sourceWordCount, 30);
  assert.equal(metrics.slidesPerSourceWord, 3 / 30);
});

test("computeDeckMetrics: ignores non-positive sourceWordCount", () => {
  const metrics = computeDeckMetrics(conciseDeck(), { sourceWordCount: 0 });
  assert.equal(metrics.sourceWordCount, undefined);
  assert.equal(metrics.slidesPerSourceWord, undefined);
});

test("computeDeckMetrics: schemaValid is false for a malformed deck", () => {
  const bad = fixtureDeck({ themeId: "indigo", slides: [{ index: 0 }] });
  const metrics = computeDeckMetrics(bad);
  assert.equal(metrics.schemaValid, false);
});

test("computeDeckMetrics: does not mutate its input deck", () => {
  const original = visualHeavyDeck();
  const snapshot = JSON.stringify(original);
  computeDeckMetrics(original, { sourceWordCount: 12 });
  assert.equal(JSON.stringify(original), snapshot);
});

test("computeDeckMetrics: output contains only counts/flags (no content)", () => {
  const metrics = computeDeckMetrics(conciseDeck(), { sourceWordCount: 10 });
  const serialized = JSON.stringify(metrics);
  // None of the fixture slide text leaks into the metrics object.
  assert.ok(!serialized.includes("Hello world"));
  assert.ok(!serialized.includes("One simple idea"));
  assert.ok(!serialized.includes("Intro"));
  for (const value of Object.values(metrics)) {
    assert.ok(
      typeof value === "number" || typeof value === "boolean",
      "every metric value must be a number or boolean",
    );
  }
});

// ---------------------------------------------------------------------------
// deckEditDistance
// ---------------------------------------------------------------------------

test("deckEditDistance: identical decks have zero distance", () => {
  const d = conciseDeck();
  const distance = deckEditDistance(d, conciseDeck());
  assert.deepEqual(distance, {
    slidesAdded: 0,
    slidesRemoved: 0,
    slidesChanged: 0,
    elementDelta: 0,
    distance: 0,
  });
});

test("deckEditDistance: an added slide is reflected", () => {
  const before = conciseDeck();
  const after = deck([
    ...conciseDeck().slides,
    slide(3, "New Slide", [textElement("n", "extra content")]),
  ]);
  const distance = deckEditDistance(before, after);
  assert.equal(distance.slidesAdded, 1);
  assert.equal(distance.slidesRemoved, 0);
  assert.equal(distance.slidesChanged, 0);
  assert.equal(distance.elementDelta, 1); // one new element
  assert.equal(distance.distance, 2);
});

test("deckEditDistance: a removed slide is reflected", () => {
  const before = conciseDeck();
  const after = deck(conciseDeck().slides.slice(0, 2));
  const distance = deckEditDistance(before, after);
  assert.equal(distance.slidesAdded, 0);
  assert.equal(distance.slidesRemoved, 1);
  assert.equal(distance.slidesChanged, 0);
  assert.equal(distance.elementDelta, 1); // one fewer element
  assert.equal(distance.distance, 2);
});

test("deckEditDistance: an edited slide (same element count) is changed", () => {
  const before = conciseDeck();
  const after = conciseDeck();
  // Edit the body text of the second slide — title (match key) unchanged.
  const el = after.slides[1].elements?.[0];
  assert.ok(el && el.kind === "text");
  if (el && el.kind === "text") {
    el.content = {
      ...el.content,
      kind: "text",
      text: "A completely different idea",
      paragraphs: [{ text: "A completely different idea" }],
    };
  }
  const distance = deckEditDistance(before, after);
  assert.equal(distance.slidesChanged, 1);
  assert.equal(distance.slidesAdded, 0);
  assert.equal(distance.slidesRemoved, 0);
  assert.equal(distance.elementDelta, 0); // element count unchanged
  assert.equal(distance.distance, 1);
});

test("deckEditDistance: adding an element to a slide bumps elementDelta", () => {
  const before = conciseDeck();
  const after = conciseDeck();
  after.slides[0].elements?.push(textElement("extra", "added line"));
  const distance = deckEditDistance(before, after);
  assert.equal(distance.slidesChanged, 1); // content of slide 0 changed
  assert.equal(distance.elementDelta, 1);
  assert.equal(distance.distance, 2);
});

test("deckEditDistance: does not mutate its inputs", () => {
  const before = conciseDeck();
  const after = visualHeavyDeck();
  const beforeSnap = JSON.stringify(before);
  const afterSnap = JSON.stringify(after);
  deckEditDistance(before, after);
  assert.equal(JSON.stringify(before), beforeSnap);
  assert.equal(JSON.stringify(after), afterSnap);
});
