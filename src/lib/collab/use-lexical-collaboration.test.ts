import assert from "node:assert/strict";
import { test } from "node:test";
import type { Provider } from "@lexical/yjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import {
  createReactRenderHarness,
  withDefaultDom,
} from "@/test/react-render-harness";

import { isLexicalWebsocketProviderAdapter } from "./lexical-provider-adapter";
import { colorFromId } from "./y-text";
import {
  useLexicalCollaboration,
  type LexicalCollaboration,
} from "./use-lexical-collaboration";

type FakeTimer = { callback: () => void; delay: number; cleared: boolean };

function withFakeTimers<T>(run: (timers: Map<number, FakeTimer>) => T): T {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map<number, FakeTimer>();
  let nextId = 1;

  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const id = nextId++;
    timers.set(id, { callback, delay: delay ?? 0, cleared: false });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: unknown) => {
    const entry = timers.get(id as number);
    if (entry) {
      entry.cleared = true;
    }
  }) as typeof clearTimeout;

  const restore = () => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  };

  let result: T;
  try {
    result = run(timers);
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) {
    return result.then(
      (value) => {
        restore();
        return value;
      },
      (error: unknown) => {
        restore();
        throw error;
      },
    ) as T;
  }
  restore();
  return result;
}

function mountCollaboration(opts: { room: string; userName: string }): {
  harness: ReturnType<typeof createReactRenderHarness>;
  get: () => LexicalCollaboration;
} {
  let latest: LexicalCollaboration | undefined;
  const harness = createReactRenderHarness();
  withDefaultDom(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { host: "textiq.test", protocol: "https:" },
    });
    harness.run(() => {
      latest = useLexicalCollaboration(opts);
      return latest;
    });
  });
  return {
    harness,
    get: () => {
      assert.ok(latest, "expected the hook to have rendered");
      return latest as LexicalCollaboration;
    },
  };
}

function websocketFromProvider(provider: Provider): WebsocketProvider {
  if (!isLexicalWebsocketProviderAdapter(provider)) {
    throw new Error("expected lexical provider adapter");
  }
  return provider.websocketProvider;
}

// ---------------------------------------------------------------------------
// useLexicalCollaboration — initial state
// ---------------------------------------------------------------------------

test("useLexicalCollaboration: SSR does not allocate Node websocket exit listeners", () => {
  function ServerProbe() {
    useLexicalCollaboration({ room: "room-ssr", userName: "Alice" });
    return null;
  }

  const before = process.listenerCount("exit");
  for (let index = 0; index < 12; index += 1) {
    renderToStaticMarkup(createElement(ServerProbe));
  }

  assert.equal(process.listenerCount("exit"), before);
});

test("useLexicalCollaboration: starts connecting, unready, unsynced, un-degraded, with no peers", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-initial",
      userName: "Alice",
    });
    try {
      const state = get();
      assert.equal(state.status, "connecting");
      assert.equal(state.ready, false);
      assert.equal(state.synced, false);
      assert.equal(state.degraded, false);
      assert.deepEqual(state.peers, []);
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// providerFactory — Y.Doc map wiring for the Lexical CollaborationPlugin
// ---------------------------------------------------------------------------

test("useLexicalCollaboration: providerFactory registers the shared Y.Doc under the given id", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-factory-1",
      userName: "Alice",
    });
    try {
      const state = get();
      const map = new Map<string, Y.Doc>();
      const provider = state.providerFactory("doc-1", map);

      assert.ok(map.has("doc-1"));
      assert.equal(map.get("doc-1")?.getText("title"), state.ytitle);
      assert.ok(provider);
    } finally {
      harness.cleanup();
    }
  });
});

test("useLexicalCollaboration: providerFactory does not overwrite an existing doc registered for the same id", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-factory-2",
      userName: "Alice",
    });
    try {
      const state = get();
      const otherDoc = new Y.Doc();
      const map = new Map<string, Y.Doc>([["doc-1", otherDoc]]);

      state.providerFactory("doc-1", map);

      assert.equal(map.get("doc-1"), otherDoc);
    } finally {
      harness.cleanup();
    }
  });
});

test("useLexicalCollaboration: cursorColor is derived deterministically from the provider's awareness clientID", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-color",
      userName: "Alice",
    });
    try {
      const state = get();
      const provider = websocketFromProvider(
        state.providerFactory("doc-1", new Map()),
      );

      assert.equal(state.cursorColor, colorFromId(provider.awareness.clientID));
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// status / sync — provider event wiring and cleanup
// ---------------------------------------------------------------------------

test("useLexicalCollaboration: status reflects the provider's status events", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-status",
      userName: "Alice",
    });
    try {
      const provider = websocketFromProvider(
        get().providerFactory("doc-1", new Map()),
      );

      act(() => {
        provider.emit("status", [{ status: "connected" }]);
      });
      assert.equal(get().status, "connected");

      act(() => {
        provider.emit("status", [{ status: "disconnected" }]);
      });
      assert.equal(get().status, "disconnected");
    } finally {
      harness.cleanup();
    }
  });
});

