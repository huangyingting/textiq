import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  initialStageInteractionState,
  stageInteractionReducer,
  type StageInteractionState,
} from "./use-stage-interaction-controller";

const frame = { x: 10, y: 20, w: 30, h: 40 };

function withInitialState(
  patch: Partial<StageInteractionState> = {},
): StageInteractionState {
  return { ...initialStageInteractionState, ...patch };
}

describe("stageInteractionReducer", () => {
  test("keeps the default stage interaction state idle", () => {
    assert.equal(initialStageInteractionState.marqueeFrame, null);
    assert.equal(initialStageInteractionState.draggingStage, false);
    assert.equal(initialStageInteractionState.keyboardConnectorMode, null);
    assert.equal(initialStageInteractionState.moveGestureDraft, null);
    assert.equal(initialStageInteractionState.activeConnectorEndpoint, null);
  });

  test("supports React setter-style updates used by select-under hover and marquee drag", () => {
    let state = stageInteractionReducer(withInitialState(), {
      type: "setHoveredNodeId",
      value: "node-a",
    });

    state = stageInteractionReducer(state, {
      type: "setHoveredNodeId",
      value: (current) => (current === "node-a" ? "node-b" : null),
    });
    state = stageInteractionReducer(state, {
      type: "setMarqueeFrame",
      value: { x: 5, y: 8, w: 0, h: 0 },
    });
    state = stageInteractionReducer(state, {
      type: "setMarqueeFrame",
      value: (current) => (current ? { ...current, w: 25, h: 30 } : current),
    });

    assert.equal(state.hoveredNodeId, "node-b");
    assert.deepEqual(state.marqueeFrame, { x: 5, y: 8, w: 25, h: 30 });
  });

  test("clears transient gesture drafts without dropping active handles or keyboard connector mode", () => {
    const moveGestureDraft = new Map([["node-a", { frame }]]);
    const connectorEndpoint = {
      kind: "point" as const,
      point: { x: 60, y: 70 },
    };
    const state = withInitialState({
      keyboardConnectorMode: { sourceId: "node-a", targetId: "node-b" },
      moveGestureDraft,
      activeResizeHandle: { nodeId: "node-a", handle: "se" },
      resizeGestureDraft: { nodeId: "node-a", frame },
      activeCropHandle: { nodeId: "image-a", handle: "top" },
      cropGestureDraft: {
        nodeId: "image-a",
        crop: { top: 5, right: 0, bottom: 0, left: 10 },
      },
      activeRotationNodeId: "node-a",
      rotationGestureDraft: { nodeId: "node-a", rotation: 45 },
      activeConnectorEndpoint: { nodeId: "connector-a", endpoint: "from" },
      connectorGestureDraft: {
        nodeId: "connector-a",
        endpoint: "from",
        value: connectorEndpoint,
      },
    });

    const next = stageInteractionReducer(state, { type: "clearGestureDrafts" });

    assert.equal(next.moveGestureDraft, null);
    assert.equal(next.resizeGestureDraft, null);
    assert.equal(next.cropGestureDraft, null);
    assert.equal(next.rotationGestureDraft, null);
    assert.equal(next.connectorGestureDraft, null);
    assert.equal(next.activeResizeHandle, state.activeResizeHandle);
    assert.equal(next.activeCropHandle, state.activeCropHandle);
    assert.equal(next.activeRotationNodeId, state.activeRotationNodeId);
    assert.equal(next.activeConnectorEndpoint, state.activeConnectorEndpoint);
    assert.deepEqual(next.keyboardConnectorMode, {
      sourceId: "node-a",
      targetId: "node-b",
    });
  });

  test("preserves connector gesture endpoint payloads", () => {
    const connectorEndpoint = {
      kind: "node" as const,
      nodeId: "node-b",
      anchor: "left" as const,
    };

    const state = stageInteractionReducer(withInitialState(), {
      type: "setConnectorGestureDraft",
      value: {
        nodeId: "connector-a",
        endpoint: "to",
        value: connectorEndpoint,
      },
    });

    assert.deepEqual(state.connectorGestureDraft, {
      nodeId: "connector-a",
      endpoint: "to",
      value: connectorEndpoint,
    });
  });
});
