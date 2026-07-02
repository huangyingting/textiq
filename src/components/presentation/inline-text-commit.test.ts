import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TextNode } from "@/lib/presentation/schema";
import {
  buildDeck,
  buildSlide,
  buildTextNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

import { applyInlineTextCommit } from "./inline-text-commit";

describe("applyInlineTextCommit", () => {
  test("persists align + frame updates for text nodes", () => {
    resetBuilderCounter();
    const textNode = buildTextNode();
    const slide = buildSlide("content", [textNode]);
    const deck = buildDeck([slide]);

    const updated = applyInlineTextCommit({
      deck,
      slideId: slide.id,
      node: textNode,
      paragraphs: [{ id: "p-1", text: "Aligned text" }],
      nextFrame: { x: 20, y: 22, w: 44, h: 12 },
      textAlign: "center",
    });

    const committed = updated.slides[0].children[0] as TextNode;
    assert.equal(committed.content.paragraphs[0]?.text, "Aligned text");
    assert.ok(committed.layout);
    assert.deepEqual(committed.layout.frame, { x: 20, y: 22, w: 44, h: 12 });
    assert.equal(committed.localStyle?.text?.align, "center");
  });

  test("does not touch text align when no align command was committed", () => {
    resetBuilderCounter();
    const textNode = buildTextNode({
      localStyle: { text: { align: "left" } },
    });
    const slide = buildSlide("content", [textNode]);
    const deck = buildDeck([slide]);

    const updated = applyInlineTextCommit({
      deck,
      slideId: slide.id,
      node: textNode,
      paragraphs: [{ id: "p-1", text: "No align change" }],
    });

    const committed = updated.slides[0].children[0] as TextNode;
    assert.equal(committed.content.paragraphs[0]?.text, "No align change");
    assert.equal(committed.localStyle?.text?.align, "left");
  });
});
