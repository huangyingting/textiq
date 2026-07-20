import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import { _testOnly, connCount, createCollabWss } from "./collab-core.mjs";

const originalEnv = { ...process.env };
const originalConsoleError = console.error;

afterEach(() => {
  mock.timers.reset();
  process.env = { ...originalEnv };
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
  _testOnly.upgradeWindows.clear();
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

function awarenessMessageFrom(awareness) {
  const message = encoding.createEncoder();
  encoding.writeVarUint(message, 1);
  encoding.writeVarUint8Array(
    message,
    awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]),
  );
  return encoding.toUint8Array(message);
}

test("collab upgrade limiter blocks after configured budget", () => {
  process.env.COLLAB_UPGRADE_RATE_LIMIT = "1";
  process.env.COLLAB_UPGRADE_RATE_WINDOW_MS = "1000";
  assert.equal(_testOnly.allowUpgradeAttempt("203.0.113.1", 0), true);
  assert.equal(_testOnly.allowUpgradeAttempt("203.0.113.1", 10), false);
  assert.equal(_testOnly.allowUpgradeAttempt("203.0.113.1", 1001), true);
});

test("collab upgrade limiter allows attempts within the configured budget", () => {
  process.env.COLLAB_UPGRADE_RATE_LIMIT = "2";
  process.env.COLLAB_UPGRADE_RATE_WINDOW_MS = "1000";
  assert.equal(_testOnly.allowUpgradeAttempt("203.0.113.2", 0), true);
  assert.equal(_testOnly.allowUpgradeAttempt("203.0.113.2", 10), true);
  assert.equal(_testOnly.allowUpgradeAttempt("203.0.113.2", 20), false);
});

test("collab setup enforces room connection cap", () => {
  process.env.COLLAB_MAX_CONNECTIONS_PER_ROOM = "1";
  console.error = () => {};
  const first = fakeConn();
  const second = fakeConn();
  _testOnly.setupConnection(first, "doc-1");
  _testOnly.setupConnection(second, "doc-1");

  assert.equal(first.closed, false);
  assert.equal(second.closed, true);
  assert.equal(connCount(), 1);
});

test("collab message listener closes oversized messages", () => {
  process.env.COLLAB_MAX_MESSAGE_BYTES = "4";
  console.error = () => {};
  const conn = fakeConn();
  _testOnly.setupConnection(conn, "doc-2");
  const doc = _testOnly.docs.get("doc-2");

  _testOnly.messageListener(conn, doc, new Uint8Array(5), false);

  assert.equal(conn.closed, true);
  assert.equal(doc.conns.has(conn), false);
  conn.__events.close();
});

test("collab setup enforces total connection cap before creating a room", () => {
  process.env.COLLAB_MAX_CONNECTIONS_TOTAL = "1";
  console.error = () => {};
  const first = fakeConn();
  const conn = fakeConn();
  _testOnly.setupConnection(first, "doc-total-cap-a");

  _testOnly.setupConnection(conn, "doc-total-cap-b");

  assert.equal(first.closed, false);
  assert.equal(conn.closed, true);
  assert.equal(_testOnly.docs.has("doc-total-cap-b"), false);
  first.__events.close();
});

test("collab message event forwards websocket payloads through protocol handling", () => {
  const conn = fakeConn();
  _testOnly.setupConnection(conn, "doc-message-event");

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 3);
  conn.__events.message(encoding.toUint8Array(encoder).buffer);

  assert.equal(conn.sent.length >= 2, true);
  conn.__events.close();
});

