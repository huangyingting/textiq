import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  collectMovePreviewFrames,
  nextAltClickOverlapNodeId,
  normalizeConnectorEndpointDragValue,
  topLevelSelectedNodeIds,
} from "./use-stage-gesture-controller";
import type { StageHitCandidate } from "@/lib/presentation/stage-hit-test";
import type {
  ConnectorEndpoint,
  SlideChildNode,
} from "@/lib/presentation/schema";

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

function hit(node: SlideChildNode): StageHitCandidate {
  return { node, frame, score: 1, reason: "box-interior" };
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

  test("cycles Alt-click selection through the same unlocked overlap stack as context menus", () => {
    const top = textNode("top");
    const middle = textNode("middle");
    const locked = { ...textNode("locked"), locked: true };
    const bottom = textNode("bottom");
    const hits = [hit(top), hit(locked), hit(middle), hit(bottom)];

    assert.equal(nextAltClickOverlapNodeId(hits, ["top"]), "middle");
    assert.equal(nextAltClickOverlapNodeId(hits, ["middle"]), "bottom");
    assert.equal(nextAltClickOverlapNodeId(hits, ["bottom"]), "top");
    assert.equal(nextAltClickOverlapNodeId(hits, []), "middle");
  });

  test("does not treat a single Alt-click hit as an overlap cycle", () => {
    assert.equal(nextAltClickOverlapNodeId([hit(textNode("only"))], []), null);
  });

  test("normalizes dragged free connector endpoints against the expanded frame", () => {
    const from: ConnectorEndpoint = {
      kind: "point",
      point: { x: 0, y: 50 },
    };
    const to: ConnectorEndpoint = {
      kind: "point",
      point: { x: 100, y: 50 },
    };

    assert.deepEqual(
      normalizeConnectorEndpointDragValue({
        nodes: [],
        connectorFrame: { x: 20, y: 20, w: 20, h: 20 },
        from,
        to,
        toPoint: { x: 60, y: 30 },
      }),
      {
        frame: { x: 20, y: 30, w: 40, h: 1 },
        from: { kind: "point", point: { x: 0, y: 0 } },
        to: { kind: "point", point: { x: 100, y: 0 } },
      },
    );
  });
});
