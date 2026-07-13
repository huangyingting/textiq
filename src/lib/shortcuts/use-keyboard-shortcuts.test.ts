/**
 * Direct contracts for `useKeyboardShortcut` (#1946).
 *
 * `isEditableTagName` (the pure editable-target predicate) is already
 * covered by `match.test.ts`; this file instead covers what
 * `use-keyboard-shortcuts.ts` adds on top: the `enabled`/`allowInInput`
 * toggles, the `instanceof HTMLElement` + `isEditableTagName` target
 * filtering wired through `isEditableTarget`, the `handlerRef` pattern that
 * lets the handler update every render without re-registering the listener,
 * and the `keydown` listener's add/remove lifecycle on mount/unmount and on
 * `enabled` changes.
 *
 * A minimal fake `document` (real `addEventListener`/`removeEventListener`
 * backed by an actual listener set, so `dispatch` can synchronously invoke
 * registered handlers) and a fake `HTMLElement` class stand in for the DOM,
 * following the same pattern as `use-active-table-caption.test.ts`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createReactRenderHarness } from "@/test/react-render-harness";

import { useKeyboardShortcut } from "./use-keyboard-shortcuts";

class FakeElement {
  constructor(
    public readonly tagName: string,
    public readonly isContentEditable = false,
  ) {}
}

function createFakeDocument() {
  const listeners = new Set<(event: unknown) => void>();
  let addCalls = 0;
  let removeCalls = 0;
  const fakeDocument = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      assert.equal(type, "keydown");
      listeners.add(handler);
      addCalls += 1;
    },
    removeEventListener(type: string, handler: (event: unknown) => void) {
      assert.equal(type, "keydown");
      listeners.delete(handler);
      removeCalls += 1;
    },
  };
  return {
    document: fakeDocument,
    dispatch(event: unknown) {
      for (const handler of Array.from(listeners)) handler(event);
    },
    get listenerCount() {
      return listeners.size;
    },
    get addCalls() {
      return addCalls;
    },
    get removeCalls() {
      return removeCalls;
    },
  };
}

function withFakeDom<T>(
  run: (fake: ReturnType<typeof createFakeDocument>) => T,
): T {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousHTMLElement = Object.getOwnPropertyDescriptor(
    globalThis,
    "HTMLElement",
  );
  const fake = createFakeDocument();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: fake.document,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    writable: true,
    value: FakeElement,
  });
  try {
    return run(fake);
  } finally {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (previousHTMLElement) {
      Object.defineProperty(globalThis, "HTMLElement", previousHTMLElement);
    } else {
      Reflect.deleteProperty(globalThis, "HTMLElement");
    }
  }
}

test("registers exactly one keydown listener on mount and removes it on unmount", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    renderer.run(() => useKeyboardShortcut(() => {}));
    assert.equal(fake.listenerCount, 1);
    assert.equal(fake.addCalls, 1);

    renderer.cleanup();
    assert.equal(fake.listenerCount, 0);
    assert.equal(fake.removeCalls, 1);
  }));

test("enabled: false registers no listener at all", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      renderer.run(() => useKeyboardShortcut(() => {}, { enabled: false }));
      assert.equal(fake.listenerCount, 0);
      assert.equal(fake.addCalls, 0);
    } finally {
      renderer.cleanup();
    }
  }));

test("toggling enabled from true to false unregisters the listener", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      const render = (enabled: boolean) =>
        renderer.run(() => useKeyboardShortcut(() => {}, { enabled }));
      render(true);
      assert.equal(fake.listenerCount, 1);

      render(false);
      assert.equal(fake.listenerCount, 0);
    } finally {
      renderer.cleanup();
    }
  }));

test("toggling enabled from false to true (re-)registers the listener", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      const render = (enabled: boolean) =>
        renderer.run(() => useKeyboardShortcut(() => {}, { enabled }));
      render(false);
      assert.equal(fake.listenerCount, 0);

      render(true);
      assert.equal(fake.listenerCount, 1);
    } finally {
      renderer.cleanup();
    }
  }));

test("the handler updates across renders without re-registering the keydown listener", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      const calls: string[] = [];
      const render = (tag: string) =>
        renderer.run(() =>
          useKeyboardShortcut(() => {
            calls.push(tag);
          }),
        );

      render("first");
      assert.equal(fake.addCalls, 1);

      // Re-render with a brand-new handler closure — the effect that syncs
      // handlerRef has [handler] as its dependency and re-runs, but the
      // listener-registration effect's deps ([enabled, allowInInput]) are
      // unchanged, so the listener itself must not be re-added/removed.
      render("second");
      assert.equal(fake.addCalls, 1);
      assert.equal(fake.removeCalls, 0);

      fake.dispatch({ target: new FakeElement("DIV") });
      assert.deepEqual(calls, ["second"]);
    } finally {
      renderer.cleanup();
    }
  }));

test("by default (allowInInput: false), a keydown on an editable target (INPUT) is ignored", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      let called = false;
      renderer.run(() =>
        useKeyboardShortcut(() => {
          called = true;
        }),
      );
      fake.dispatch({ target: new FakeElement("INPUT") });
      assert.equal(called, false);
    } finally {
      renderer.cleanup();
    }
  }));

test("by default, a keydown on a TEXTAREA/SELECT target is also ignored", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      let calls = 0;
      renderer.run(() =>
        useKeyboardShortcut(() => {
          calls += 1;
        }),
      );
      fake.dispatch({ target: new FakeElement("TEXTAREA") });
      fake.dispatch({ target: new FakeElement("SELECT") });
      assert.equal(calls, 0);
    } finally {
      renderer.cleanup();
    }
  }));

test("by default, a keydown on a contentEditable target is ignored regardless of tag name", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      let called = false;
      renderer.run(() =>
        useKeyboardShortcut(() => {
          called = true;
        }),
      );
      fake.dispatch({ target: new FakeElement("DIV", true) });
      assert.equal(called, false);
    } finally {
      renderer.cleanup();
    }
  }));

test("by default, a keydown on a non-editable target invokes the handler", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      let receivedEvent: unknown;
      renderer.run(() =>
        useKeyboardShortcut((event) => {
          receivedEvent = event;
        }),
      );
      const event = { target: new FakeElement("DIV") };
      fake.dispatch(event);
      assert.equal(receivedEvent, event);
    } finally {
      renderer.cleanup();
    }
  }));

test("allowInInput: true invokes the handler even for an editable target", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      let called = false;
      renderer.run(() =>
        useKeyboardShortcut(
          () => {
            called = true;
          },
          { allowInInput: true },
        ),
      );
      fake.dispatch({ target: new FakeElement("INPUT") });
      assert.equal(called, true);
    } finally {
      renderer.cleanup();
    }
  }));

test("a keydown with no target (or a non-HTMLElement target) is treated as non-editable", () =>
  withFakeDom((fake) => {
    const renderer = createReactRenderHarness();
    try {
      let calls = 0;
      renderer.run(() =>
        useKeyboardShortcut(() => {
          calls += 1;
        }),
      );
      fake.dispatch({ target: null });
      fake.dispatch({ target: { tagName: "INPUT" } }); // not an HTMLElement instance
      assert.equal(calls, 2);
    } finally {
      renderer.cleanup();
    }
  }));
