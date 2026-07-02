import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createMemorySaveQueueStorage,
  createResilientLatestSnapshotQueue,
  type SaveQueueSaveResult,
} from "./resilient-autosave-queue";
import type {
  AutosaveTimer,
  AutosaveTimerHandle,
} from "./slide-autosave-scheduler";

type TestDeck = { title: string };

function createManualTimer() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  const cleared: number[] = [];
  const timer: AutosaveTimer = {
    set(callback, delayMs): AutosaveTimerHandle {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      delays.push(delayMs);
      return handle as unknown as AutosaveTimerHandle;
    },
    clear(handle): void {
      const id = handle as unknown as number;
      cleared.push(id);
      callbacks.delete(id);
    },
  };
  return {
    timer,
    delays,
    cleared,
    fire(handle: number): void {
      callbacks.get(handle)?.();
      callbacks.delete(handle);
    },
    pendingHandles(): number[] {
      return [...callbacks.keys()];
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("createResilientLatestSnapshotQueue", () => {
  test("coalesces durable snapshots to the latest deck", async () => {
    const manual = createManualTimer();
    const storage = createMemorySaveQueueStorage<TestDeck>();
    const saved: TestDeck[] = [];
    const queue = createResilientLatestSnapshotQueue<TestDeck>({
      documentId: "doc",
      storage,
      timer: manual.timer,
      save: async (deck) => {
        saved.push(deck);
        return { ok: true, revisionToken: "rev-1" };
      },
    });

    await queue.enqueue({ title: "first" }, "rev-0");
    await queue.enqueue({ title: "second" }, "rev-0");

    assert.equal(storage.readStored()?.snapshot.title, "second");
    assert.deepEqual(manual.cleared, [1]);
    manual.fire(1);
    assert.deepEqual(saved, []);
    manual.fire(2);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(saved, [{ title: "second" }]);
    assert.equal(storage.readStored(), null);
  });

  test("recovers a persisted snapshot and flushes with its stored revision token", async () => {
    const storage = createMemorySaveQueueStorage<TestDeck>();
    const queue = createResilientLatestSnapshotQueue<TestDeck>({
      documentId: "doc",
      storage,
      save: async () => ({ ok: true, revisionToken: "rev-unused" }),
    });
    await queue.enqueue({ title: "offline edit" }, "rev-base");

    const calls: Array<{ deck: TestDeck; token: string | null }> = [];
    const restoredQueue = createResilientLatestSnapshotQueue<TestDeck>({
      documentId: "doc",
      storage,
      save: async (deck, token) => {
        calls.push({ deck, token });
        return { ok: true, revisionToken: "rev-after" };
      },
    });

    const recovered = await restoredQueue.recover();
    assert.equal(recovered?.snapshot.title, "offline edit");
    const result = await restoredQueue.flushNow();
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
      { deck: { title: "offline edit" }, token: "rev-base" },
    ]);
    assert.equal(storage.readStored(), null);
  });

  test("retries with backoff and flushes when online recovery is triggered", async () => {
    const manual = createManualTimer();
    let online = false;
    let attempts = 0;
    const statuses: string[] = [];
    const queue = createResilientLatestSnapshotQueue<TestDeck>({
      documentId: "doc",
      storage: createMemorySaveQueueStorage<TestDeck>(),
      timer: manual.timer,
      retryDelaysMs: [50, 100],
      isOnline: () => online,
      onStatusChange: (status) => statuses.push(status),
      save: async () => {
        attempts += 1;
        return { ok: true, revisionToken: "rev-online" };
      },
    });

    await queue.enqueue({ title: "queued" }, "rev-0", { flush: true });
    assert.equal(attempts, 0);
    assert.equal(queue.getStatus(), "offline");
    assert.deepEqual(manual.delays, [50]);

    online = true;
    const result = await queue.flushNow();

    assert.equal(result.ok, true);
    assert.equal(attempts, 1);
    assert.equal(queue.getStatus(), "idle");
    assert.ok(statuses.includes("offline"));
    assert.ok(statuses.includes("saving"));
  });

  test("advances the base revision for newer snapshots queued during a save", async () => {
    const first = deferred<SaveQueueSaveResult>();
    const calls: Array<{ deck: TestDeck; token: string | null }> = [];
    const queue = createResilientLatestSnapshotQueue<TestDeck>({
      documentId: "doc",
      storage: createMemorySaveQueueStorage<TestDeck>(),
      save: async (deck, token) => {
        calls.push({ deck, token });
        if (calls.length === 1) {
          return first.promise;
        }
        return { ok: true, revisionToken: "rev-final" };
      },
    });

    const flushing = queue.enqueue({ title: "first" }, "rev-0", {
      flush: true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const queuedSecond = queue.enqueue({ title: "second" }, "rev-0", {
      flush: true,
    });
    first.resolve({ ok: true, revisionToken: "rev-1" });
    const result = await flushing;
    await queuedSecond;

    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
      { deck: { title: "first" }, token: "rev-0" },
      { deck: { title: "second" }, token: "rev-1" },
    ]);
  });

  test("pauses retries on CAS conflict until conflict resolution clears the queue", async () => {
    const storage = createMemorySaveQueueStorage<TestDeck>();
    const queue = createResilientLatestSnapshotQueue<TestDeck>({
      documentId: "doc",
      storage,
      save: async () => ({
        ok: "conflict",
        serverRevisionToken: "rev-server",
      }),
    });

    const result = await queue.enqueue({ title: "mine" }, "rev-stale", {
      flush: true,
    });

    assert.equal(result.ok, false);
    assert.equal(queue.getStatus(), "conflict");
    assert.equal(storage.readStored()?.lastErrorClass, "conflict");
    const retry = await queue.flushNow();
    assert.equal(retry.ok, false);
    assert.equal(queue.getStatus(), "conflict");

    await queue.clear();
    assert.equal(queue.getPending(), null);
    assert.equal(storage.readStored(), null);
  });
});
