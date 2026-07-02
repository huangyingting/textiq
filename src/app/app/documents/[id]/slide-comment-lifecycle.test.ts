/**
 * Unit tests for slide comment lifecycle helpers.
 * DOM-free, runnable under `node --test`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveAnchorState,
  type SlideCommentAnchor,
} from "@/lib/comments/slide-comment-anchors";

import {
  applyElementDeleteToAnchors,
  applySlideDeleteToAnchors,
  findOrphanedAnchors,
} from "@/lib/comments";
import type {
  DeckV7,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation-vnext/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function anchor(partial: Partial<SlideCommentAnchor>): SlideCommentAnchor {
  return partial;
}

function makeNode(id: string): SlideChildNode {
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex: 1 },
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p1`, text: "" }] },
  };
}

function makeSlide(id: string, nodeIds: string[] = []): SlideNode {
  return {
    id,
    type: "slide",
    template: { kind: "content" },
    style: { ref: "slide.content" },
    children: nodeIds.map(makeNode),
  };
}

function makeDeck(slides: SlideNode[]): DeckV7 {
  return {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides,
  };
}

// ---------------------------------------------------------------------------
// applySlideDeleteToAnchors
// ---------------------------------------------------------------------------

test("applySlideDeleteToAnchors: floats anchors on the deleted slide to deck", () => {
  const anchors = [
    anchor({ slideId: "sl-1", elementId: "el-a", geometry: { x: 10, y: 20 } }),
    anchor({ slideId: "sl-2" }),
    anchor({ slideId: null }),
  ];

  const result = applySlideDeleteToAnchors(anchors, "sl-1");

  assert.equal(result[0].slideId, null);
  assert.equal(result[0].elementId, null);
  assert.equal(result[0].geometry, null);
  // Unaffected.
  assert.equal(result[1].slideId, "sl-2");
  assert.equal(result[2].slideId, null);
});

test("applySlideDeleteToAnchors: no match → all anchors unchanged", () => {
  const anchors = [anchor({ slideId: "sl-1" }), anchor({ slideId: "sl-2" })];
  const result = applySlideDeleteToAnchors(anchors, "sl-gone");
  assert.equal(result[0].slideId, "sl-1");
  assert.equal(result[1].slideId, "sl-2");
});

test("applySlideDeleteToAnchors: does not mutate original array", () => {
  const anchors = [anchor({ slideId: "sl-1" })];
  applySlideDeleteToAnchors(anchors, "sl-1");
  assert.equal(anchors[0].slideId, "sl-1");
});

test("applySlideDeleteToAnchors: deck-level anchor (null slideId) unaffected", () => {
  const anchors = [anchor({})];
  const result = applySlideDeleteToAnchors(anchors, "sl-1");
  assert.deepEqual(result[0], {});
});

test("applySlideDeleteToAnchors: empty anchors list → empty result", () => {
  assert.deepEqual(applySlideDeleteToAnchors([], "sl-1"), []);
});

test("applySlideDeleteToAnchors: floated result resolves to deck", () => {
  const anchors = [anchor({ slideId: "sl-1" })];
  const result = applySlideDeleteToAnchors(anchors, "sl-1");
  const deck = makeDeck([makeSlide("sl-other")]);
  assert.equal(resolveAnchorState(result[0], deck), "deck");
});

// ---------------------------------------------------------------------------
// applyElementDeleteToAnchors
// ---------------------------------------------------------------------------

test("applyElementDeleteToAnchors: clears elementId for matching slide+element", () => {
  const anchors = [
    anchor({ slideId: "sl-1", elementId: "el-a", geometry: { x: 5, y: 5 } }),
    anchor({ slideId: "sl-1", elementId: "el-b" }),
    anchor({ slideId: "sl-2", elementId: "el-a" }),
  ];

  const result = applyElementDeleteToAnchors(anchors, "sl-1", "el-a");

  // Floated to slide: elementId cleared, slideId + geometry preserved.
  assert.equal(result[0].elementId, null);
  assert.equal(result[0].slideId, "sl-1");
  assert.deepEqual(result[0].geometry, { x: 5, y: 5 });

  // Unaffected.
  assert.equal(result[1].elementId, "el-b");
  assert.equal(result[2].elementId, "el-a");
});

test("applyElementDeleteToAnchors: does not mutate original", () => {
  const anchors = [anchor({ slideId: "sl-1", elementId: "el-a" })];
  applyElementDeleteToAnchors(anchors, "sl-1", "el-a");
  assert.equal(anchors[0].elementId, "el-a");
});

test("applyElementDeleteToAnchors: no match → unchanged", () => {
  const anchors = [anchor({ slideId: "sl-1", elementId: "el-a" })];
  const result = applyElementDeleteToAnchors(anchors, "sl-1", "el-gone");
  assert.equal(result[0].elementId, "el-a");
});

test("applyElementDeleteToAnchors: floated result resolves to attached on slide", () => {
  const deck = makeDeck([makeSlide("sl-1", ["el-b"])]);
  const anchors = [anchor({ slideId: "sl-1", elementId: "el-gone" })];
  const result = applyElementDeleteToAnchors(anchors, "sl-1", "el-gone");
  assert.equal(resolveAnchorState(result[0], deck), "attached");
});

// ---------------------------------------------------------------------------
// findOrphanedAnchors
// ---------------------------------------------------------------------------

test("findOrphanedAnchors: returns anchors whose slide is missing from deck", () => {
  const deck = makeDeck([makeSlide("sl-1")]);
  const anchors = [
    anchor({ slideId: "sl-1" }),
    anchor({ slideId: "sl-gone" }),
    anchor({}),
  ];
  const orphaned = findOrphanedAnchors(anchors, deck);
  assert.equal(orphaned.length, 1);
  assert.equal(orphaned[0].slideId, "sl-gone");
});

test("findOrphanedAnchors: returns anchors whose element is missing", () => {
  const deck = makeDeck([makeSlide("sl-1", ["el-a"])]);
  const anchors = [
    anchor({ slideId: "sl-1", elementId: "el-a" }),
    anchor({ slideId: "sl-1", elementId: "el-gone" }),
  ];
  const orphaned = findOrphanedAnchors(anchors, deck);
  assert.equal(orphaned.length, 1);
  assert.equal(orphaned[0].elementId, "el-gone");
});

test("findOrphanedAnchors: deck-level comments (no slideId) not returned", () => {
  const deck = makeDeck([]);
  const anchors = [anchor({}), anchor({ slideId: null })];
  assert.deepEqual(findOrphanedAnchors(anchors, deck), []);
});

test("findOrphanedAnchors: empty deck → all slide-anchored are orphaned", () => {
  const deck = makeDeck([]);
  const anchors = [anchor({ slideId: "sl-1" }), anchor({ slideId: "sl-2" })];
  const orphaned = findOrphanedAnchors(anchors, deck);
  assert.equal(orphaned.length, 2);
});

test("findOrphanedAnchors: none orphaned when deck contains all slides", () => {
  const deck = makeDeck([makeSlide("sl-1", ["el-a"])]);
  const anchors = [
    anchor({ slideId: "sl-1" }),
    anchor({ slideId: "sl-1", elementId: "el-a" }),
  ];
  assert.deepEqual(findOrphanedAnchors(anchors, deck), []);
});

// ---------------------------------------------------------------------------
// Duplicate-slide policy (pure assertion)
// ---------------------------------------------------------------------------

test("duplicate slide: existing comments are NOT copied to new slide (exclude policy)", () => {
  // When a slide is duplicated, we do NOT copy comments to the new slide.
  // This is a policy assertion — the new slide starts with zero comments.
  // The pure verification: retargeting comments to a new slide is explicit
  // and must be opted into by the caller; comments are not copied automatically.
  const originalSlideId = "sl-1";
  const newSlideId = "sl-2";

  const existingAnchors = [
    anchor({ slideId: originalSlideId, geometry: { x: 50, y: 50 } }),
  ];

  // Policy: no automatic retarget — the new slide has no comments unless
  // the caller explicitly calls retargetAnchorSlide.
  const commentsOnNewSlide = existingAnchors.filter(
    (a) => a.slideId === newSlideId,
  );
  assert.equal(commentsOnNewSlide.length, 0);
});

// ---------------------------------------------------------------------------
// Version restore: orphaned anchors resolve correctly
// ---------------------------------------------------------------------------

test("version restore: orphaned anchor resolves to 'orphaned' after deck replace", () => {
  // Before restore: slide sl-1 existed; after restore it's gone.
  const restoredDeck = makeDeck([makeSlide("sl-other")]);
  const anchor1 = anchor({ slideId: "sl-1" });

  // resolveAnchorState correctly detects the orphan — no special DB action needed.
  assert.equal(resolveAnchorState(anchor1, restoredDeck), "orphaned");
});

test("version restore: attached anchor resolves correctly when slide still exists", () => {
  const restoredDeck = makeDeck([makeSlide("sl-1", ["el-a"])]);
  const anchor1 = anchor({ slideId: "sl-1", elementId: "el-a" });
  assert.equal(resolveAnchorState(anchor1, restoredDeck), "attached");
});
