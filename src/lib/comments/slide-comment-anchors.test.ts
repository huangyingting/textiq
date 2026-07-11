import assert from "node:assert/strict";
import { test } from "node:test";

import {
  floatAnchorToDeck,
  floatAnchorToSlide,
  resolveAnchorState,
  type SlideCommentAnchor,
} from "./slide-comment-anchors";
import type { Deck } from "@/lib/presentation/schema";
import { buildSlideCommentAnchor } from "@/test/builders/comments";

// ---------------------------------------------------------------------------
// Minimal deck builder
// ---------------------------------------------------------------------------

type ElementSpec = { id: string; groupChildren?: ElementSpec[] };

function buildDeck(
  slides: Array<{ id: string; elements?: ElementSpec[] }>,
): Deck {
  return {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides: slides.map(({ id, elements = [] }) => ({
      id,
      type: "slide",
      template: { kind: "content" },
      style: { ref: "slide.content" },
      children: elements.map((el) => buildNode(el)),
    })),
  } as never;
}

function buildNode(el: ElementSpec): never {
  if (el.groupChildren) {
    return {
      id: el.id,
      type: "group",
      component: "generic",
      style: { ref: "group.generic" },
      children: el.groupChildren.map((child) => buildNode(child)),
    } as never;
  }
  return {
    id: el.id,
    type: "text",
    role: "body",
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${el.id}-p1`, text: "" }] },
  } as never;
}

// ---------------------------------------------------------------------------
// resolveAnchorState
// ---------------------------------------------------------------------------

test("resolveAnchorState returns 'deck' when anchor has no slideId", () => {
  const anchor: SlideCommentAnchor = {};
  assert.equal(resolveAnchorState(anchor, buildDeck([{ id: "sl-1" }])), "deck");
});

test("resolveAnchorState returns 'deck' when slideId is null", () => {
  const anchor: SlideCommentAnchor = { slideId: null };
  assert.equal(resolveAnchorState(anchor, buildDeck([{ id: "sl-1" }])), "deck");
});

test("resolveAnchorState returns 'unknown' when slideId is present but deck is null", () => {
  const anchor = buildSlideCommentAnchor({ slideId: "sl-1" });
  assert.equal(resolveAnchorState(anchor, null), "unknown");
});

test("resolveAnchorState returns 'unknown' when slideId is present but deck is undefined", () => {
  const anchor = buildSlideCommentAnchor({ slideId: "sl-1" });
  assert.equal(resolveAnchorState(anchor, undefined), "unknown");
});

test("resolveAnchorState returns 'orphaned' when slide is not found in deck", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "missing-slide",
    elementId: null,
  });
  const deck = buildDeck([{ id: "sl-1" }]);
  assert.equal(resolveAnchorState(anchor, deck), "orphaned");
});

test("resolveAnchorState returns 'attached' when slide is found and no elementId", () => {
  const anchor: SlideCommentAnchor = { slideId: "sl-1" };
  const deck = buildDeck([{ id: "sl-1" }]);
  assert.equal(resolveAnchorState(anchor, deck), "attached");
});

test("resolveAnchorState returns 'attached' when slide is found and elementId is null", () => {
  const anchor: SlideCommentAnchor = { slideId: "sl-1", elementId: null };
  const deck = buildDeck([{ id: "sl-1", elements: [{ id: "el-1" }] }]);
  assert.equal(resolveAnchorState(anchor, deck), "attached");
});

test("resolveAnchorState returns 'attached' when slide and element are both found", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-1",
  });
  const deck = buildDeck([{ id: "sl-1", elements: [{ id: "el-1" }] }]);
  assert.equal(resolveAnchorState(anchor, deck), "attached");
});

test("resolveAnchorState returns 'orphaned' when elementId is absent from slide children", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "missing-el",
  });
  const deck = buildDeck([{ id: "sl-1", elements: [{ id: "el-1" }] }]);
  assert.equal(resolveAnchorState(anchor, deck), "orphaned");
});

test("resolveAnchorState returns 'attached' when elementId is nested inside a group node", () => {
  const anchor = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "nested-el",
  });
  const deck = buildDeck([
    {
      id: "sl-1",
      elements: [
        {
          id: "group-1",
          groupChildren: [{ id: "nested-el" }],
        },
      ],
    },
  ]);
  assert.equal(resolveAnchorState(anchor, deck), "attached");
});

// ---------------------------------------------------------------------------
// floatAnchorToDeck
// ---------------------------------------------------------------------------

test("floatAnchorToDeck clears slideId, elementId, and geometry", () => {
  const original = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-1",
    geometry: { x: 10, y: 20 },
  });
  const result = floatAnchorToDeck(original);
  assert.equal(result.slideId, null);
  assert.equal(result.elementId, null);
  assert.equal(result.geometry, null);
});

test("floatAnchorToDeck does not mutate the original anchor", () => {
  const original = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-1",
    geometry: { x: 10, y: 20 },
  });
  floatAnchorToDeck(original);
  assert.equal(original.slideId, "sl-1");
  assert.equal(original.elementId, "el-1");
  assert.deepEqual(original.geometry, { x: 10, y: 20 });
});

// ---------------------------------------------------------------------------
// floatAnchorToSlide
// ---------------------------------------------------------------------------

test("floatAnchorToSlide clears elementId and preserves slideId", () => {
  const original = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-1",
    geometry: { x: 30, y: 40 },
  });
  const result = floatAnchorToSlide(original);
  assert.equal(result.slideId, "sl-1");
  assert.equal(result.elementId, null);
  assert.deepEqual(result.geometry, { x: 30, y: 40 });
});

test("floatAnchorToSlide does not mutate the original anchor", () => {
  const original = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-1",
    geometry: { x: 30, y: 40 },
  });
  floatAnchorToSlide(original);
  assert.equal(original.elementId, "el-1");
});
