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

  // undo/redo: schedule the edited deck, persist it, then schedule the original
  // deck (undo) — the controller must reach clean state after each write.
  test("undo-redo: schedule B, persist B, schedule A, persist A — each settles clean", async () => {
    const harness = createHarness("A"); // initial persisted = A
    // Edit: schedule B
    harness.controller.schedule("B");
    const [handleB] = harness.timer.handles();
    harness.timer.fire(handleB);
    assert.deepEqual(harness.writes, ["B"]);
    assert.deepEqual(harness.controller.getState(), {
      dirty: true,
      saving: true,
      error: null,
    });
    harness.deferreds[0].resolve(actionOk());
    await flushMicrotasks();
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });

    // Undo: schedule A
    harness.controller.schedule("A");
    const [handleA] = harness.timer.handles();
    harness.timer.fire(handleA);
    assert.deepEqual(harness.writes, ["B", "A"]);
    assert.deepEqual(harness.controller.getState(), {
      dirty: true,
      saving: true,
      error: null,
    });
    harness.deferreds[1].resolve(actionOk());
    await flushMicrotasks();
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });
  });

  // After conflict keepMine adoptPersisted, the controller treats that deck as
  // persisted. A subsequent undo to a different deck must schedule and save.
  test("adoptPersisted then schedule undo deck: save fires and settles clean", async () => {
    const harness = createHarness("initial");
    // Simulate keepMine resolution: server accepted "mine"
    harness.controller.adoptPersisted("mine");
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });

    // Undo: schedule the deck before "mine" was applied
    harness.controller.schedule("before-mine");
    const [handle] = harness.timer.handles();
    harness.timer.fire(handle);
    assert.deepEqual(harness.writes, ["before-mine"]);
    harness.deferreds[0].resolve(actionOk());
    await flushMicrotasks();
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });

    // A follow-up mutation must also be schedulable and saved cleanly
    harness.controller.schedule("after-undo-edit");
    const [handle2] = harness.timer.handles();
    harness.timer.fire(handle2);
    harness.deferreds[1].resolve(actionOk());
    await flushMicrotasks();
    assert.deepEqual(harness.controller.getState(), {
      dirty: false,
      saving: false,
      error: null,
    });
  });

  // A disposed controller must not report false success for work it can no
  // longer authorise, and the in-flight persist must still resolve its promise.
  test("dispose during in-flight persist: promise resolves but state is not updated", async () => {
    const harness = createHarness("base");
    const savePromise = harness.controller.flush("work");
    assert.deepEqual(harness.writes, ["work"]);

    // Dispose while persist is in flight
    harness.controller.dispose();

    harness.deferreds[0].resolve(actionOk());
    const result = await savePromise;
    // The promise must resolve (no hang / false success from nothing)
    assert.equal(result.ok, true);
    // State update callbacks must be silent after dispose
    assert.equal(harness.states.filter((s) => !s.dirty).length, 0);
  });
});
