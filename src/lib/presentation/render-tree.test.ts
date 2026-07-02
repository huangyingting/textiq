import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSlideRenderLists,
  getSlideRenderLists,
  type ResolvedRenderNode,
  type ResolvedSlideRenderTree,
} from "./render-tree";

function textNode(
  id: string,
  zIndex: number,
  source: ResolvedRenderNode["source"] = "user",
): ResolvedRenderNode {
  return {
    id,
    type: "text",
    layout: { frame: { x: 0, y: 0, w: 10, h: 5 }, zIndex },
    style: {},
    content: {
      type: "text",
      content: { paragraphs: [{ id: `${id}-p0`, text: id }] },
    },
    source,
  };
}

function groupNode(
  id: string,
  zIndex: number,
  children: ResolvedRenderNode[],
  source: ResolvedRenderNode["source"] = "user",
): ResolvedRenderNode {
  return {
    id,
    type: "group",
    layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex },
    style: {},
    content: { type: "group" },
    children,
    source,
  };
}

function slide(
  options: Partial<ResolvedSlideRenderTree> = {},
): ResolvedSlideRenderTree {
  return {
    id: "slide-under-test",
    background: { fill: undefined, decorationLevel: "default" },
    decorations: [],
    chrome: [],
    nodes: [],
    ...options,
  };
}

describe("render-tree render-list derivation", () => {
  test("buildSlideRenderLists flattens groups and preserves layer ordering", () => {
    const renderLists = buildSlideRenderLists({
      decorations: [
        groupNode(
          "decoration-group",
          -50,
          [textNode("decoration-child", -40, "themeDecoration")],
          "themeDecoration",
        ),
      ],
      chrome: [
        textNode("chrome-foreground-high", 920, "deckChrome"),
        groupNode(
          "chrome-group",
          905,
          [textNode("chrome-group-child", 905, "deckChrome")],
          "deckChrome",
        ),
        textNode("chrome-background", -20, "deckChrome"),
        textNode("chrome-foreground-low", 900, "deckChrome"),
      ],
      nodes: [
        textNode("user-back", 1),
        groupNode("user-group", 2, [
          textNode("user-child-a", 3),
          textNode("user-child-b", 4),
        ]),
      ],
    });

    assert.deepEqual(
      renderLists.decorations.map((node) => node.id),
      ["decoration-group", "decoration-child"],
    );
    assert.deepEqual(
      renderLists.backgroundChrome.map((node) => node.id),
      ["chrome-background"],
    );
    assert.deepEqual(
      renderLists.foregroundChrome.map((node) => node.id),
      [
        "chrome-foreground-low",
        "chrome-group",
        "chrome-group-child",
        "chrome-foreground-high",
      ],
    );
    assert.deepEqual(
      renderLists.userNodes.map((node) => node.id),
      ["user-back", "user-group", "user-child-a", "user-child-b"],
    );
  });

  test("getSlideRenderLists memoizes derived lists and reuses precomputed lists", () => {
    const baseSlide = slide({
      nodes: [textNode("memo-node", 1)],
      chrome: [textNode("memo-chrome", 900, "deckChrome")],
      decorations: [textNode("memo-decoration", -80, "themeDecoration")],
    });

    const first = getSlideRenderLists(baseSlide);
    const second = getSlideRenderLists(baseSlide);
    assert.equal(first, second);

    const precomputed = buildSlideRenderLists(baseSlide);
    const precomputedSlide = slide({
      ...baseSlide,
      renderLists: precomputed,
      nodes: [textNode("should-not-be-used", 99)],
    });

    assert.equal(getSlideRenderLists(precomputedSlide), precomputed);
  });
});
