/**
 * Editor command text tests.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  updateLocalStyle,
  resetLocalStyleOverride,
  groupNodes,
  updateNodeContent,
} from "@/lib/presentation/editor-commands";
import type {
  GroupNode,
  SlideChildNode,
  TextNode,
} from "@/lib/presentation/schema";
import { makeTestDeck } from "./editor-commands.test-utils";

function textNode(node: SlideChildNode | undefined): TextNode {
  assert.equal(node?.type, "text");
  return node;
}

function expectGroupNode(node: SlideChildNode | undefined): GroupNode {
  assert.equal(node?.type, "group");
  return node;
}

describe("updateLocalStyle", () => {
  test("adds local style override to node", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = updateLocalStyle(deck, slide.id, nodeId, {
      text: { fontSizePt: 44, color: "#ff0000" },
    });
    const node = updated.slides[0].children.find((n) => n.id === nodeId);
    assert.equal(node?.localStyle?.text?.fontSizePt, 44);
    assert.equal(node?.localStyle?.text?.color, "#ff0000");
  });

  test("merges with existing local style", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const step1 = updateLocalStyle(deck, slide.id, nodeId, {
      text: { fontSizePt: 44 },
    });
    const step2 = updateLocalStyle(step1, slide.id, nodeId, {
      text: { italic: true },
    });
    const node = step2.slides[0].children.find((n) => n.id === nodeId);
    assert.equal(node?.localStyle?.text?.fontSizePt, 44);
    assert.equal(node?.localStyle?.text?.italic, true);
  });
});

describe("resetLocalStyleOverride", () => {
  test("removes all local styles when no keys specified", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const withLocal = updateLocalStyle(deck, slide.id, nodeId, {
      text: { fontSizePt: 44 },
    });
    const reset = resetLocalStyleOverride(withLocal, slide.id, nodeId);
    const node = reset.slides[0].children.find((n) => n.id === nodeId);
    assert.equal(node?.localStyle, undefined);
  });

  test("removes only specified keys", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const withLocal = updateLocalStyle(deck, slide.id, nodeId, {
      text: { fontSizePt: 44 },
      fill: { type: "solid", color: "#ff0000" },
    });
    const reset = resetLocalStyleOverride(withLocal, slide.id, nodeId, [
      "fill",
    ]);
    const node = reset.slides[0].children.find((n) => n.id === nodeId);
    assert.equal(
      node?.localStyle?.text?.fontSizePt,
      44,
      "text override should remain",
    );
    assert.equal(
      node?.localStyle?.fill,
      undefined,
      "fill override should be removed",
    );
  });
});

describe("updateNodeContent", () => {
  test("patches content on the target node", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = updateNodeContent(deck, slide.id, nodeId, {
      paragraphs: [{ id: "p1", text: "Updated" }],
    });
    const node = updated.slides[0].children.find((n) => n.id === nodeId);
    assert.deepEqual(textNode(node).content.paragraphs, [
      { id: "p1", text: "Updated" },
    ]);
  });

  test("does not modify other slides", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = updateNodeContent(deck, slide.id, nodeId, { foo: "bar" });
    assert.strictEqual(updated.slides[1], deck.slides[1]);
  });
});

describe("updateLocalStyle inside group child", () => {
  test("updates local style on a node nested inside a group", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeIds = slide.children.map((n) => n.id);
    const grouped = groupNodes(deck, slide.id, nodeIds, "grp-001", {
      ref: "surface.card",
    });
    const groupNode = grouped.slides[0].children.find(
      (n) => n.id === "grp-001",
    )!;
    const innerNodeId = expectGroupNode(groupNode).children[0]!.id;
    const updated = updateLocalStyle(grouped, slide.id, innerNodeId, {
      text: { fontSizePt: 44 },
    });
    const updatedGroup = updated.slides[0].children.find(
      (n) => n.id === "grp-001",
    );
    const innerNode = expectGroupNode(updatedGroup).children.find(
      (n) => n.id === innerNodeId,
    );
    assert.equal(innerNode?.localStyle?.text?.fontSizePt, 44);
  });
});

describe("updateLocalStyle deep merge", () => {
  test("deep-merges nested style objects when base and patch share top-level key", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const step1 = updateLocalStyle(deck, slide.id, nodeId, {
      text: { fontSizePt: 44 },
    });
    const step2 = updateLocalStyle(step1, slide.id, nodeId, {
      text: { italic: true, color: "#ff0000" },
    });
    const node = step2.slides[0].children.find((n) => n.id === nodeId);
    assert.equal(node?.localStyle?.text?.fontSizePt, 44);
    assert.equal(node?.localStyle?.text?.italic, true);
    assert.equal(node?.localStyle?.text?.color, "#ff0000");
  });

  test("preserves existing nested connector stroke fields across toolbar patches", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const step1 = updateLocalStyle(deck, slide.id, nodeId, {
      connector: {
        stroke: { color: "#334155", widthPt: 1.5, dash: "dotted" },
      },
    });
    const step2 = updateLocalStyle(step1, slide.id, nodeId, {
      connector: { stroke: { color: "#ef4444", widthPt: 2 } },
    });
    const node = step2.slides[0].children.find((n) => n.id === nodeId);

    assert.equal(node?.localStyle?.connector?.stroke?.color, "#ef4444");
    assert.equal(node?.localStyle?.connector?.stroke?.widthPt, 2);
    assert.equal(node?.localStyle?.connector?.stroke?.dash, "dotted");
  });

  test("preserves sibling visual channel colors across sequential patches", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const step1 = updateLocalStyle(deck, slide.id, nodeId, {
      visual: {
        channelColors: {
          primary: "#2563eb",
          secondary: "#f59e0b",
          tertiary: "#10b981",
        },
      },
    });
    const step2 = updateLocalStyle(step1, slide.id, nodeId, {
      visual: { channelColors: { primary: "#7c3aed" } },
    });
    const node = step2.slides[0].children.find((n) => n.id === nodeId);

    assert.deepEqual(node?.localStyle?.visual?.channelColors, {
      primary: "#7c3aed",
      secondary: "#f59e0b",
      tertiary: "#10b981",
    });
  });
});

describe("updateNodeContent — inline text editor commit", () => {
  test("commits multi-paragraph content from inline editor", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const textNodeId = slide.children.find((n) => n.type === "text")!.id;
    const paragraphs = [
      { id: "p1", text: "Updated first paragraph" },
      { id: "p2", text: "Updated second paragraph" },
    ];
    const updated = updateNodeContent(deck, slide.id, textNodeId, {
      paragraphs,
    });
    const node = updated.slides[0].children.find((n) => n.id === textNodeId);
    assert.deepEqual(textNode(node).content.paragraphs, paragraphs);
  });

  test("preserves other content fields when patching paragraphs", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const textNodeId = slide.children.find((n) => n.type === "text")!.id;
    // First, add a fit field
    const withFit = updateNodeContent(deck, slide.id, textNodeId, {
      fit: "shrink-to-fit",
    });
    // Now commit paragraph content
    const committed = updateNodeContent(withFit, slide.id, textNodeId, {
      paragraphs: [{ id: "p1", text: "New text" }],
    });
    const node = committed.slides[0].children.find((n) => n.id === textNodeId);
    assert.equal(textNode(node).content.fit, "shrink-to-fit");
    assert.equal(textNode(node).content.paragraphs?.[0]?.text, "New text");
  });

  test("does not mutate original deck on commit", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const originalContent = textNode(slide.children[0]).content;
    updateNodeContent(deck, slide.id, nodeId, {
      paragraphs: [{ id: "p-new", text: "mutate check" }],
    });
    // Original content must be unchanged
    assert.deepEqual(
      textNode(deck.slides[0].children[0]).content,
      originalContent,
    );
  });
});

describe("updateLocalStyle — toolbar-driven style patches", () => {
  test("applies color from text color picker", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = updateLocalStyle(deck, slide.id, nodeId, {
      text: { color: "#cc3344" },
    });
    const node = updated.slides[0].children.find((n) => n.id === nodeId);
    assert.equal(node?.localStyle?.text?.color, "#cc3344");
  });

  test("applies font size from font size picker", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = updateLocalStyle(deck, slide.id, nodeId, {
      text: { fontSizePt: 28 },
    });
    const node = updated.slides[0].children.find((n) => n.id === nodeId);
    assert.equal(node?.localStyle?.text?.fontSizePt, 28);
  });

  test("applies fill color from shape fill picker", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = updateLocalStyle(deck, slide.id, nodeId, {
      fill: { type: "solid", color: "#abcdef" },
    });
    const node = updated.slides[0].children.find((n) => n.id === nodeId);
    const fill = node?.localStyle?.fill;
    assert.equal(fill?.type, "solid");
    assert.equal(fill?.color, "#abcdef");
  });

  test("replaces local style keys when patch value is primitive or undefined", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const withLocal = updateLocalStyle(deck, slide.id, nodeId, {
      opacity: 0.5,
      shadow: { xPt: 0, yPt: 1, blurPt: 8, color: "#000000" },
    });
    const updated = updateLocalStyle(withLocal, slide.id, nodeId, {
      opacity: undefined,
      shadow: undefined,
    });
    const node = updated.slides[0].children.find((n) => n.id === nodeId);

    assert.equal(node?.localStyle?.opacity, undefined);
    assert.equal(node?.localStyle?.shadow, undefined);
    assert.ok("opacity" in (node?.localStyle ?? {}));
  });

  test("sequential toolbar commands accumulate style overrides", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const step1 = updateLocalStyle(deck, slide.id, nodeId, {
      text: { fontSizePt: 24 },
    });
    const step2 = updateLocalStyle(step1, slide.id, nodeId, {
      text: { color: "#ff0000" },
    });
    const node = step2.slides[0].children.find((n) => n.id === nodeId);
    assert.equal(node?.localStyle?.text?.fontSizePt, 24);
    assert.equal(node?.localStyle?.text?.color, "#ff0000");
  });
});