test("collab message listener handles sync, awareness, query, default, and malformed messages", () => {
  console.error = () => {};
  const writer = fakeConn();
  const viewer = fakeConn();
  _testOnly.setupConnection(writer, "doc-protocol");
  _testOnly.setupConnection(viewer, "doc-protocol", true);
  const doc = _testOnly.docs.get("doc-protocol");

  const step1 = encoding.createEncoder();
  encoding.writeVarUint(step1, 0);
  syncProtocol.writeSyncStep1(step1, new Y.Doc());
  _testOnly.messageListener(viewer, doc, encoding.toUint8Array(step1), true);

  const source = new Y.Doc();
  source.getText("body").insert(0, "writer update");
  const update = Y.encodeStateAsUpdate(source);
  const step2Message = encoding.createEncoder();
  encoding.writeVarUint(step2Message, 0);
  syncProtocol.writeSyncStep2(step2Message, source);
  _testOnly.messageListener(
    writer,
    doc,
    encoding.toUint8Array(step2Message),
    false,
  );

  const updateMessage = encoding.createEncoder();
  encoding.writeVarUint(updateMessage, 0);
  syncProtocol.writeUpdate(updateMessage, update);
  _testOnly.messageListener(
    writer,
    doc,
    encoding.toUint8Array(updateMessage),
    false,
  );

  const readonlyUpdate = encoding.createEncoder();
  encoding.writeVarUint(readonlyUpdate, 0);
  syncProtocol.writeUpdate(readonlyUpdate, update);
  _testOnly.messageListener(
    viewer,
    doc,
    encoding.toUint8Array(readonlyUpdate),
    true,
  );

  const remoteAwareness = new awarenessProtocol.Awareness(new Y.Doc());
  remoteAwareness.setLocalState({ name: "Ghost" });
  const awarenessMessage = encoding.createEncoder();
  encoding.writeVarUint(awarenessMessage, 1);
  encoding.writeVarUint8Array(
    awarenessMessage,
    awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [
      remoteAwareness.clientID,
    ]),
  );
  _testOnly.messageListener(
    writer,
    doc,
    encoding.toUint8Array(awarenessMessage),
    false,
  );
  assert.equal(doc.conns.get(writer).has(remoteAwareness.clientID), true);

  remoteAwareness.setLocalState(null);
  const awarenessRemove = encoding.createEncoder();
  encoding.writeVarUint(awarenessRemove, 1);
  encoding.writeVarUint8Array(
    awarenessRemove,
    awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [
      remoteAwareness.clientID,
    ]),
  );
  _testOnly.messageListener(
    writer,
    doc,
    encoding.toUint8Array(awarenessRemove),
    false,
  );
  assert.equal(doc.conns.get(writer).has(remoteAwareness.clientID), false);

  const query = encoding.createEncoder();
  encoding.writeVarUint(query, 3);
  _testOnly.messageListener(writer, doc, encoding.toUint8Array(query), false);

  const unknown = encoding.createEncoder();
  encoding.writeVarUint(unknown, 99);
  _testOnly.messageListener(writer, doc, encoding.toUint8Array(unknown), false);
  _testOnly.messageListener(writer, doc, new Uint8Array([128]), false);

  assert.equal(writer.sent.length > 0, true);
  source.destroy();
  remoteAwareness.doc.destroy();
  connCleanup(writer, viewer);
});

test("collab awareness updates cannot spoof another connection's presence", () => {
  const writer = fakeConn();
  const viewer = fakeConn();
  _testOnly.setupConnection(writer, "doc-awareness-ownership");
  _testOnly.setupConnection(viewer, "doc-awareness-ownership", true);
  const doc = _testOnly.docs.get("doc-awareness-ownership");
  const writerAwareness = new awarenessProtocol.Awareness(new Y.Doc());
  const viewerAwareness = new awarenessProtocol.Awareness(new Y.Doc());

  writerAwareness.setLocalState({ name: "Writer" });
  _testOnly.messageListener(
    writer,
    doc,
    awarenessMessageFrom(writerAwareness),
    false,
  );

  assert.deepEqual(doc.awareness.getStates().get(writerAwareness.clientID), {
    name: "Writer",
  });
  assert.equal(doc.conns.get(writer).has(writerAwareness.clientID), true);

  writerAwareness.setLocalState({ name: "Spoofed" });
  _testOnly.messageListener(
    viewer,
    doc,
    awarenessMessageFrom(writerAwareness),
    true,
  );

  assert.deepEqual(doc.awareness.getStates().get(writerAwareness.clientID), {
    name: "Writer",
  });
  assert.equal(doc.conns.get(viewer).has(writerAwareness.clientID), false);

  writerAwareness.setLocalState(null);
  _testOnly.messageListener(
    viewer,
    doc,
    awarenessMessageFrom(writerAwareness),
    true,
  );

  assert.deepEqual(doc.awareness.getStates().get(writerAwareness.clientID), {
    name: "Writer",
  });

  viewerAwareness.setLocalState({ name: "Viewer" });
  _testOnly.messageListener(
    viewer,
    doc,
    awarenessMessageFrom(viewerAwareness),
    true,
  );

  assert.deepEqual(doc.awareness.getStates().get(viewerAwareness.clientID), {
    name: "Viewer",
  });
  assert.equal(doc.conns.get(viewer).has(viewerAwareness.clientID), true);

  writerAwareness.doc.destroy();
  viewerAwareness.doc.destroy();
  connCleanup(writer, viewer);
});

