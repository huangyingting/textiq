import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { createLexicalWebsocketProviderAdapter } from "./lexical-provider-adapter";

type AdapterHarness = {
  doc: Y.Doc;
  provider: WebsocketProvider;
  adapter: ReturnType<typeof createLexicalWebsocketProviderAdapter>;
};

const harnesses = new Set<AdapterHarness>();

function createHarness(): AdapterHarness {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(
    "ws://127.0.0.1:1234",
    `room-${Date.now()}-${Math.random()}`,
    doc,
    { connect: false },
  );
  const adapter = createLexicalWebsocketProviderAdapter(provider, doc);
  const harness = { doc, provider, adapter };
  harnesses.add(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses) {
    harness.adapter.dispose();
    harness.provider.destroy();
    harness.doc.destroy();
    harnesses.delete(harness);
  }
});

describe("LexicalWebsocketProviderAdapter", () => {
  test("forwards status and sync subscriptions to y-websocket", () => {
    const { adapter, provider } = createHarness();

    const seen: string[] = [];
    const onStatus = (event: { status: string }) => {
      seen.push(`status:${event.status}`);
    };
    const onSync = (isSynced: boolean) => {
      seen.push(`sync:${isSynced}`);
    };

    adapter.on("status", onStatus);
    adapter.on("sync", onSync);

    provider.emit("status", [{ status: "connected" }]);
    provider.emit("sync", [true]);

    assert.deepEqual(seen, ["status:connected", "sync:true"]);

    adapter.off("status", onStatus);
    adapter.off("sync", onSync);

    provider.emit("status", [{ status: "disconnected" }]);
    provider.emit("sync", [false]);

    assert.deepEqual(seen, ["status:connected", "sync:true"]);
  });

  test("maps provider update listeners to Y.Doc updates", () => {
    const { adapter, doc } = createHarness();

    const updates: unknown[] = [];
    const onUpdate = (update: unknown) => {
      updates.push(update);
    };

    adapter.on("update", onUpdate);
    doc.getText("body").insert(0, "hello");

    assert.equal(updates.length, 1);
    assert.equal(updates[0] instanceof Uint8Array, true);

    adapter.off("update", onUpdate);
    doc.getText("body").insert(5, " world");

    assert.equal(updates.length, 1);
  });

  test("keeps reload listeners as explicit no-op compatibility hooks", () => {
    const { adapter } = createHarness();

    let called = false;
    const onReload = () => {
      called = true;
    };

    adapter.on("reload", onReload);
    adapter.off("reload", onReload);

    assert.equal(called, false);
  });

  test("adapts awareness update handlers and supports cleanup", () => {
    const { adapter } = createHarness();

    const calls: number[] = [];
    const onAwarenessUpdate = () => {
      calls.push(1);
    };

    adapter.awareness.on("update", onAwarenessUpdate);
    adapter.awareness.setLocalState({
      anchorPos: null,
      awarenessData: {},
      color: "#ff0000",
      focusPos: null,
      focusing: true,
      name: "Alice",
    });

    assert.equal(calls.length > 0, true);

    adapter.awareness.off("update", onAwarenessUpdate);
    const before = calls.length;
    adapter.awareness.setLocalStateField("name", "Bob");

    assert.equal(calls.length, before);
  });

  test("deduplicates update listeners when the same callback is registered twice", () => {
    const { adapter, doc } = createHarness();

    const updates: unknown[] = [];
    const onUpdate = (update: unknown) => {
      updates.push(update);
    };

    adapter.on("update", onUpdate);
    adapter.on("update", onUpdate);
    doc.getText("body").insert(0, "hello");

    assert.equal(updates.length, 1, "duplicate on must not double-fire");

    adapter.off("update", onUpdate);
    doc.getText("body").insert(5, " world");

    assert.equal(
      updates.length,
      1,
      "off must detach the single registered listener",
    );
  });

  test("deduplicates awareness update listeners when the same callback is registered twice", () => {
    const { adapter } = createHarness();

    const calls: number[] = [];
    const onAwarenessUpdate = () => {
      calls.push(1);
    };

    adapter.awareness.on("update", onAwarenessUpdate);
    adapter.awareness.on("update", onAwarenessUpdate);
    adapter.awareness.setLocalState({
      anchorPos: null,
      awarenessData: {},
      color: "#ff0000",
      focusPos: null,
      focusing: true,
      name: "Alice",
    });

    assert.equal(
      calls.length,
      1,
      "duplicate awareness on must not double-fire",
    );

    adapter.awareness.off("update", onAwarenessUpdate);
    const before = calls.length;
    adapter.awareness.setLocalStateField("name", "Bob");

    assert.equal(
      calls.length,
      before,
      "awareness off must detach the single registered listener",
    );
  });

  test("off on unregistered callback is a no-op and leaves other listeners intact", () => {
    const { adapter, doc } = createHarness();

    const updates: unknown[] = [];
    const registered = (u: unknown) => updates.push(u);
    const stranger = () => {};

    adapter.on("update", registered);
    adapter.off("update", stranger);
    doc.getText("body").insert(0, "x");

    assert.equal(
      updates.length,
      1,
      "registered listener must still fire after off of stranger",
    );
  });

  test("dispose leaves no doc or awareness listeners and no stale registry entries", () => {
    const { adapter, doc } = createHarness();

    let updates = 0;
    let awarenessUpdates = 0;
    const onUpdate = () => {
      updates += 1;
    };
    const onAwareness = () => {
      awarenessUpdates += 1;
    };

    adapter.on("update", onUpdate);
    adapter.awareness.on("update", onAwareness);

    adapter.dispose();

    // Second dispose must be a safe no-op
    adapter.dispose();

    doc.getText("body").insert(0, "ignored");
    adapter.awareness.setLocalState({
      anchorPos: null,
      awarenessData: {},
      color: "#00ff00",
      focusPos: null,
      focusing: false,
      name: "Eve",
    });

    assert.equal(updates, 0, "no doc update after dispose");
    assert.equal(awarenessUpdates, 0, "no awareness update after dispose");
  });
});
