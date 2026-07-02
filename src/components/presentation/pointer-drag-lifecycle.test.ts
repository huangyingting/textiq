import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  startPointerDragLifecycle,
  type PointerDragEndReason,
  type PointerDragListenerTarget,
} from "./pointer-drag-lifecycle";

type PointerListenerType = "pointermove" | "pointerup" | "pointercancel";

function createListenerHarness() {
  const listeners = new Map<
    PointerListenerType,
    (event: PointerEvent) => void
  >();
  const added: PointerListenerType[] = [];
  const removed: PointerListenerType[] = [];

  const listenerTarget: PointerDragListenerTarget = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
      added.push(type);
    },
    removeEventListener(type, _listener) {
      listeners.delete(type);
      removed.push(type);
    },
  };

  return {
    listenerTarget,
    added,
    removed,
    has(type: PointerListenerType) {
      return listeners.has(type);
    },
    dispatch(type: PointerListenerType, event: PointerEvent) {
      listeners.get(type)?.(event);
    },
  };
}

function pointerEvent(): PointerEvent {
  return { clientX: 20, clientY: 10 } as PointerEvent;
}

describe("startPointerDragLifecycle", () => {
  test("manages pointer listeners and capture through pointerup cleanup", () => {
    const harness = createListenerHarness();
    const captureIds: number[] = [];
    const releaseIds: number[] = [];
    const moved: PointerEvent[] = [];
    const ended: PointerDragEndReason[] = [];
    const captureTarget = {
      setPointerCapture(pointerId: number) {
        captureIds.push(pointerId);
      },
      releasePointerCapture(pointerId: number) {
        releaseIds.push(pointerId);
      },
    } as EventTarget & {
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
    };

    startPointerDragLifecycle(
      {
        pointerId: 7,
        currentTarget: captureTarget,
      },
      {
        listenerTarget: harness.listenerTarget,
        onMove: (event) => moved.push(event),
        onEnd: (_event, reason) => ended.push(reason),
      },
    );

    assert.deepEqual(captureIds, [7]);
    assert.deepEqual(harness.added, [
      "pointermove",
      "pointerup",
      "pointercancel",
    ]);

    harness.dispatch("pointermove", pointerEvent());
    assert.equal(moved.length, 1);

    harness.dispatch("pointerup", pointerEvent());
    assert.deepEqual(ended, ["up"]);
    assert.deepEqual(releaseIds, [7]);
    assert.deepEqual(harness.removed, [
      "pointermove",
      "pointerup",
      "pointercancel",
    ]);

    harness.dispatch("pointermove", pointerEvent());
    assert.equal(moved.length, 1);
  });

  test("treats pointercancel as end and removes remaining listeners", () => {
    const harness = createListenerHarness();
    const ended: PointerDragEndReason[] = [];

    startPointerDragLifecycle(
      { pointerId: 1, currentTarget: null },
      {
        listenerTarget: harness.listenerTarget,
        onMove: () => undefined,
        onEnd: (_event, reason) => ended.push(reason),
      },
    );

    harness.dispatch("pointercancel", pointerEvent());
    harness.dispatch("pointerup", pointerEvent());

    assert.deepEqual(ended, ["cancel"]);
    assert.equal(harness.has("pointermove"), false);
    assert.equal(harness.has("pointerup"), false);
    assert.equal(harness.has("pointercancel"), false);
  });

  test("can disable pointercancel listener registration", () => {
    const harness = createListenerHarness();

    startPointerDragLifecycle(
      { pointerId: 2, currentTarget: null },
      {
        listenerTarget: harness.listenerTarget,
        includePointerCancel: false,
        onMove: () => undefined,
      },
    );

    assert.deepEqual(harness.added, ["pointermove", "pointerup"]);
    assert.equal(harness.has("pointercancel"), false);
  });
});