test("collab message listener closes sockets on oversized awareness payloads", () => {
  process.env.COLLAB_MAX_AWARENESS_BYTES = "1";
  process.env.COLLAB_MAX_MESSAGE_BYTES = "1000";
  console.error = () => {};
  const conn = fakeConn();
  _testOnly.setupConnection(conn, "doc-large-awareness");
  const doc = _testOnly.docs.get("doc-large-awareness");
  const remoteAwareness = new awarenessProtocol.Awareness(new Y.Doc());
  remoteAwareness.setLocalState({ name: "Ghost" });
  const awarenessMessage = encoding.createEncoder();
  encoding.writeVarUint(awarenessMessage, 1);
  encoding.writeVarUint8Array(
    awarenessMessage,
    awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [
      remoteAwareness.clientID,
    ]),
  );

  _testOnly.messageListener(
    conn,
    doc,
    encoding.toUint8Array(awarenessMessage),
    false,
  );

  assert.equal(conn.closed, true);
  assert.equal(doc.conns.has(conn), false);
  remoteAwareness.doc.destroy();
  conn.__events.close();
});

test("collab message listener rate limit resets and then closes noisy sockets", () => {
  process.env.COLLAB_MAX_MESSAGES_PER_WINDOW = "1";
  process.env.COLLAB_MESSAGE_WINDOW_MS = "10";
  console.error = () => {};
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  const conn = fakeConn();
  try {
    _testOnly.setupConnection(conn, "doc-message-rate");
    const doc = _testOnly.docs.get("doc-message-rate");
    const unknown = encoding.createEncoder();
    encoding.writeVarUint(unknown, 99);
    const bytes = encoding.toUint8Array(unknown);

    _testOnly.messageListener(conn, doc, bytes, false);
    now = 11;
    _testOnly.messageListener(conn, doc, bytes, false);
    _testOnly.messageListener(conn, doc, bytes, false);

    assert.equal(conn.closed, true);
    assert.equal(doc.conns.has(conn), false);
  } finally {
    Date.now = originalNow;
    conn.__events.close();
  }
});

test("collab awareness snapshot is sent to new room connections", () => {
  const first = fakeConn();
  _testOnly.setupConnection(first, "doc-awareness-snapshot");
  const doc = _testOnly.docs.get("doc-awareness-snapshot");
  doc.awareness.setLocalState({ user: { name: "Ghost" } });
  const second = fakeConn();

  _testOnly.setupConnection(second, "doc-awareness-snapshot");

  assert.equal(second.sent.length >= 2, true);
  connCleanup(first, second);
});

test("collab send closes sockets on unavailable ready states and send failures", () => {
  const doc = { name: "send-doc", conns: new Map(), awareness: null };
  const closed = fakeConn();
  closed.readyState = 3;
  doc.conns.set(closed, new Set());
  _testOnly.send(doc, closed, new Uint8Array([1]));
  assert.equal(closed.closed, true);
  assert.equal(doc.conns.has(closed), false);

  const callbackFailure = fakeConn();
  doc.conns.set(callbackFailure, new Set());
  callbackFailure.send = (_message, cb) => cb(new Error("backpressure"));
  _testOnly.send(doc, callbackFailure, new Uint8Array([1]));
  assert.equal(callbackFailure.closed, true);

  const throwingSend = fakeConn();
  doc.conns.set(throwingSend, new Set());
  throwingSend.send = () => {
    throw new Error("socket write failed");
  };
  _testOnly.send(doc, throwingSend, new Uint8Array([1]));
  assert.equal(throwingSend.closed, true);

  const throwingClose = fakeConn();
  throwingClose.readyState = 3;
  throwingClose.close = () => {
    throw new Error("already closed");
  };
  doc.conns.set(throwingClose, new Set());
  assert.doesNotThrow(() =>
    _testOnly.send(doc, throwingClose, new Uint8Array([1])),
  );
});

