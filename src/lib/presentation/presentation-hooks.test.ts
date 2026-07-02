import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Deck } from "./deck";
import { useDeckHistory } from "./use-deck-history";
import { useImageUpload } from "./use-image-upload";
import { useSlideFontsReady } from "./slide-font-loading";
import {
  SLIDE_PRESENCE_AWARENESS_KEY,
  useSlidePresence,
  type SlidePresencePayload,
} from "@/lib/presentation-shared/use-slide-presence";
import { withReactTestDispatcher } from "@/test/react-server-renderer";

function withHookDispatcher<T>(
  overrides: Record<string, (...args: any[]) => any>,
  run: () => T,
): T {
  return withReactTestDispatcher(
    {
      useCallback: (callback: unknown) => callback,
      useEffect: (effect: () => void | (() => void)) => effect(),
      useReducer: (
        _reducer: unknown,
        initialArg: unknown,
        init?: (arg: unknown) => unknown,
      ) => [init ? init(initialArg) : initialArg, () => {}],
      useRef: (current: unknown) => ({ current }),
      useState: (initial: unknown) => [
        typeof initial === "function" ? initial() : initial,
        () => {},
      ],
      ...overrides,
    },
    run,
  );
}

function deck(title = "Initial"): Deck {
  return {
    schemaVersion: 6,
    canvas: { format: "16:9" },
    design: { themeId: "default" },
    masters: [{ id: "master-default", name: "Default", elements: [] }],
    defaultMasterId: "master-default",
    slides: [{ id: "slide-1", index: 0, title, notes: "", elements: [] }],
  } as Deck;
}

describe("presentation React hooks under a minimal dispatcher", () => {
  it("useDeckHistory exposes state and dispatches imperative actions", () => {
    const actions: unknown[] = [];
    const api = withHookDispatcher(
      {
        useReducer: (_reducer, initialArg, init) => [
          init ? init(initialArg) : initialArg,
          (action: unknown) => actions.push(action),
        ],
      },
      () => useDeckHistory(deck("Initial")),
    );

    const next = deck("Next");
    api.commit(next, { coalesceKey: "drag:1" });
    api.replace(next);
    api.undo();
    api.redo();

    assert.equal(api.present.slides[0]?.title, "Initial");
    assert.deepEqual(actions, [
      { type: "commit", deck: next, coalesceKey: "drag:1" },
      { type: "replace", deck: next },
      { type: "undo" },
      { type: "redo" },
    ]);
  });

  it("useImageUpload ignores empty files and surfaces validation errors", () => {
    const errors: string[] = [];
    const accepted: string[] = [];
    const { handleFile } = withHookDispatcher({}, () =>
      useImageUpload({
        deck: deck(),
        onAccept: (src) => accepted.push(src),
        onError: (message) => errors.push(message),
      }),
    );

    handleFile(undefined);
    handleFile(new File(["not an image"], "notes.txt", { type: "text/plain" }));

    assert.deepEqual(accepted, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /image/i);
  });

  it("useSlideFontsReady starts loading browser fonts and returns initial readiness", () => {
    const originalDocument = globalThis.document;
    const loadedSpecs: string[] = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        fonts: {
          load: (spec: string) => {
            loadedSpecs.push(spec);
            return Promise.resolve([]);
          },
          ready: Promise.resolve(),
        },
      },
    });

    try {
      const ready = withHookDispatcher({}, () => useSlideFontsReady(["inter"]));
      assert.equal(ready, false);
      assert.ok(loadedSpecs.length > 0);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("useSlidePresence publishes local payload and subscribes to awareness", () => {
    const listeners: Array<() => void> = [];
    const localWrites: unknown[] = [];
    const states = new Map<number, Record<string, unknown>>();
    const remotePayload: SlidePresencePayload = {
      documentId: "doc-1",
      userName: "Remote",
      userId: "remote-1",
      selectedSlideId: "slide-2",
      selectedNodeIds: ["el-1"],
      editingMode: "selecting",
    };
    states.set(7, { [SLIDE_PRESENCE_AWARENESS_KEY]: remotePayload });
    const awareness = {
      clientID: 3,
      getStates: () => states,
      setLocalStateField: (_key: string, value: unknown) =>
        localWrites.push(value),
      on: (_event: "change", handler: () => void) => listeners.push(handler),
      off: (_event: "change", handler: () => void) => {
        const index = listeners.indexOf(handler);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
    const peerUpdates: unknown[] = [];

    const result = withHookDispatcher(
      {
        useState: (initial) => [
          typeof initial === "function" ? initial() : initial,
          (value: unknown) => peerUpdates.push(value),
        ],
      },
      () =>
        useSlidePresence({
          documentId: "doc-1",
          userName: "Local",
          userId: "local-1",
          selectedSlideId: "slide-1",
          selectedNodeIds: [],
          editingMode: "browsing",
          awareness,
        }),
    );

    assert.equal(result.local.userName, "Local");
    assert.equal(
      (localWrites[0] as SlidePresencePayload).selectedSlideId,
      "slide-1",
    );
    assert.equal(listeners.length, 1);
    assert.equal((peerUpdates[0] as unknown[]).length, 1);
  });
});
