import assert from "node:assert/strict";
import { test } from "node:test";

import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  runPresentModeAutoFullscreen,
  usePresentModeClose,
} from "./present-mode";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function withDocument<T>(
  documentValue: Document,
  callback: () => Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: documentValue,
  });
  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "document", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  }
}

test("usePresentModeClose shares duplicate exit activation and closes once", async () => {
  const exitGate = deferred<void>();
  let exitCalls = 0;
  let closeCalls = 0;
  const fakeDocument = {
    fullscreenElement: { tagName: "DIV" },
    exitFullscreen: async () => {
      exitCalls += 1;
      return exitGate.promise;
    },
  } as unknown as Document;

  await withDocument(fakeDocument, async () => {
    const harness = createReactRenderHarness();
    try {
      const close = harness.run(() =>
        usePresentModeClose(() => {
          closeCalls += 1;
        }),
      );
      const first = close();
      const duplicate = close();

      assert.equal(exitCalls, 1);
      exitGate.resolve();
      await Promise.all([first, duplicate]);
      assert.equal(closeCalls, 1);
    } finally {
      harness.cleanup();
    }
  });
});

test("usePresentModeClose suppresses a late close callback after unmount", async () => {
  const exitGate = deferred<void>();
  let closeCalls = 0;
  const fakeDocument = {
    fullscreenElement: { tagName: "DIV" },
    exitFullscreen: async () => exitGate.promise,
  } as unknown as Document;

  await withDocument(fakeDocument, async () => {
    const harness = createReactRenderHarness();
    const close = harness.run(() =>
      usePresentModeClose(() => {
        closeCalls += 1;
      }),
    );
    const request = close();
    harness.cleanup();
    exitGate.resolve();
    await request;

    assert.equal(closeCalls, 0);
  });
});

test("late auto-fullscreen success exits instead of updating an unmounted presenter", async () => {
  const requestGate = deferred<boolean>();
  let active = true;
  let exitCalls = 0;
  const hintUpdates: boolean[] = [];
  const request = runPresentModeAutoFullscreen({
    isActive: () => active,
    requestFullscreen: async () => requestGate.promise,
    exitFullscreen: async () => {
      exitCalls += 1;
      return true;
    },
    setHintVisible: (visible) => hintUpdates.push(visible),
  });

  active = false;
  requestGate.resolve(true);
  await request;

  assert.equal(exitCalls, 1);
  assert.deepEqual(hintUpdates, []);
});