test("collab ping timer closes stale sockets and handles ping failures", () => {
  mock.timers.enable({ apis: ["setInterval"], now: 0 });
  const stale = fakeConn();
  _testOnly.setupConnection(stale, "doc-stale-ping");

  mock.timers.tick(30_000);
  assert.equal(stale.closed, false);
  mock.timers.tick(30_000);
  assert.equal(stale.closed, true);
  stale.__events.close();

  const pingFailure = fakeConn();
  pingFailure.ping = () => {
    throw new Error("cannot ping");
  };
  _testOnly.setupConnection(pingFailure, "doc-ping-failure");
  mock.timers.tick(30_000);

  assert.equal(pingFailure.closed, true);
  pingFailure.__events.close();
});

test("collab pong handler keeps active sockets alive across ping intervals", () => {
  mock.timers.enable({ apis: ["setInterval"], now: 0 });
  const conn = fakeConn();
  _testOnly.setupConnection(conn, "doc-pong");

  mock.timers.tick(30_000);
  conn.__events.pong();
  mock.timers.tick(30_000);

  assert.equal(conn.closed, false);
  conn.__events.close();
});

test("collab access revalidation closes sockets after access is revoked", async () => {
  process.env.COLLAB_ACCESS_REVALIDATE_MS = "1";
  console.error = () => {};
  const conn = fakeConn();
  let checks = 0;
  _testOnly.setupConnection(conn, "doc-3", false, null, async () => {
    checks += 1;
    return { ok: false, status: 403 };
  });

  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(checks > 0, true);
  assert.equal(conn.closed, true);
  conn.__events.close();
});

test("collab access revalidation downgrades active sockets to read-only", async () => {
  process.env.COLLAB_ACCESS_REVALIDATE_MS = "1";
  const conn = fakeConn();
  _testOnly.setupConnection(conn, "doc-4", false, null, async () => ({
    ok: true,
    status: 101,
    readOnly: true,
  }));

  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(conn.__textiqReadOnly, true);
  conn.__events.close();
});

