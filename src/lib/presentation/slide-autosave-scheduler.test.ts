import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createSlideAutosaveScheduler,
  type AutosaveTimer,
  type AutosaveTimerHandle,
} from "./slide-autosave-scheduler";
import { SLIDE_SAVE_DEBOUNCE_MS } from "./save-status";

function createManualTimer() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const cleared: number[] = [];
  const delays: number[] = [];
  const timer: AutosaveTimer = {
    set(callback: () => void, delayMs: number): AutosaveTimerHandle {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      delays.push(delayMs);
      return handle as unknown as AutosaveTimerHandle;
    },
    clear(handle: AutosaveTimerHandle): void {
      const manualHandle = handle as unknown as number;
      cleared.push(manualHandle);
      callbacks.delete(manualHandle);
    },
  };
  return {
    timer,
    cleared,
    delays,
    fire(handle: number): void {
      callbacks.get(handle)?.();
      callbacks.delete(handle);
    },
    pendingHandles(): number[] {
      return [...callbacks.keys()];
    },
  };
}

describe("createSlideAutosaveScheduler", () => {
  test("uses the shared slide save debounce by default", () => {
    const manual = createManualTimer();
    const scheduler = createSlideAutosaveScheduler<string>({
      onDue: () => undefined,
      timer: manual.timer,
    });

    scheduler.schedule("draft");

    assert.deepEqual(manual.delays, [SLIDE_SAVE_DEBOUNCE_MS]);
  });

  test("debounces to the latest scheduled deck", () => {
    const manual = createManualTimer();
    const saved: string[] = [];
    const scheduler = createSlideAutosaveScheduler<string>({
      onDue: (deck) => saved.push(deck),
      timer: manual.timer,
    });

    scheduler.schedule("first");
    scheduler.schedule("second");
    assert.deepEqual(manual.cleared, [1]);

    manual.fire(1);
    assert.deepEqual(saved, []);
    manual.fire(2);
    assert.deepEqual(saved, ["second"]);
    assert.equal(scheduler.hasPending(), false);
  });

  test("flush runs pending work immediately and clears the timer", () => {
    const manual = createManualTimer();
    const saved: string[] = [];
    const scheduler = createSlideAutosaveScheduler<string>({
      onDue: (deck) => saved.push(deck),
      timer: manual.timer,
    });

    scheduler.schedule("latest");
    assert.equal(scheduler.flush(), "latest");
    assert.deepEqual(saved, ["latest"]);
    assert.deepEqual(manual.cleared, [1]);
    assert.equal(scheduler.hasPending(), false);

    manual.fire(1);
    assert.deepEqual(saved, ["latest"]);
  });

  test("manual save handoff can cancel stale queued autosave work", () => {
    const manual = createManualTimer();
    const saved: string[] = [];
    const scheduler = createSlideAutosaveScheduler<string>({
      onDue: (deck) => saved.push(`autosave:${deck}`),
      timer: manual.timer,
    });

    scheduler.schedule("draft-1");
    scheduler.schedule("draft-2");
    scheduler.cancel();
    saved.push("manual:draft-2");

    manual.fire(1);
    manual.fire(2);

    assert.deepEqual(saved, ["manual:draft-2"]);
    assert.equal(scheduler.hasPending(), false);
  });

  test("cancel drops queued work without saving", () => {
    const manual = createManualTimer();
    const saved: string[] = [];
    const scheduler = createSlideAutosaveScheduler<string>({
      onDue: (deck) => saved.push(deck),
      timer: manual.timer,
    });

    scheduler.schedule("draft");
    scheduler.cancel();
    manual.fire(1);

    assert.deepEqual(saved, []);
    assert.equal(scheduler.hasPending(), false);
  });
});
