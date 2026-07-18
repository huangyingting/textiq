/**
 * Editor command layout tests.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  updateNodeLayout,
  updateNodeRotation,
  moveNodesBy,
  groupNodes,
  ungroupNodes,
} from "@/lib/presentation/editor-commands";
import type { SlideChildNode } from "@/lib/presentation/schema";
import { makeTestDeck, findNode } from "./editor-commands.test-utils";

function assertNear(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined);
  assert.ok(Math.abs(actual - expected) < 0.0000001);
}

describe("updateNodeLayout", () => {
  test("updates frame of the target node", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = updateNodeLayout(deck, slide.id, nodeId, {
      frame: { x: 20, y: 20, w: 50, h: 10 },
    });
    const node = updated.slides[0].children.find((n) => n.id === nodeId);
    assert.ok(node?.layout?.frame.x === 20);
  });

  test("normalizes command-backed rotation updates", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = updateNodeRotation(deck, slide.id, nodeId, -45.04);
    const node = findNode(updated.slides[0].children, nodeId);

    assert.equal(node?.layout?.rotation, 315);
  });
});

describe("moveNodesBy", () => {
  test("nudges selected nodes in percent space", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const original = slide.children[0].layout!.frame;
    const updated = moveNodesBy(deck, slide.id, [nodeId], { x: 1, y: -1 });
    const node = updated.slides[0].children.find((n) => n.id === nodeId);

    assert.equal(node?.layout?.frame.x, original.x + 1);
    assert.equal(node?.layout?.frame.y, original.y - 1);
  });

  test("moves grouped children with their selected group and preserves ungroup positions", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const grouped = groupNodes(
      deck,
      slide.id,
      slide.children.map((node) => node.id),
      "move-group",
    );
    const groupBeforeMove = findNode(grouped.slides[0].children, "move-group");
    assert.equal(groupBeforeMove?.type, "group");
    if (groupBeforeMove?.type !== "group") return;
    const childFrameBefore = groupBeforeMove.children[0]?.layout?.frame;
    assert.ok(childFrameBefore);

    const moved = moveNodesBy(grouped, slide.id, ["move-group"], {
      x: 4,
      y: 3,
    });
    const groupAfterMove = findNode(moved.slides[0].children, "move-group");
    assert.equal(groupAfterMove?.type, "group");
    if (groupAfterMove?.type !== "group") return;
    const childFrameAfter = groupAfterMove.children[0]?.layout?.frame;
    assert.ok(childFrameAfter);
    assert.equal(
      groupAfterMove.layout?.frame.x,
      groupBeforeMove.layout!.frame.x + 4,
    );
    assert.equal(
      groupAfterMove.layout?.frame.y,
      groupBeforeMove.layout!.frame.y + 3,
    );
    assert.equal(childFrameAfter?.x, childFrameBefore!.x + 4);
    assert.equal(childFrameAfter?.y, childFrameBefore!.y + 3);

    const ungrouped = ungroupNodes(moved, slide.id, "move-group");
    const ungroupedChild = findNode(
      ungrouped.deck.slides[0].children,
      groupAfterMove.children[0]!.id,
    );
    assert.deepEqual(ungroupedChild?.layout?.frame, childFrameAfter);
  });

  test("keeps direct child layout edits working after moving a group", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const grouped = groupNodes(
      deck,
      slide.id,
      slide.children.map((node) => node.id),
      "edit-group",
    );
    const moved = moveNodesBy(grouped, slide.id, ["edit-group"], {
      x: 2,
      y: 2,
    });
    const movedGroup = findNode(moved.slides[0].children, "edit-group");
    assert.equal(movedGroup?.type, "group");
    if (movedGroup?.type !== "group") return;
    const targetChild = movedGroup.children[0];
    assert.ok(targetChild?.layout);
    if (!targetChild?.layout) return;

    const edited = updateNodeLayout(moved, slide.id, targetChild.id, {
      frame: {
        ...targetChild.layout.frame,
        x: targetChild.layout.frame.x + 5,
      },
    });
    const editedChild = findNode(edited.slides[0].children, targetChild.id);
    assert.equal(editedChild?.layout?.frame.x, targetChild.layout.frame.x + 5);
    assert.equal(editedChild?.layout?.frame.y, targetChild.layout.frame.y);
  });

  test("scales grouped children when resizing a selected group", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const grouped = groupNodes(
      deck,
      slide.id,
      slide.children.map((node) => node.id),
      "resize-group",
    );
    const groupBeforeResize = findNode(
      grouped.slides[0].children,
      "resize-group",
    );
    assert.equal(groupBeforeResize?.type, "group");
    if (groupBeforeResize?.type !== "group") return;
    const childBefore = groupBeforeResize.children[0];
    assert.ok(childBefore?.layout);
    if (!childBefore?.layout || !groupBeforeResize.layout) return;

    const resized = updateNodeLayout(grouped, slide.id, "resize-group", {
      frame: {
        ...groupBeforeResize.layout.frame,
        w: groupBeforeResize.layout.frame.w * 2,
        h: groupBeforeResize.layout.frame.h * 2,
      },
    });
    const groupAfterResize = findNode(
      resized.slides[0].children,
      "resize-group",
    );
    assert.equal(groupAfterResize?.type, "group");
    if (groupAfterResize?.type !== "group") return;
    const childAfter = groupAfterResize.children[0];
    assert.ok(childAfter?.layout);
    assert.equal(childAfter.layout.frame.w, childBefore.layout.frame.w * 2);
    assert.equal(childAfter.layout.frame.h, childBefore.layout.frame.h * 2);
  });

  test("rotates grouped children when rotating a selected group", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const grouped = groupNodes(
      deck,
      slide.id,
      slide.children.map((node) => node.id),
      "rotate-group",
    );
    const groupBeforeRotate = findNode(
      grouped.slides[0].children,
      "rotate-group",
    );
    assert.equal(groupBeforeRotate?.type, "group");
    if (groupBeforeRotate?.type !== "group") return;
    const childBefore = groupBeforeRotate.children[0];
    assert.ok(childBefore?.layout);
    if (!childBefore?.layout) return;

    const rotated = updateNodeRotation(grouped, slide.id, "rotate-group", 90);
    const groupAfterRotate = findNode(
      rotated.slides[0].children,
      "rotate-group",
    );
    assert.equal(groupAfterRotate?.type, "group");
    if (groupAfterRotate?.type !== "group") return;
    const childAfter = groupAfterRotate.children[0];
    assert.ok(childAfter?.layout);
    assert.notDeepEqual(childAfter.layout.frame, childBefore.layout.frame);
    assert.equal(childAfter.layout.rotation, 90);
  });

  test("rotates grouped children in physical canvas space on widescreen slides", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const child: SlideChildNode = {
      id: "aspect-child",
      type: "text",
      role: "body",
      layout: { frame: { x: 50, y: 35, w: 10, h: 10 }, zIndex: 1 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "aspect-child-p1", text: "Child" }] },
    };
    const group: SlideChildNode = {
      id: "aspect-group",
      type: "group",
      component: "custom",
      layout: { frame: { x: 20, y: 20, w: 40, h: 40 }, zIndex: 2 },
      children: [child],
    };
    const withGroup = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? { ...candidate, children: [group] }
          : candidate,
      ),
    };

    const rotated = updateNodeRotation(withGroup, slide.id, "aspect-group", 90);
    const rotatedChild = findNode(rotated.slides[0].children, child.id);

    assertNear(rotatedChild?.layout?.frame.x, 35);
    assertNear(rotatedChild?.layout?.frame.y, 61.66666666666667);
    assert.equal(rotatedChild?.layout?.rotation, 90);
  });
});
