import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildDeck,
  buildShapeNode,
  buildSlide,
  buildTextNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

import { diffDeckNodes, pickUndoFocusTarget } from "./deck-diff";

describe("deck-diff undo/redo focus targeting", () => {
  test("selects changed nodes before slide fallbacks", () => {
    resetBuilderCounter();
    const node = buildTextNode({ id: "text-1" });
    const before = buildDeck([buildSlide("content", [node])]);
    const after = {
      ...before,
      slides: [
        {
          ...before.slides[0],
          children: [
            {
              ...node,
              content: {
                paragraphs: [{ id: "text-1-p-1", text: "Changed" }],
              },
            },
          ],
        },
      ],
    };

    const diff = diffDeckNodes(before, after);
    assert.deepEqual(diff.changed, ["text-1"]);
    assert.equal(pickUndoFocusTarget(before, after), "text-1");
  });

  test("selects newly restored nodes after undo", () => {
    resetBuilderCounter();
    const before = buildDeck([
      buildSlide("content", [buildTextNode({ id: "text-1" })]),
    ]);
    const after = {
      ...before,
      slides: [
        {
          ...before.slides[0],
          children: [
            ...before.slides[0].children,
            buildShapeNode({ id: "shape-1" }),
          ],
        },
      ],
    };

    assert.equal(pickUndoFocusTarget(before, after), "shape-1");
  });

  test("falls back to owning slide when a node is removed", () => {
    resetBuilderCounter();
    const before = buildDeck([
      buildSlide("content", [buildTextNode({ id: "text-1" })], {
        id: "slide-1",
      }),
    ]);
    const after = {
      ...before,
      slides: [{ ...before.slides[0], children: [] }],
    };

    assert.equal(pickUndoFocusTarget(before, after), "slide-1");
  });

  test("falls back to a stable slide when a slide is removed", () => {
    resetBuilderCounter();
    const before = buildDeck([
      buildSlide("cover", [], { id: "slide-1" }),
      buildSlide("content", [], { id: "slide-2" }),
    ]);
    const after = { ...before, slides: [before.slides[1]] };

    assert.equal(pickUndoFocusTarget(before, after), "slide-2");
  });
});
