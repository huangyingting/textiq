import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  collectMovePreviewFrames,
  topLevelSelectedNodeIds,
} from "./use-stage-gesture-controller";
import type { SlideChildNode } from "@/lib/presentation/schema";

const frame = { x: 0, y: 0, w: 10, h: 10 };

function textNode(id: string): SlideChildNode {
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame, zIndex: 1 },
    content: { paragraphs: [{ id: `${id}-p`, text: id }] },
  };
}

describe("stage gesture controller helpers", () => {
  test("returns only top-level selected nodes when a selected group contains selected children", () => {
    const nodes: SlideChildNode[] = [
      textNode("outside"),
      {
        id: "group-a",
        type: "group",
        component: "custom",
        layout: { frame, zIndex: 2 },
        children: [textNode("child-a"), textNode("child-b")],
      },
    ];

    assert.deepEqual(
      topLevelSelectedNodeIds(
        nodes,
        new Set(["outside", "group-a", "child-a", "child-b"]),
      ),
      ["outside", "group-a"],
    );
  });

  test("keeps selected descendants when their parent group is not selected", () => {
    const nodes: SlideChildNode[] = [
      {
        id: "group-a",
        type: "group",
        component: "custom",
        layout: { frame, zIndex: 2 },
        children: [textNode("child-a"), textNode("child-b")],
      },
    ];

    assert.deepEqual(topLevelSelectedNodeIds(nodes, new Set(["child-b"])), [
      "child-b",
    ]);
  });

  test("collects group descendants for live move previews", () => {
    const nodes: SlideChildNode[] = [
      {
        id: "group-a",
        type: "group",
        component: "custom",
        layout: { frame, zIndex: 2 },
        children: [textNode("child-a"), textNode("child-b")],
      },
    ];

    assert.deepEqual(
      [...collectMovePreviewFrames(nodes, ["group-a"]).keys()],
      ["group-a", "child-a", "child-b"],
    );
  });
});
