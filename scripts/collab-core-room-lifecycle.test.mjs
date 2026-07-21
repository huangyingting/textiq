import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import * as Y from "yjs";

import { _testOnly } from "./collab-core.mjs";

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
    close() {
      this.closed = true;
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