test("useLexicalCollaboration: synced flips to true (and ready follows) once the provider reports a sync, and ignores sync(false)", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-sync",
      userName: "Alice",
    });
    try {
      const provider = websocketFromProvider(
        get().providerFactory("doc-1", new Map()),
      );

      act(() => {
        provider.emit("sync", [false]);
      });
      assert.equal(get().synced, false);
      assert.equal(get().ready, false);

      act(() => {
        provider.emit("sync", [true]);
      });
      assert.equal(get().synced, true);
      assert.equal(get().ready, true);
    } finally {
      harness.cleanup();
    }
  });
});

test("useLexicalCollaboration: removes the provider status/sync listeners on unmount", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-status-cleanup",
      userName: "Alice",
    });
    const provider = websocketFromProvider(
      get().providerFactory("doc-1", new Map()),
    );

    assert.ok((provider._observers.get("status")?.size ?? 0) > 0);
    assert.ok((provider._observers.get("sync")?.size ?? 0) > 0);

    harness.cleanup();

    assert.equal(provider._observers.get("status")?.size ?? 0, 0);
    assert.equal(provider._observers.get("sync")?.size ?? 0, 0);
  });
});

// ---------------------------------------------------------------------------
// degraded fallback timer
// ---------------------------------------------------------------------------

test("useLexicalCollaboration: falls into degraded (ready) mode if the server never syncs within the timeout", () => {
  withFakeTimers((timers) => {
    const { harness, get } = mountCollaboration({
      room: "room-degraded",
      userName: "Alice",
    });
    try {
      const [timer] = [...timers.values()];
      assert.ok(timer, "expected the degrade timer to be scheduled");
      assert.equal(timer.delay, 2500);
      assert.equal(get().degraded, false);
      assert.equal(get().ready, false);

      act(() => {
        timer.callback();
      });

      assert.equal(get().degraded, true);
      assert.equal(get().ready, true);
    } finally {
      harness.cleanup();
    }
  });
});

