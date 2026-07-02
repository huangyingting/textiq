import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Deck } from "@/lib/presentation/schema";

import {
  findSlideIndexForFocus,
  focusStageNode,
} from "./use-stage-focus-controller";

const deck = {
  schemaVersion: 7,
  canvas: { format: "16:9", width: 16, height: 9, unit: "percent" },
  theme: { packageId: "neutral" },
  assets: { images: {} },
  slides: [
    {
      id: "slide-a",
      type: "slide",
      template: { kind: "blank" },
      children: [
        {
          id: "group-a",
          type: "group",
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 } },
          children: [
            {
              id: "nested-text",
              type: "text",
              layout: { frame: { x: 1, y: 1, w: 8, h: 8 } },
              content: { paragraphs: [{ id: "p", text: "Nested" }] },
            },
          ],
        },
      ],
    },
    {
      id: "slide-b",
      type: "slide",
      template: { kind: "blank" },
      children: [],
    },
  ],
} as unknown as Deck;

describe("findSlideIndexForFocus", () => {
  test("finds nested group children before falling back to slide ids", () => {
    assert.equal(findSlideIndexForFocus(deck, "nested-text"), 0);
    assert.equal(findSlideIndexForFocus(deck, "slide-b"), 1);
  });

  test("returns -1 for removed focus targets", () => {
    assert.equal(findSlideIndexForFocus(deck, "missing-node"), -1);
  });
});

test("focusStageNode delegates to the focus geometry registry target", () => {
  const focused: unknown[] = [];
  focusStageNode(
    {
      focus: (target: unknown) => {
        focused.push(target);
      },
    } as unknown as Parameters<typeof focusStageNode>[0],
    "node-1",
  );

  assert.deepEqual(focused, ["stage:node:node-1"]);
});
