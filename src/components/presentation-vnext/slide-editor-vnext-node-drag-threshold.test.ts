import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSingleCommitGesture } from "./single-commit-gesture";
import {
  createNodeMovePreview,
  nodeMovePreviewsEqual,
  type NodeMovePreview,
} from "./stage-gesture-feedback";

describe("createNodeMovePreview", () => {
  test("keeps node drag press-pending under the click-move threshold", () => {
    const preview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 104,
      nextClientY: 103,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames: new Map([["node-a", { x: 10, y: 10, w: 20, h: 20 }]]),
      alignmentGuides: [],
    });

    assert.equal(preview, null);
  });

  test("returns move patches and guides after crossing threshold", () => {
    const originalFrame = { x: 9.6, y: 89.4, w: 20, h: 10 };
    const preview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 105,
      nextClientY: 105,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames: new Map([["node-a", originalFrame]]),
      alignmentGuides: [],
    });

    assert.ok(preview);
    assert.equal(preview.patches.size, 1);
    const patch = preview.patches.get("node-a");
    assert.ok(patch?.frame);
    assert.notDeepEqual(patch.frame, originalFrame);
    assert.ok(preview.guides.length > 0);
  });

  test("skips guide snapping when disabled", () => {
    const preview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 105,
      nextClientY: 105,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames: new Map([["node-a", { x: 9.6, y: 89.4, w: 20, h: 10 }]]),
      alignmentGuides: [],
      snapToGuides: false,
    });

    assert.ok(preview);
    assert.deepEqual(preview.guides, []);
    const frame = preview.patches.get("node-a")?.frame;
    assert.ok(frame);
    assert.equal(Math.round(frame.x * 10), 101);
    assert.equal(Math.round(frame.y * 10), 899);
  });

  test("snaps multi-node movement as a group without changing relative offsets", () => {
    const originalFrames = new Map([
      ["node-a", { x: 9.6, y: 20, w: 10, h: 10 }],
      ["node-b", { x: 31, y: 24, w: 10, h: 10 }],
    ]);
    const preview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 105,
      nextClientY: 100,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames,
      alignmentGuides: [],
      snapToGuides: true,
    });

    assert.ok(preview);
    const first = preview.patches.get("node-a")?.frame;
    const second = preview.patches.get("node-b")?.frame;
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.x, 10);
    assert.equal(second.x - first.x, 31 - 9.6);
    assert.equal(second.y - first.y, 24 - 20);
    assert.ok(preview.guides.some((guide) => guide.axis === "x"));
  });

  test("locks movement to the horizontal axis under Shift when x dominates", () => {
    const originalFrame = { x: 20, y: 30, w: 20, h: 10 };
    const preview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 200,
      nextClientY: 130,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames: new Map([["node-a", originalFrame]]),
      alignmentGuides: [],
      snapToGuides: false,
      lockAxis: true,
    });

    assert.ok(preview);
    const frame = preview.patches.get("node-a")?.frame;
    assert.ok(frame);
    assert.equal(frame.y, originalFrame.y);
    assert.equal(Math.round(frame.x), 30);
  });

  test("locks movement to the vertical axis under Shift when y dominates", () => {
    const originalFrame = { x: 20, y: 30, w: 20, h: 10 };
    const preview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 120,
      nextClientY: 250,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames: new Map([["node-a", originalFrame]]),
      alignmentGuides: [],
      snapToGuides: false,
      lockAxis: true,
    });

    assert.ok(preview);
    const frame = preview.patches.get("node-a")?.frame;
    assert.ok(frame);
    assert.equal(frame.x, originalFrame.x);
    assert.equal(Math.round(frame.y), 45);
  });

  test("keeps the locked axis fixed even when a guide would snap it", () => {
    const originalFrame = { x: 20, y: 41, w: 20, h: 10 };
    const preview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 200,
      nextClientY: 190,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames: new Map([["node-a", originalFrame]]),
      // A y-guide at 50 sits within snap range of the moved y; axis lock must win.
      alignmentGuides: [{ axis: "y", positionPct: 50 }],
      snapToGuides: true,
      lockAxis: true,
    });

    assert.ok(preview);
    const frame = preview.patches.get("node-a")?.frame;
    assert.ok(frame);
    assert.equal(frame.y, originalFrame.y);
  });

  test("commits one final layout patch after multiple drag previews", () => {
    const commits: NodeMovePreview[] = [];
    const previews: Array<NodeMovePreview | null> = [];
    const gesture = createSingleCommitGesture<NodeMovePreview>({
      initialValue: {
        patches: new Map(),
        guides: [] as NodeMovePreview["guides"],
      },
      equals: nodeMovePreviewsEqual,
      onPreview: (preview) => previews.push(preview),
      onCommit: (preview) => commits.push(preview),
    });
    const originalFrames = new Map([
      ["node-a", { x: 10, y: 10, w: 20, h: 20 }],
    ]);
    const firstPreview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 110,
      nextClientY: 110,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames,
      alignmentGuides: [],
    });
    const finalPreview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 135,
      nextClientY: 120,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames,
      alignmentGuides: [],
    });

    assert.ok(firstPreview);
    assert.ok(finalPreview);
    gesture.update(firstPreview);
    gesture.update(finalPreview);
    gesture.finish();

    assert.equal(commits.length, 1);
    assert.ok(commits[0]);
    assert.ok(commits[0].patches.has("node-a"));
    assert.deepEqual(
      commits[0].patches.get("node-a"),
      finalPreview.patches.get("node-a"),
    );
    assert.equal(previews.at(-1), null);
  });
});