test("useLexicalCollaboration: a sync before the timeout leaves degraded false forever, and the pending timer is cleared on unmount", () => {
  withFakeTimers((timers) => {
    const { harness, get } = mountCollaboration({
      room: "room-synced-before-degraded",
      userName: "Alice",
    });
    try {
      const provider = websocketFromProvider(
        get().providerFactory("doc-1", new Map()),
      );
      const [timer] = [...timers.values()];
      assert.equal(timer.cleared, false);

      act(() => {
        provider.emit("sync", [true]);
      });
      assert.equal(get().ready, true);
      assert.equal(get().degraded, false);

      act(() => {
        timer.callback();
      });
      assert.equal(get().ready, true);
      assert.equal(get().degraded, false);
      assert.equal(timer.cleared, true);

      harness.cleanup();
      assert.equal(timer.cleared, true);
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// awareness → peers
// ---------------------------------------------------------------------------

test("useLexicalCollaboration: awareness changes during another component's render do not synchronously update peers", async () => {
  await withDefaultDom(async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { host: "textiq.test", protocol: "https:" },
    });

    let collaboration: LexicalCollaboration | undefined;
    let renderer: ReactTestRenderer | null = null;
    let awarenessTriggered = false;
    const yjsDocMap = new Map<string, Y.Doc>();
    const renderErrors: string[] = [];

    function AwarenessRenderTrigger() {
      if (!awarenessTriggered) {
        awarenessTriggered = true;
        assert.ok(collaboration, "expected collaboration state before trigger");
        const lexicalProvider = collaboration.providerFactory(
          "doc-render-awareness",
          yjsDocMap,
        );
        lexicalProvider.awareness.setLocalState({
          anchorPos: null,
          awarenessData: {},
          color: collaboration.cursorColor,
          focusPos: null,
          focusing: false,
          name: "Alice",
        });
      }
      return null;
    }

    function CollaborationOwner({ trigger }: { trigger: boolean }) {
      collaboration = useLexicalCollaboration({
        room: "room-render-awareness",
        userName: "Alice",
      });
      return trigger ? createElement(AwarenessRenderTrigger) : null;
    }

    try {
      act(() => {
        renderer = create(
          createElement(CollaborationOwner, { trigger: false }),
        );
      });

      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        renderErrors.push(args.map(String).join(" "));
      };
      try {
        await act(async () => {
          renderer?.update(
            createElement(CollaborationOwner, { trigger: true }),
          );
          await Promise.resolve();
        });
      } finally {
        console.error = originalConsoleError;
      }

      const crossComponentUpdateErrors = renderErrors.filter((message) =>
        message.includes(
          "Cannot update a component (`%s`) while rendering a different component (`%s`)",
        ),
      );
      assert.deepEqual(
        crossComponentUpdateErrors,
        [],
        `unexpected render-phase update: ${crossComponentUpdateErrors.join("\n")}`,
      );
      assert.deepEqual(
        collaboration?.peers.map((peer) => peer.name),
        ["Alice"],
      );
    } finally {
      act(() => {
        renderer?.unmount();
      });
    }
  });
});

test("useLexicalCollaboration: computes peers from awareness state, self first then by join order", async () => {
  await withFakeTimers(async () => {
    const { harness, get } = mountCollaboration({
      room: "room-peers",
      userName: "Alice",
    });
    try {
      const provider = websocketFromProvider(
        get().providerFactory("doc-1", new Map()),
      );
      const awareness = provider.awareness;
      const selfId = awareness.clientID;

      await act(async () => {
        awareness.setLocalStateField("name", "Alice");
        await Promise.resolve();
      });
      assert.deepEqual(get().peers, [
        {
          clientId: selfId,
          name: "Alice",
          color: get().cursorColor,
          self: true,
        },
      ]);

      // Simulate a remote peer joining awareness using the real Awareness
      // instance's own state map + change event (not a mock/stub).
      const remoteId = selfId + 1;
      await act(async () => {
        awareness.states.set(remoteId, { name: "Bob", color: "#123456" });
        awareness.emit("change", [
          { added: [remoteId], updated: [], removed: [] },
          "remote",
        ]);
        await Promise.resolve();
      });

      assert.deepEqual(get().peers, [
        {
          clientId: selfId,
          name: "Alice",
          color: get().cursorColor,
          self: true,
        },
        { clientId: remoteId, name: "Bob", color: "#123456", self: false },
      ]);
    } finally {
      harness.cleanup();
    }
  });
});

test("useLexicalCollaboration: awareness states without a name are excluded from peers", async () => {
  await withFakeTimers(async () => {
    const { harness, get } = mountCollaboration({
      room: "room-peers-filter",
      userName: "Alice",
    });
    try {
      const provider = websocketFromProvider(
        get().providerFactory("doc-1", new Map()),
      );
      const awareness = provider.awareness;
      const remoteId = awareness.clientID + 1;

      await act(async () => {
        awareness.states.set(remoteId, { color: "#123456" });
        awareness.emit("change", [
          { added: [remoteId], updated: [], removed: [] },
          "remote",
        ]);
        await Promise.resolve();
      });

      assert.deepEqual(get().peers, []);
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// unmount teardown
// ---------------------------------------------------------------------------

test("useLexicalCollaboration: destroys the provider and Y.Doc on unmount", () => {
  withFakeTimers(() => {
    const exitListenersBeforeMount = process.listenerCount("exit");
    const { harness, get } = mountCollaboration({
      room: "room-teardown",
      userName: "Alice",
    });
    const map = new Map<string, Y.Doc>();
    const provider = websocketFromProvider(get().providerFactory("doc-1", map));
    const doc = map.get("doc-1")!;

    assert.equal(doc.isDestroyed, false);
    assert.equal(process.listenerCount("exit"), exitListenersBeforeMount + 1);

    harness.cleanup();

    assert.equal(doc.isDestroyed, true);
    assert.equal(provider._observers.size, 0);
    assert.equal(process.listenerCount("exit"), exitListenersBeforeMount);
  });
});

// ---------------------------------------------------------------------------
// seedTitle — one-shot DB → shared-text seeding
// ---------------------------------------------------------------------------

test("useLexicalCollaboration: seedTitle inserts the DB title into an empty shared title exactly once", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-seed-1",
      userName: "Alice",
    });
    try {
      assert.equal(get().ytitle.length, 0);

      act(() => {
        get().seedTitle("Quarterly Report");
      });
      assert.equal(get().ytitle.toString(), "Quarterly Report");

      act(() => {
        get().seedTitle("Something Else");
      });
      assert.equal(get().ytitle.toString(), "Quarterly Report");
    } finally {
      harness.cleanup();
    }
  });
});

test("useLexicalCollaboration: seedTitle never overwrites an already-populated shared title", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-seed-2",
      userName: "Alice",
    });
    try {
      const { ytitle } = get();
      act(() => {
        ytitle.doc?.transact(() => ytitle.insert(0, "Existing Title"));
      });

      act(() => {
        get().seedTitle("DB Title");
      });

      assert.equal(ytitle.toString(), "Existing Title");
    } finally {
      harness.cleanup();
    }
  });
});

test("useLexicalCollaboration: seedTitle with an empty DB title is a no-op but still latches seeded", () => {
  withFakeTimers(() => {
    const { harness, get } = mountCollaboration({
      room: "room-seed-3",
      userName: "Alice",
    });
    try {
      act(() => {
        get().seedTitle("");
      });
      assert.equal(get().ytitle.toString(), "");

      act(() => {
        get().seedTitle("Later Title");
      });
      // Guarded by the one-shot latch, not just the empty check: a later,
      // non-empty title still does not get seeded once seedTitle has run.
      assert.equal(get().ytitle.toString(), "");
    } finally {
      harness.cleanup();
    }
  });
});
