import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveSlideTitle, slideEffectiveTitle } from "./slide-title";
import { makeDeck, makeSlide } from "./deck-mutation-test-fixtures";
import type { TextElement } from "./deck-elements";

function textElement(
  id: string,
  text: string,
  overrides: Partial<Omit<TextElement, "id" | "kind" | "content">> = {},
): TextElement {
  return {
    id,
    kind: "text",
    box: { x: 0, y: 0, w: 80, h: 20 },
    zIndex: 0,
    content: { kind: "text", text, paragraphs: [{ text }] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// slideEffectiveTitle — role priority and trimming
// ---------------------------------------------------------------------------

test("slideEffectiveTitle returns the title-role element's trimmed text", () => {
  const slide = makeSlide({
    elements: [textElement("t1", "  My Title  ", { role: "title" })],
  });
  assert.equal(slideEffectiveTitle(slide), "My Title");
});

test("slideEffectiveTitle prefers a title role over a sectionTitle role even when sectionTitle appears first", () => {
  const slide = makeSlide({
    elements: [
      textElement("s1", "Section", { role: "sectionTitle" }),
      textElement("t1", "Title", { role: "title" }),
    ],
  });
  assert.equal(slideEffectiveTitle(slide), "Title");
});

test("slideEffectiveTitle falls back to sectionTitle when no title role is present", () => {
  const slide = makeSlide({
    elements: [textElement("s1", "Section Heading", { role: "sectionTitle" })],
  });
  assert.equal(slideEffectiveTitle(slide), "Section Heading");
});

test("slideEffectiveTitle skips a title-role element whose text is blank/whitespace-only", () => {
  const slide = makeSlide({
    elements: [
      textElement("t1", "   ", { role: "title" }),
      textElement("s1", "Section Heading", { role: "sectionTitle" }),
    ],
  });
  assert.equal(slideEffectiveTitle(slide), "Section Heading");
});

test("slideEffectiveTitle ignores non-text elements and elements with an unrelated role", () => {
  const slide = makeSlide({
    elements: [
      textElement("b1", "Body copy", { role: "body" }),
      {
        id: "img1",
        kind: "image",
        box: { x: 0, y: 0, w: 10, h: 10 },
        zIndex: 0,
        content: { kind: "image", src: "x.png" },
      } as never,
    ],
  });
  assert.equal(slideEffectiveTitle(slide), "");
});

test("slideEffectiveTitle returns empty string when the slide has no elements", () => {
  const slide = makeSlide({ elements: [] });
  assert.equal(slideEffectiveTitle(slide), "");
});

test("slideEffectiveTitle returns empty string when slide.elements is undefined (malformed slide)", () => {
  const slide = {
    ...makeSlide(),
    elements: undefined,
  } as unknown as Parameters<typeof slideEffectiveTitle>[0];
  assert.equal(slideEffectiveTitle(slide), "");
});

// ---------------------------------------------------------------------------
// deriveSlideTitle — full fallback chain and positional label
// ---------------------------------------------------------------------------

test("deriveSlideTitle returns the effective title when a heading role element exists", () => {
  const slide = makeSlide({
    elements: [textElement("t1", "Real Title", { role: "title" })],
  });
  assert.equal(deriveSlideTitle(slide, 3), "Real Title");
});

test("deriveSlideTitle falls back to the first non-empty text element when there is no heading role", () => {
  const slide = makeSlide({
    elements: [
      textElement("b1", "  ", { role: "body" }),
      textElement("b2", "First real body text", { role: "body" }),
    ],
  });
  assert.equal(deriveSlideTitle(slide, 0), "First real body text");
});

test("deriveSlideTitle falls back to the 1-based positional label when there is no title and no text content", () => {
  const slide = makeSlide({ elements: [] });
  assert.equal(deriveSlideTitle(slide, 0), "Slide 1");
  assert.equal(deriveSlideTitle(slide, 4), "Slide 5");
});

test("deriveSlideTitle falls back to the positional label when every text element is blank", () => {
  const slide = makeSlide({
    elements: [textElement("b1", "   ", { role: "body" })],
  });
  assert.equal(deriveSlideTitle(slide, 2), "Slide 3");
});

test("deriveSlideTitle prefers the heading role over the first-text fallback even when body text comes first in array order", () => {
  const slide = makeSlide({
    elements: [
      textElement("b1", "Body text first", { role: "body" }),
      textElement("t1", "Heading wins", { role: "title" }),
    ],
  });
  assert.equal(deriveSlideTitle(slide, 0), "Heading wins");
});

test("deriveSlideTitle handles a slide with a missing elements array (malformed slide)", () => {
  const slide = {
    ...makeSlide(),
    elements: undefined,
  } as unknown as Parameters<typeof deriveSlideTitle>[0];
  assert.equal(deriveSlideTitle(slide, 1), "Slide 2");
});

// ---------------------------------------------------------------------------
// Shared source-of-truth: rail label and deck-merge matching key never drift
// ---------------------------------------------------------------------------

test("slideEffectiveTitle and deriveSlideTitle agree on the same title for a full deck fixture", () => {
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      elements: [textElement("t1", "Deck Title", { role: "title" })],
    }),
  ]);
  const slide = deck.slides[0];
  assert.equal(deriveSlideTitle(slide, 0), slideEffectiveTitle(slide));
});