test("collab access revalidation closes sockets when checks throw", async () => {
  process.env.COLLAB_ACCESS_REVALIDATE_MS = "1";
  console.error = () => {};
  const conn = fakeConn();
  _testOnly.setupConnection(
    conn,
    "doc-revalidate-error",
    false,
    null,
    async () => {
      throw new Error("auth backend down");
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(conn.closed, true);
  conn.__events.close();
});

test("collab raw socket guard detects clients closed during async auth", () => {
  assert.equal(
    _testOnly.rawSocketClosed({ destroyed: true, writable: true }),
    true,
  );
  assert.equal(
    _testOnly.rawSocketClosed({ destroyed: false, writable: false }),
    true,
  );
  assert.equal(
    _testOnly.rawSocketClosed({ destroyed: false, writable: true }),
    false,
  );
  assert.equal(
    _testOnly.rawSocketClosed({
      destroyed: false,
      closed: true,
      writable: true,
    }),
    true,
  );
});

function connCleanup(...conns) {
  for (const conn of conns) {
    conn.__events.close?.();
  }
}

function fakeUpgradeSocket(overrides = {}) {
  return {
    destroyed: false,
    closed: false,
    writable: true,
    writes: [],
    write(message) {
      this.writes.push(message);
    },
    destroy() {
      this.destroyed = true;
    },
    ...overrides,
  };
}

test("collab websocket factory requires an authorizer", () => {
  assert.throws(() => createCollabWss(), /requires options\.authorize/);
});

test("collab upgrade handler ignores already-closed raw sockets", async () => {
  const { wss, handleUpgrade } = createCollabWss(null, {
    authorize: async () => ({ ok: true }),
  });
  const socket = fakeUpgradeSocket({ destroyed: true });

  await handleUpgrade(
    { headers: {}, socket: {}, url: "/room" },
    socket,
    Buffer.alloc(0),
  );

  assert.deepEqual(socket.writes, []);
  wss.close();
});

test("collab upgrade handler refuses rate-limited and unauthorized requests", async () => {
  process.env.COLLAB_UPGRADE_RATE_LIMIT = "1";
  process.env.COLLAB_UPGRADE_RATE_WINDOW_MS = "1000";
  console.error = () => {};
  const { wss, handleUpgrade } = createCollabWss((url) => url.slice(1), {
    authorize: async () => ({ ok: false, status: 401 }),
  });
  const first = fakeUpgradeSocket();
  const second = fakeUpgradeSocket();
  const req = {
    headers: { "x-forwarded-for": "198.51.100.1, 198.51.100.2" },
    socket: {},
    url: "/room",
  };

  await handleUpgrade(req, first, Buffer.alloc(0));
  await handleUpgrade(req, second, Buffer.alloc(0));

  assert.match(first.writes[0], /401 Unauthorized/);
  assert.match(second.writes[0], /429 Bad Request/);
  assert.equal(first.destroyed, true);
  assert.equal(second.destroyed, true);
  wss.close();
});

test("collab upgrade handler converts authorizer errors to HTTP 500", async () => {
  console.error = () => {};
  const { wss, handleUpgrade } = createCollabWss(null, {
    authorize: async () => {
      throw new Error("auth unavailable");
    },
  });
  const socket = fakeUpgradeSocket();

  await handleUpgrade(
    { headers: { "x-real-ip": "198.51.100.5" }, socket: {}, url: "/" },
    socket,
    Buffer.alloc(0),
  );

  assert.match(socket.writes[0], /500 Internal Server Error/);
  assert.equal(socket.destroyed, true);
  wss.close();
});

test("collab upgrade refusal tolerates sockets that throw while closing", async () => {
  console.error = () => {};
  const { wss, handleUpgrade } = createCollabWss(null, {
    authorize: async () => ({ ok: false, status: 403 }),
  });
  const socket = fakeUpgradeSocket({
    write() {
      throw new Error("write after end");
    },
    destroy() {
      throw new Error("destroy after end");
    },
  });

  await handleUpgrade(
    { headers: {}, socket: { remoteAddress: "198.51.100.9" }, url: "/room" },
    socket,
    Buffer.alloc(0),
  );

  assert.deepEqual(socket.writes, []);
  wss.close();
});

test("collab upgrade handler aborts when socket closes during async authorization", async () => {
  let socket;
  const { wss, handleUpgrade } = createCollabWss(null, {
    authorize: async () => {
      socket.destroyed = true;
      return { ok: true };
    },
  });
  socket = fakeUpgradeSocket();
  wss.handleUpgrade = () => {
    throw new Error("handleUpgrade should not run after close");
  };

  await handleUpgrade(
    {
      headers: {},
      socket: { remoteAddress: "198.51.100.10" },
      url: "/room",
    },
    socket,
    Buffer.alloc(0),
  );

  assert.equal(socket.destroyed, true);
  wss.close();
});

test("collab upgrade handler emits successful websocket connections with decisions", async () => {
  const { wss, handleUpgrade } = createCollabWss((url) => url.slice(1), {
    authorize: async () => ({ ok: true, readOnly: true }),
  });
  const conn = fakeConn();
  const socket = fakeUpgradeSocket();
  wss.handleUpgrade = (_req, _socket, _head, callback) => callback(conn);

  await handleUpgrade(
    { headers: {}, socket: { remoteAddress: "198.51.100.11" }, url: "/room" },
    socket,
    Buffer.alloc(0),
  );

  assert.equal(conn.__textiqReadOnly, true);
  assert.equal(_testOnly.docs.get("room").conns.has(conn), true);
  conn.__events.close();
  wss.close();
});
