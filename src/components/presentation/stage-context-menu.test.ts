import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SlideChildNode } from "@/lib/presentation/schema";
import { hitTestSlideNodes } from "@/lib/presentation/stage-hit-test";

import {
  nextUnlockedContextLayerId,
  overlapContextLayers,
  selectableContextLayers,
} from "./stage-context-menu";

function textNode(
  id: string,
  options: Pick<SlideChildNode, "locked" | "hidden"> = {},
): SlideChildNode {
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex: 1 },
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p`, text: id }] },
    ...options,
  };
}

describe("stage overlap context command", () => {
  test("cycles in hit-stack order, wraps, and skips locked or hidden layers", () => {
    const candidates = [
      textNode("top"),
      textNode("locked", { locked: true }),
      textNode("hidden", { hidden: true }),
      textNode("bottom"),
    ];

    assert.equal(nextUnlockedContextLayerId(candidates, "top"), "bottom");
    assert.equal(nextUnlockedContextLayerId(candidates, "bottom"), "top");
    assert.deepEqual(
      selectableContextLayers(candidates).map((candidate) => candidate.id),
      ["top", "bottom"],
    );
  });

  test("resets to the top layer when the current selection is outside the stack", () => {
    assert.equal(
      nextUnlockedContextLayerId(
        [textNode("new-top"), textNode("new-bottom")],
        "old-selection",
      ),
      "new-top",
    );
  });

  test("omits descendants of hidden groups from overlap context candidates", () => {
    const hiddenGroup: SlideChildNode = {
      id: "hidden-group",
      type: "group",
      component: "custom",
      hidden: true,
      layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex: 2 },
      children: [textNode("visible-child")],
    };
    const visible = textNode("visible");
    const candidates = hitTestSlideNodes(
      { x: 1, y: 1 },
      [hiddenGroup, visible],
      { order: "visual" },
    ).map((candidate) => candidate.node);

    assert.deepEqual(
      selectableContextLayers(candidates).map((candidate) => candidate.id),
      ["visible"],
    );
    assert.deepEqual(overlapContextLayers(candidates), []);
  });
});
