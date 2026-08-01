import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import * as Y from "yjs";

import { _testOnly, createCollabWss } from "./collab-core.mjs";

const originalConsoleError = console.error;

afterEach(() => {
  mock.timers.reset();
  console.error = originalConsoleError;
  for (const doc of _testOnly.docs.values()) {
    for (const conn of doc.conns.keys()) {
      conn.__events?.close?.();
    }
    doc.destroy();
  }
  _testOnly.docs.clear();
  _testOnly.evictTimers.forEach((timer) => clearTimeout(timer));
  _testOnly.evictTimers.clear();
  _testOnly.savedStateVectors.clear();
});

function fakeConn() {
  return {
    readyState: 1,
    __events: {},
    closed: false,
    sent: [],
    on(event, handler) {
      this.__events[event] = handler;
    },
    send(message, cb) {
      this.sent.push(message);
      cb?.();
    },
    ping() {},
    close(code, reason) {
      this.closed = true;
      this.closeCode = code;
      this.closeReason = reason;
    },
  };
}

function fakeUpgradeSocket() {
  return {
    destroyed: false,
    closed: false,
    writable: true,
    writes: [],
    write(value) {
      this.writes.push(String(value));
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

test("broadcast send failures retain onBeforeEvict for dirty final-connection eviction", () => {
  mock.timers.enable({ apis: ["setTimeout"], now: 0 });
  console.error = () => {};

  const conn = fakeConn();
  let flush = null;
  const onBeforeEvict = async (roomName, update) => {
    flush = { roomName, update };
  };

  _testOnly.setupConnection(conn, "doc-broadcast-evict", false, onBeforeEvict);
  const doc = _testOnly.docs.get("doc-broadcast-evict");
  assert.ok(doc, "room should be created");

  conn.send = (_message, cb) => cb(new Error("broadcast failed"));
  const source = new Y.Doc();
  source.getText("body").insert(0, "unsaved broadcast state");
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));

  assert.equal(conn.closed, true);
  assert.equal(doc.conns.has(conn), false);

  mock.timers.tick(60_000);

  assert.ok(flush, "dirty eviction should flush after broadcast send failure");
  assert.equal(flush.roomName, "doc-broadcast-evict");
  assert.ok(flush.update instanceof Uint8Array);
  assert.ok(flush.update.length > 2);

  source.destroy();
});

test("collab shutdown flushes dirty rooms, skips saved rooms, and rejects new upgrades", async () => {
  const flushed = [];
  const { handleUpgrade, shutdown } = createCollabWss(null, {
    authorize: async () => ({ ok: true }),
    onBeforeEvict: async (roomName, update) => {
      await Promise.resolve();
      flushed.push({ roomName, update });
    },
  });
  const dirtyConn = fakeConn();
  const savedConn = fakeConn();
  _testOnly.setupConnection(dirtyConn, "dirty-room");
  _testOnly.setupConnection(savedConn, "saved-room");

  const dirtySource = new Y.Doc();
  dirtySource.getText("body").insert(0, "pending shutdown edit");
  const dirtyDoc = _testOnly.docs.get("dirty-room");
  Y.applyUpdate(dirtyDoc, Y.encodeStateAsUpdate(dirtySource));

  const savedSource = new Y.Doc();
  savedSource.getText("body").insert(0, "already saved edit");
  const savedDoc = _testOnly.docs.get("saved-room");
  Y.applyUpdate(savedDoc, Y.encodeStateAsUpdate(savedSource));
  _testOnly.savedStateVectors.set("saved-room", Y.encodeStateVector(savedDoc));

  const firstShutdown = shutdown();
  assert.strictEqual(shutdown(), firstShutdown, "shutdown must be idempotent");
  await firstShutdown;

  assert.deepEqual(
    flushed.map(({ roomName }) => roomName),
    ["dirty-room"],
  );
  assert.ok(flushed[0].update instanceof Uint8Array);
  assert.ok(flushed[0].update.length > 2);
  assert.equal(dirtyConn.closed, true);
  assert.equal(dirtyConn.closeCode, 1012);
  assert.equal(dirtyConn.closeReason, "Service restart");
  assert.equal(savedConn.closed, true);
  assert.equal(_testOnly.docs.size, 0);
  assert.equal(_testOnly.evictTimers.size, 0);
  assert.equal(_testOnly.savedStateVectors.size, 0);

  const socket = fakeUpgradeSocket();
  await handleUpgrade(
    { headers: {}, socket: {}, url: "/after-shutdown" },
    socket,
    Buffer.alloc(0),
  );
  assert.match(socket.writes[0], /503 Service Unavailable/);
  assert.equal(socket.destroyed, true);

  dirtySource.destroy();
  savedSource.destroy();
});

test("collab shutdown closes an upgrade that was still authorizing", async () => {
  let resolveAuthorization;
  const authorization = new Promise((resolve) => {
    resolveAuthorization = resolve;
  });
  const { handleUpgrade, shutdown } = createCollabWss(null, {
    authorize: async () => authorization,
  });
  const socket = fakeUpgradeSocket();
  const upgrade = handleUpgrade(
    { headers: {}, socket: {}, url: "/authorization-race" },
    socket,
    Buffer.alloc(0),
  );

  const closing = shutdown();
  resolveAuthorization({ ok: true });
  await Promise.all([upgrade, closing]);

  assert.match(socket.writes[0], /503 Service Unavailable/);
  assert.equal(socket.destroyed, true);
});
