import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Deck } from "@/lib/presentation/schema";

import {
  findSlideIndexForFocus,
  focusStageNode,
} from "./use-stage-focus-controller";

type StageFocusRegistry = Parameters<typeof focusStageNode>[0];

function deckFixture(value: unknown): Deck {
  return value as unknown as Deck;
}

function stageFocusRegistry(value: unknown): StageFocusRegistry {
  return value as unknown as StageFocusRegistry;
}

const deck = deckFixture({
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
});

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
    stageFocusRegistry({
      focus: (target: unknown) => {
        focused.push(target);
      },
    }),
    "node-1",
  );

  assert.deepEqual(focused, ["stage:node:node-1"]);
});
