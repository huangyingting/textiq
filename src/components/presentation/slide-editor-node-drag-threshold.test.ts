import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSingleCommitGesture } from "./single-commit-gesture";
import {
  buildStageGestureBadge,
  buildStageNodeGestureDrafts,
  createNodeMovePreview,
  nodeMoveGestureDrafts,
  nodeMovePreviewsEqual,
  renderStageGestureBadge,
  type NodeMovePreview,
} from "./stage-gesture-feedback";

function nodeMovePreviewFixture(value: unknown): NodeMovePreview {
  return value as unknown as NodeMovePreview;
}

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

  test("snaps movement previews to custom persistent guides", () => {
    const preview = createNodeMovePreview({
      startClientX: 100,
      startClientY: 100,
      nextClientX: 106,
      nextClientY: 100,
      rectWidth: 1000,
      rectHeight: 1000,
      originalFrames: new Map([["node-a", { x: 34, y: 20, w: 10, h: 10 }]]),
      alignmentGuides: [{ axis: "x", positionPct: 34.5 }],
      snapToGuides: true,
    });

    assert.ok(preview);
    assert.equal(preview.patches.get("node-a")?.frame?.x, 34.5);
    assert.deepEqual(preview.guides, [{ axis: "x", positionPct: 34.5 }]);
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

  test("returns null for invalid move inputs and empty gesture drafts", () => {
    assert.equal(
      createNodeMovePreview({
        startClientX: 0,
        startClientY: 0,
        nextClientX: 20,
        nextClientY: 20,
        rectWidth: 0,
        rectHeight: 100,
        originalFrames: new Map([["node-a", { x: 0, y: 0, w: 10, h: 10 }]]),
        alignmentGuides: [],
      }),
      null,
    );
    assert.equal(
      createNodeMovePreview({
        startClientX: 0,
        startClientY: 0,
        nextClientX: 20,
        nextClientY: 20,
        rectWidth: 100,
        rectHeight: 100,
        originalFrames: new Map(),
        alignmentGuides: [],
      }),
      null,
    );
    assert.equal(nodeMoveGestureDrafts(null), null);
    assert.equal(
      nodeMoveGestureDrafts({ patches: new Map(), guides: [] }),
      null,
    );
    assert.equal(
      nodeMoveGestureDrafts(
        nodeMovePreviewFixture({
          patches: new Map([["node-a", { name: "ignored" }]]),
          guides: [],
        }),
      ),
      null,
    );
  });

  test("compares and converts move preview patches including rotation", () => {
    const left: NodeMovePreview = {
      patches: new Map([
        ["node-a", { frame: { x: 1, y: 2, w: 3, h: 4 } }],
        ["node-b", { rotation: 45 }],
      ]),
      guides: [],
    };
    const right: NodeMovePreview = {
      patches: new Map([
        ["node-a", { frame: { x: 1, y: 2, w: 3, h: 4 } }],
        ["node-b", { rotation: 45 }],
      ]),
      guides: [],
    };
    const changed: NodeMovePreview = {
      patches: new Map([
        ["node-a", { frame: { x: 1, y: 2, w: 3, h: 5 } }],
        ["node-b", { rotation: 90 }],
      ]),
      guides: [],
    };

    assert.equal(nodeMovePreviewsEqual(left, right), true);
    assert.equal(nodeMovePreviewsEqual(left, changed), false);
    const drafts = nodeMoveGestureDrafts(left);
    assert.deepEqual(drafts?.get("node-a")?.frame, { x: 1, y: 2, w: 3, h: 4 });
    assert.equal(drafts?.get("node-b")?.rotation, 45);
  });

  test("merges move, resize, crop, rotation, and connector gesture drafts", () => {
    const drafts = buildStageNodeGestureDrafts({
      moveGestureDraft: new Map([
        ["node-a", { frame: { x: 1, y: 2, w: 3, h: 4 } }],
      ]),
      resizeGestureDraft: {
        nodeId: "node-b",
        frame: { x: 5, y: 6, w: 7, h: 8 },
      },
      cropGestureDraft: {
        nodeId: "node-a",
        crop: { top: 1, right: 2, bottom: 3, left: 4 },
      },
      rotationGestureDraft: { nodeId: "node-a", rotation: 30 },
      connectorGestureDraft: {
        nodeId: "node-c",
        endpoint: "from",
        value: { kind: "point", point: { x: 10, y: 20 } },
      },
    });

    assert.deepEqual(drafts?.get("node-a"), {
      frame: { x: 1, y: 2, w: 3, h: 4 },
      crop: { top: 1, right: 2, bottom: 3, left: 4 },
      rotation: 30,
    });
    assert.deepEqual(drafts?.get("node-b")?.frame, { x: 5, y: 6, w: 7, h: 8 });
    assert.deepEqual(drafts?.get("node-c")?.connectorEndpoints?.from, {
      kind: "point",
      point: { x: 10, y: 20 },
    });
    assert.equal(
      buildStageNodeGestureDrafts({
        moveGestureDraft: null,
        resizeGestureDraft: null,
        cropGestureDraft: null,
        rotationGestureDraft: null,
        connectorGestureDraft: null,
      }),
      undefined,
    );
  });

  test("builds and renders gesture badges for resize and move previews", () => {
    const resizeBadge = buildStageGestureBadge({
      moveGestureDraft: null,
      resizeGestureDraft: {
        nodeId: "node-a",
        frame: { x: 10, y: 20, w: 31.4, h: 9.6 },
      },
    });
    assert.equal(resizeBadge?.label, "31 × 10");

    const moveBadge = buildStageGestureBadge({
      moveGestureDraft: new Map([
        ["node-a", { frame: { x: 10.2, y: 20.4, w: 5, h: 5 } }],
        ["node-b", { frame: { x: 30, y: 40, w: 10, h: 10 } }],
      ]),
      resizeGestureDraft: null,
    });
    assert.equal(moveBadge?.label, "10, 20");
    assert.equal(
      buildStageGestureBadge({
        moveGestureDraft: new Map([["node-a", { rotation: 5 }]]),
        resizeGestureDraft: null,
      }),
      null,
    );
    assert.equal(
      buildStageGestureBadge({
        moveGestureDraft: null,
        resizeGestureDraft: null,
      }),
      null,
    );
    assert.equal(renderStageGestureBadge(null), null);
    const rendered = renderStageGestureBadge(moveBadge);
    assert.equal(rendered?.props["data-stage-gesture-badge"], "true");
    assert.equal(rendered?.props.children, "10, 20");
  });
});
