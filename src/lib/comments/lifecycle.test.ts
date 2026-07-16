import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyElementDeleteToAnchors,
  applySlideDeleteToAnchors,
  findOrphanedAnchors,
  planSlideCommentAnchorRepairs,
} from "./lifecycle";
import type { SlideCommentAnchor } from "./slide-comment-anchors";
import type { Deck } from "@/lib/presentation/schema";
import { buildSlideCommentAnchor } from "@/test/builders/comments";

// ---------------------------------------------------------------------------
// Minimal deck builder reused from slide-comment-anchors.test.ts pattern
// ---------------------------------------------------------------------------

function buildDeck(slides: Array<{ id: string; elementIds?: string[] }>): Deck {
  return {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides: slides.map(({ id, elementIds = [] }) => ({
      id,
      type: "slide",
      template: { kind: "content" },
      style: { ref: "slide.content" },
      children: elementIds.map((elId) => ({
        id: elId,
        type: "text",
        role: "body",
        style: { ref: "text.body" },
        content: { paragraphs: [{ id: `${elId}-p1`, text: "" }] },
      })),
    })),
  } as never;
}

// ---------------------------------------------------------------------------
// applySlideDeleteToAnchors
// ---------------------------------------------------------------------------

test("applySlideDeleteToAnchors floats anchor on deleted slide to deck level", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "sl-deleted",
    elementId: "el-1",
    geometry: { x: 10, y: 20 },
  });
  const result = applySlideDeleteToAnchors([anchor], "sl-deleted");
  assert.equal(result.length, 1);
  assert.equal(result[0].slideId, null);
  assert.equal(result[0].elementId, null);
  assert.equal(result[0].geometry, null);
});

test("applySlideDeleteToAnchors leaves anchor on different slide unchanged", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "sl-other",
    elementId: "el-1",
    geometry: { x: 10, y: 20 },
  });
  const result = applySlideDeleteToAnchors([anchor], "sl-deleted");
  assert.equal(result[0], anchor);
});

test("applySlideDeleteToAnchors returns empty array when given empty input", () => {
  const result = applySlideDeleteToAnchors([], "sl-deleted");
  assert.deepEqual(result, []);
});

test("applySlideDeleteToAnchors does not mutate the input array", () => {
  const anchor = buildSlideCommentAnchor({ slideId: "sl-deleted" });
  const records: readonly SlideCommentAnchor[] = [anchor];
  applySlideDeleteToAnchors(records, "sl-deleted");
  assert.equal(records[0].slideId, "sl-deleted");
});

// ---------------------------------------------------------------------------
// applyElementDeleteToAnchors
// ---------------------------------------------------------------------------

test("applyElementDeleteToAnchors floats anchor matching slide and element to slide level", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-deleted",
    geometry: { x: 5, y: 15 },
  });
  const result = applyElementDeleteToAnchors([anchor], "sl-1", "el-deleted");
  assert.equal(result[0].slideId, "sl-1");
  assert.equal(result[0].elementId, null);
});

test("applyElementDeleteToAnchors leaves anchor on same slide but different element unchanged", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-other",
  });
  const result = applyElementDeleteToAnchors([anchor], "sl-1", "el-deleted");
  assert.equal(result[0], anchor);
});

test("applyElementDeleteToAnchors leaves anchor on different slide unchanged", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "sl-2",
    elementId: "el-deleted",
  });
  const result = applyElementDeleteToAnchors([anchor], "sl-1", "el-deleted");
  assert.equal(result[0], anchor);
});

test("applyElementDeleteToAnchors does not mutate the input array", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-deleted",
  });
  const records: readonly SlideCommentAnchor[] = [anchor];
  applyElementDeleteToAnchors(records, "sl-1", "el-deleted");
  assert.equal(records[0].elementId, "el-deleted");
});

// ---------------------------------------------------------------------------
// findOrphanedAnchors
// ---------------------------------------------------------------------------

test("findOrphanedAnchors returns anchors whose slide no longer exists in the deck", () => {
  const orphaned = buildSlideCommentAnchor({
    slideId: "sl-deleted",
    elementId: null,
  });
  const attached: SlideCommentAnchor = { slideId: "sl-1" };
  const deck = buildDeck([{ id: "sl-1" }]);

  const result = findOrphanedAnchors([orphaned, attached], deck);
  assert.equal(result.length, 1);
  assert.equal(result[0], orphaned);
});

test("findOrphanedAnchors returns anchors whose element no longer exists in the slide", () => {
  const orphaned = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-missing",
  });
  const deck = buildDeck([{ id: "sl-1", elementIds: ["el-1"] }]);

  const result = findOrphanedAnchors([orphaned], deck);
  assert.equal(result.length, 1);
});

test("findOrphanedAnchors skips deck-level anchors (no slideId)", () => {
  const deckLevel: SlideCommentAnchor = {};
  const deck = buildDeck([{ id: "sl-1" }]);

  const result = findOrphanedAnchors([deckLevel], deck);
  assert.equal(result.length, 0);
});

test("findOrphanedAnchors skips properly attached anchors", () => {
  const attached = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-1",
  });
  const deck = buildDeck([{ id: "sl-1", elementIds: ["el-1"] }]);

  const result = findOrphanedAnchors([attached], deck);
  assert.equal(result.length, 0);
});

test("findOrphanedAnchors returns empty array when all anchors are valid", () => {
  const deck = buildDeck([{ id: "sl-1", elementIds: ["el-a", "el-b"] }]);
  const records: SlideCommentAnchor[] = [
    { slideId: "sl-1", elementId: "el-a" },
    { slideId: "sl-1", elementId: "el-b" },
    { slideId: "sl-1" },
    {},
  ];
  const result = findOrphanedAnchors(records, deck);
  assert.deepEqual(result, []);
});

test("planSlideCommentAnchorRepairs preserves slide attachment for missing elements", () => {
  const deck = buildDeck([{ id: "sl-1", elementIds: ["el-kept"] }]);

  assert.deepEqual(
    planSlideCommentAnchorRepairs(
      [
        { id: "missing-slide", slideId: "sl-gone", elementId: null },
        {
          id: "missing-element",
          slideId: "sl-1",
          elementId: "el-gone",
        },
        { id: "attached", slideId: "sl-1", elementId: "el-kept" },
      ],
      deck,
    ),
    {
      floatToDeckIds: ["missing-slide"],
      floatToSlideIds: ["missing-element"],
    },
  );
});
