import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SlideChildNode } from "@/lib/presentation/schema";
import type { StageHitCandidate } from "@/lib/presentation/stage-hit-test";

import {
  isStageNodeTargetSelected,
  nextActiveGroupIdForStageTarget,
  resolveStageNodeTarget,
  stageCandidateNodeIds,
} from "./stage-targeting";

function textNode(id: string): SlideChildNode {
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p1`, text: id }] },
  };
}

function hit(node: SlideChildNode, score = 1): StageHitCandidate {
  return {
    node,
    frame: node.layout?.frame ?? { x: 0, y: 0, w: 1, h: 1 },
    score,
    reason: "box-interior",
  };
}

describe("stageCandidateNodeIds", () => {
  test("dedupes candidates while preserving hit order", () => {
    const first = textNode("first");
    const second = textNode("second");

    assert.deepEqual(
      stageCandidateNodeIds([hit(first), hit(second), hit(first)]),
      ["first", "second"],
    );
  });
});

describe("resolveStageNodeTarget", () => {
  test("resolves hit target and candidate ids", () => {
    const first = textNode("first");
    const second = textNode("second");
    const target = resolveStageNodeTarget({
      hits: [hit(first), hit(second), hit(first)],
      nodes: [first, second],
    });

    assert.equal(target?.nodeId, "first");
    assert.deepEqual(target?.candidateIds, ["first", "second"]);
    assert.equal(isStageNodeTargetSelected(target!, ["first"]), true);
  });

  test("uses fallback id when there are no hits", () => {
    const fallback = textNode("fallback");
    const target = resolveStageNodeTarget({
      hits: [],
      nodes: [fallback],
      fallbackNodeId: "fallback",
    });

    assert.equal(target?.node, fallback);
    assert.deepEqual(target?.candidateIds, []);
  });

  test("reports parent group context for child targets", () => {
    const child = textNode("child");
    const group: SlideChildNode = {
      id: "group",
      type: "group",
      role: "card",
      component: "custom",
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 2 },
      style: { ref: "surface.card" },
      children: [child],
    };
    const target = resolveStageNodeTarget({
      hits: [hit(child)],
      nodes: [group],
    });

    assert.equal(target?.parentGroupId, "group");
    assert.equal(
      nextActiveGroupIdForStageTarget({
        currentActiveGroupId: null,
        target: target!,
      }),
      "group",
    );
    assert.equal(
      nextActiveGroupIdForStageTarget({
        currentActiveGroupId: "group",
        target: target!,
      }),
      "group",
    );
  });

  test("clears active group when targeting outside it", () => {
    const outside = textNode("outside");
    const target = resolveStageNodeTarget({
      hits: [hit(outside)],
      nodes: [outside],
    });

    assert.equal(
      nextActiveGroupIdForStageTarget({
        currentActiveGroupId: "group",
        target: target!,
      }),
      null,
    );
  });
});
