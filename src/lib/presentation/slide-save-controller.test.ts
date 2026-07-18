import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { actionError, actionOk, type ActionResult } from "@/lib/action-result";

import {
  createSlideSaveController,
  type SlideSaveControllerState,
} from "./slide-save-controller";
import type {
  AutosaveTimer,
  AutosaveTimerHandle,
} from "./slide-autosave-scheduler";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function createManualTimer() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const staleCallbacks = new Map<number, () => void>();
  const timer: AutosaveTimer = {
    set(callback, _delayMs) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      staleCallbacks.set(handle, callback);
      return handle as unknown as AutosaveTimerHandle;
    },
    clear(handle) {
      callbacks.delete(handle as unknown as number);
    },
  };
  return {
    timer,
    fire(handle: number) {
      callbacks.delete(handle);
      staleCallbacks.get(handle)?.();
    },
    fireStale(handle: number) {
      staleCallbacks.get(handle)?.();
    },
    handles: () => [...callbacks.keys()],
  };
}

function createHarness(initialPersisted = "base") {
  const timer = createManualTimer();
  const writes: string[] = [];
  const deferreds: ReturnType<typeof createDeferred<ActionResult>>[] = [];
  const states: SlideSaveControllerState[] = [];
  const authorities: (() => boolean)[] = [];
  const controller = createSlideSaveController<string>({
    initialPersisted,
    equals: (left, right) => left === right,
    timer: timer.timer,
    persist: async (deck, isAuthoritative) => {
      writes.push(deck);
      authorities.push(isAuthoritative);
      const deferred = createDeferred<ActionResult>();
      deferreds.push(deferred);
      return await deferred.promise;
    },
    onStateChange: (state) => states.push({ ...state }),
  });
  return { controller, timer, writes, deferreds, states, authorities };
}

describe("createSlideSaveController", () => {
  test("persistNow supersedes the debounce before selecting its latest snapshot", async () => {
    const harness = createHarness();
    harness.controller.schedule("A");
    const [timerHandle] = harness.timer.handles();

    const save = harness.controller.flush("stale closure");
    assert.deepEqual(harness.writes, ["A"]);
    harness.timer.fireStale(timerHandle);
    assert.deepEqual(harness.writes, ["A"]);

    harness.deferreds[0].resolve(actionOk());
    assert.equal((await save).ok, true);
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });
  });

  test("regeneration replaces scheduled work and stale callbacks cannot write", async () => {
    const harness = createHarness();
    harness.controller.schedule("edited");
    const [timerHandle] = harness.timer.handles();

    const save = harness.controller.replaceAndPersist("regenerated");
    harness.timer.fireStale(timerHandle);
    assert.deepEqual(harness.writes, ["regenerated"]);

    harness.deferreds[0].resolve(actionOk());
    await save;
  });

  test("identical pending and in-flight targets coalesce and settle cleanly", async () => {
    const harness = createHarness();
    const first = harness.controller.replaceAndPersist("A");
    harness.controller.schedule("A");
    const duplicate = harness.controller.flush("A");

    assert.deepEqual(harness.writes, ["A"]);
    assert.equal(first, duplicate);
    harness.deferreds[0].resolve(actionOk());
    await first;
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });

    await harness.controller.flush("A");
    assert.deepEqual(harness.writes, ["A"]);
  });

  test("A then B persists the latest distinct target once after A", async () => {
    const harness = createHarness();
    const drain = harness.controller.replaceAndPersist("A");
    harness.controller.replaceAndPersist("B");
    harness.controller.replaceAndPersist("B");

    assert.deepEqual(harness.writes, ["A"]);
    harness.deferreds[0].resolve(actionOk());
    await flushMicrotasks();
    assert.deepEqual(harness.writes, ["A", "B"]);

    harness.deferreds[1].resolve(actionOk());
    await drain;
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });
  });

  test("latest failure stays retryable and a retry writes once", async () => {
    const harness = createHarness();
    const failedSave = harness.controller.replaceAndPersist("A");
    harness.deferreds[0].resolve(actionError("network failed"));
    assert.equal((await failedSave).ok, false);
    assert.deepEqual(harness.controller.getState(), {
      dirty: true,
      saving: false,
      error: "network failed",
    });

    const retry = harness.controller.flush("A");
    assert.deepEqual(harness.writes, ["A", "A"]);
    harness.deferreds[1].resolve(actionOk());
    await retry;
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });
  });

  test("dispose and document replacement invalidate old scheduled callbacks", async () => {
    const oldHarness = createHarness();
    oldHarness.controller.schedule("old document");
    const [oldHandle] = oldHarness.timer.handles();
    oldHarness.controller.dispose();

    const newHarness = createHarness("new base");
    newHarness.controller.schedule("new document");
    const [newHandle] = newHarness.timer.handles();
    oldHarness.timer.fireStale(oldHandle);
    assert.deepEqual(oldHarness.writes, []);

    newHarness.timer.fire(newHandle);
    assert.deepEqual(newHarness.writes, ["new document"]);
    newHarness.deferreds[0].resolve(actionOk());
    await Promise.resolve();
  });

  test("an older completion cannot overwrite newer pending status", async () => {
    const harness = createHarness();
    const first = harness.controller.replaceAndPersist("A");
    harness.controller.schedule("B");
    assert.equal(harness.authorities[0](), false);

    harness.deferreds[0].resolve(actionOk());
    await first;
    assert.deepEqual(harness.controller.getState(), {
      dirty: true,
      saving: false,
      error: null,
    });

    const [timerHandle] = harness.timer.handles();
    harness.timer.fire(timerHandle);
    assert.equal(harness.authorities[1](), true);
    harness.deferreds[1].resolve(actionOk());
    await flushMicrotasks();
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });
  });
});
