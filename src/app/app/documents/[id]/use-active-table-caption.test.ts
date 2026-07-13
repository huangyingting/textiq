/**
 * Direct contracts for `activeTableCaptionKey` and `useActiveTableCaptionKey`
 * (#1946).
 *
 * `activeTableCaptionKey` is the pure DOM reader: it walks up from
 * `document.activeElement` to the nearest `[data-document-table-caption-input]`
 * ancestor and returns its `data-table-key`. `useActiveTableCaptionKey` is the
 * React bridge that keeps a React state value in sync with it, refreshing on
 * `focusin`/`focusout` (deferred one microtask so the *new* active element has
 * already committed by the time it re-reads `document.activeElement`).
 *
 * A minimal `FakeElement` (dataset + `closest`) stands in for `HTMLElement`,
 * installed via `globalThis.HTMLElement`/`globalThis.document` the same way
 * `inline-comment-dom.test.ts` and `present-shell.test.ts` do — a real,
 * dispatching `document` (not the shared harness's no-op stub) is required
 * here because the hook's own `focusin`/`focusout` listeners must actually
 * fire for the async-refresh contract to be exercised.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  activeTableCaptionKey,
  TABLE_CAPTION_INPUT_SELECTOR,
  useActiveTableCaptionKey,
} from "./use-active-table-caption";

class FakeElement {
  constructor(
    public readonly dataset: Record<string, string> = {},
    private readonly ancestorMatch: FakeElement | null = null,
  ) {}

  closest(selector: string): FakeElement | null {
    if (selector === TABLE_CAPTION_INPUT_SELECTOR) {
      return this.ancestorMatch;
    }
    return null;
  }
}

type ListenerMap = Map<string, Set<(event: unknown) => void>>;

function createFakeDocument(initial: { activeElement?: unknown } = {}) {
  const listeners: ListenerMap = new Map();
  let activeElement: unknown = initial.activeElement ?? null;

  const fakeDocument = {
    get activeElement() {
      return activeElement;
    },
    addEventListener(type: string, handler: (event: unknown) => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: (event: unknown) => void) {
      listeners.get(type)?.delete(handler);
    },
  };

  return {
    document: fakeDocument,
    setActiveElement(value: unknown) {
      activeElement = value;
    },
    dispatch(type: string) {
      for (const handler of Array.from(listeners.get(type) ?? [])) {
        handler({});
      }
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

async function withFakeDom<T>(
  activeElement: unknown,
  run: (fake: ReturnType<typeof createFakeDocument>) => T | Promise<T>,
): Promise<T> {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousHTMLElement = Object.getOwnPropertyDescriptor(
    globalThis,
    "HTMLElement",
  );
  const fake = createFakeDocument({ activeElement });
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
    return await run(fake);
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

async function waitForScheduledEffects() {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// activeTableCaptionKey — pure DOM reader
// ---------------------------------------------------------------------------

test("activeTableCaptionKey returns null when document is undefined (SSR)", () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.equal(activeTableCaptionKey(), null);
});

test("activeTableCaptionKey returns null when there is no active element", () =>
  withFakeDom(null, () => {
    assert.equal(activeTableCaptionKey(), null);
  }));

test("activeTableCaptionKey returns null when the active element is not an HTMLElement", () =>
  withFakeDom({ dataset: { tableKey: "t1" } }, () => {
    assert.equal(activeTableCaptionKey(), null);
  }));

test("activeTableCaptionKey returns null when the active element has no caption-input ancestor", () => {
  const active = new FakeElement({}, null);
  return withFakeDom(active, () => {
    assert.equal(activeTableCaptionKey(), null);
  });
});

test("activeTableCaptionKey reads the tableKey off the matched caption input's dataset", () => {
  const input = new FakeElement({ tableKey: "table-42" });
  const active = new FakeElement({}, input);
  return withFakeDom(active, () => {
    assert.equal(activeTableCaptionKey(), "table-42");
  });
});

test("activeTableCaptionKey returns null when the matched input carries no tableKey dataset entry", () => {
  const input = new FakeElement({});
  const active = new FakeElement({}, input);
  return withFakeDom(active, () => {
    assert.equal(activeTableCaptionKey(), null);
  });
});

// ---------------------------------------------------------------------------
// useActiveTableCaptionKey — React bridge
// ---------------------------------------------------------------------------

test("useActiveTableCaptionKey captures the initial active caption key on mount", () =>
  withFakeDom(
    (() => {
      const input = new FakeElement({ tableKey: "initial-key" });
      return new FakeElement({}, input);
    })(),
    (fake) => {
      const renderer = createReactRenderHarness();
      try {
        const tableKey = renderer.run(() => useActiveTableCaptionKey());
        assert.equal(tableKey, "initial-key");
        // The hook registers exactly one focusin and one focusout listener.
        assert.equal(fake.listenerCount("focusin"), 1);
        assert.equal(fake.listenerCount("focusout"), 1);
      } finally {
        renderer.cleanup();
      }
    },
  ));

test("useActiveTableCaptionKey refreshes asynchronously after a focusin event", () =>
  withFakeDom(null, async (fake) => {
    const renderer = createReactRenderHarness();
    try {
      const render = () => renderer.run(() => useActiveTableCaptionKey());
      assert.equal(render(), null);

      const input = new FakeElement({ tableKey: "focused-in" });
      fake.setActiveElement(new FakeElement({}, input));
      fake.dispatch("focusin");
      // The handler defers the actual re-read via queueMicrotask, so the
      // state has not updated yet immediately after dispatch.
      await waitForScheduledEffects();

      assert.equal(render(), "focused-in");
    } finally {
      renderer.cleanup();
    }
  }));

test("useActiveTableCaptionKey refreshes to null after a focusout event moves focus away", () => {
  const input = new FakeElement({ tableKey: "will-blur" });
  const active = new FakeElement({}, input);
  return withFakeDom(active, async (fake) => {
    const renderer = createReactRenderHarness();
    try {
      const render = () => renderer.run(() => useActiveTableCaptionKey());
      assert.equal(render(), "will-blur");

      fake.setActiveElement(null);
      fake.dispatch("focusout");
      await waitForScheduledEffects();

      assert.equal(render(), null);
    } finally {
      renderer.cleanup();
    }
  });
});

test("useActiveTableCaptionKey removes its focusin/focusout listeners on unmount", () =>
  withFakeDom(null, (fake) => {
    const renderer = createReactRenderHarness();
    renderer.run(() => useActiveTableCaptionKey());
    assert.equal(fake.listenerCount("focusin"), 1);
    assert.equal(fake.listenerCount("focusout"), 1);

    renderer.cleanup();

    assert.equal(fake.listenerCount("focusin"), 0);
    assert.equal(fake.listenerCount("focusout"), 0);
  }));
