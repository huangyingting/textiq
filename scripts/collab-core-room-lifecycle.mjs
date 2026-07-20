import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as map from "lib0/map";
import { WebSocketServer } from "ws";

import { readPositiveInt } from "./collab-utils.mjs";
import { logScriptError } from "./structured-log.mjs";
import {
  allowUpgradeAttempt,
  clientIpFromUpgrade,
  collabLimits,
} from "./collab-core-limits.mjs";
import {
  clearRoomSavedStateVector,
  roomHasPendingUpdates,
} from "./collab-core-durability.mjs";

const PING_TIMEOUT = 30_000;
const DEFAULT_ACCESS_REVALIDATE_MS = 60_000;

/**
 * How long (ms) an empty room stays in memory after the last connection closes
 * before being evicted. A reconnecting client within this window reuses the
 * live Y.Doc; after eviction the DB is re-read on the next connection.
 */
export const ROOM_IDLE_TTL_MS = 60_000;

/** @type {Map<string, ReturnType<typeof setTimeout>>} room name → pending eviction timer */
export const evictTimers = new Map();

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;

/** @type {Map<string, WSSharedDoc>} */
export const docs = new Map();

/**
 * A shared Y.Doc for one room, tracking the connections subscribed to it and the
 * awareness (presence) state of their clients.
 */
class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: true });
    this.name = name;
    /** @type {Map<object, Set<number>>} conn -> set of controlled awareness client ids */
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    const awarenessChangeHandler = ({ added, updated, removed }, conn) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const controlledIds = this.conns.get(conn);
        if (controlledIds !== undefined) {
          added.forEach((clientId) => controlledIds.add(clientId));
          removed.forEach((clientId) => controlledIds.delete(clientId));
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      );
      const message = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => send(this, c, message));
    };
    this.awareness.on("update", awarenessChangeHandler);
    this.on("update", updateHandler);
  }
}

/** Broadcast a document update to every connection in the room. */
const updateHandler = (update, _origin, doc) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  doc.conns.forEach((_, conn) => send(doc, conn, message));
};

/** Returns true when a room with the given active-connection count should be evicted. */
export const shouldEvict = (connCount) => connCount === 0;

/** Tear down a room's awareness + doc and remove it from the in-memory map. */
export const evictRoom = (doc, roomName, onBeforeEvict) => {
  if (onBeforeEvict && roomHasPendingUpdates(roomName, doc)) {
    // Fire-and-forget: errors must not block eviction. The callback receives
    // the room name and the full document update so the caller can persist it
    // via the normal save path (e.g. POST to an internal flush endpoint).
    try {
      const update = Y.encodeStateAsUpdate(doc);
      Promise.resolve(onBeforeEvict(roomName, update)).catch((err) => {
        logScriptError("collab.core.evict", err, { room: roomName });
      });
    } catch (err) {
      logScriptError("collab.core.evict", err, {
        room: roomName,
        phase: "sync",
      });
    }
  }
  clearRoomSavedStateVector(roomName);
  doc.awareness.destroy();
  doc.off("update", updateHandler);
  doc.destroy();
  docs.delete(roomName);
};

/**
 * Schedule eviction of an empty room after `ttlMs` milliseconds.
 * Re-calling before the timer fires resets it (safe to call multiple times).
 * `onBeforeEvict` is called (if provided) with `(roomName, update)` before the
 * room is destroyed so callers can flush unsaved state to durable storage.
 */
export const scheduleEviction = (
  roomName,
  ttlMs = ROOM_IDLE_TTL_MS,
  onBeforeEvict = null,
) => {
  cancelEviction(roomName);
  const timer = setTimeout(() => {
    evictTimers.delete(roomName);
    const doc = docs.get(roomName);
    if (doc && doc.conns.size === 0) {
      evictRoom(doc, roomName, onBeforeEvict);
    }
  }, ttlMs);
  timer.unref?.();
  evictTimers.set(roomName, timer);
};

/** Cancel a pending eviction timer (called when a new connection arrives). */
export const cancelEviction = (roomName) => {
  const timer = evictTimers.get(roomName);
  if (timer !== undefined) {
    clearTimeout(timer);
    evictTimers.delete(roomName);
  }
};

const getYDoc = (docName) =>
  map.setIfUndefined(docs, docName, () => {
    const doc = new WSSharedDoc(docName);
    docs.set(docName, doc);
    return doc;
  });

const findAwarenessOwner = (doc, clientId) => {
  for (const [ownerConn, controlledIds] of doc.conns.entries()) {
    if (controlledIds.has(clientId)) {
      return ownerConn;
    }
  }
  return null;
};

const filterAwarenessUpdateForConnection = (doc, conn, update) => {
  const controlledIds = doc.conns.get(conn);
  if (controlledIds === undefined) {
    return null;
  }

  const decoder = decoding.createDecoder(update);
  const authorizedEntries = [];
  const claimedClientIds = [];
  const len = decoding.readVarUint(decoder);
  for (let i = 0; i < len; i += 1) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder));
    const owner = findAwarenessOwner(doc, clientId);
    const controlledByConn = owner === conn || controlledIds.has(clientId);
    const existingState = doc.awareness.getStates().has(clientId);

    if (owner !== null && owner !== conn) {
      continue;
    }
    if (!controlledByConn && (existingState || state === null)) {
      continue;
    }

    if (state !== null) {
      if (!controlledIds.has(clientId)) {
        claimedClientIds.push(clientId);
      }
      controlledIds.add(clientId);
    }
    authorizedEntries.push({ clientId, clock, state });
  }

  if (authorizedEntries.length === 0) {
    return null;
  }

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, authorizedEntries.length);
  for (const { clientId, clock, state } of authorizedEntries) {
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, JSON.stringify(state));
  }
  return { update: encoding.toUint8Array(encoder), claimedClientIds };
};

export const messageListener = (
  conn,
  doc,
  message,
  readOnly,
  onBeforeEvict = null,
) => {
  try {
    const limits = collabLimits();
    if (message.byteLength > limits.maxMessageBytes) {
      logScriptError("collab.core.flood", new Error("message too large"), {
        room: doc.name,
        reason: "message_too_large",
        bytes: message.byteLength,
        budget: limits.maxMessageBytes,
      });
      closeConn(doc, conn, onBeforeEvict);
      return;
    }
    const rate = conn.__textiqRate ?? {
      count: 0,
      resetAt: Date.now() + limits.messageWindowMs,
    };
    const now = Date.now();
    if (now >= rate.resetAt) {
      rate.count = 0;
      rate.resetAt = now + limits.messageWindowMs;
    }
    rate.count += 1;
    conn.__textiqRate = rate;
    if (rate.count > limits.maxMessagesPerWindow) {
      logScriptError("collab.core.flood", new Error("message rate exceeded"), {
        room: doc.name,
        reason: "message_rate",
        budget: limits.maxMessagesPerWindow,
      });
      closeConn(doc, conn, onBeforeEvict);
      return;
    }

    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync: {
        encoding.writeVarUint(encoder, messageSync);
        // For read-only (viewer) connections we still answer sync-step-1 (the
        // client asking for the current state) so viewers receive the document
        // and all subsequent updates, but we drop sync-step-2 / update messages
        // so they can never mutate the shared doc (issue #88 AC #3).
        const syncMessageType = decoding.readVarUint(decoder);
        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
          syncProtocol.readSyncStep1(decoder, encoder, doc);
        } else if (!readOnly) {
          if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
            syncProtocol.readSyncStep2(decoder, doc, conn);
          } else if (syncMessageType === syncProtocol.messageYjsUpdate) {
            syncProtocol.readUpdate(decoder, doc, conn);
          }
        }
        // If the reply has more than just the message-type header, send it.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder), onBeforeEvict);
        }
        break;
      }
      case messageAwareness: {
        const update = decoding.readVarUint8Array(decoder);
        if (update.byteLength > limits.maxAwarenessBytes) {
          logScriptError(
            "collab.core.flood",
            new Error("awareness too large"),
            {
              room: doc.name,
              reason: "awareness_too_large",
              bytes: update.byteLength,
              budget: limits.maxAwarenessBytes,
            },
          );
          closeConn(doc, conn, onBeforeEvict);
          return;
        }
        const authorized = filterAwarenessUpdateForConnection(
          doc,
          conn,
          update,
        );
        if (authorized !== null) {
          awarenessProtocol.applyAwarenessUpdate(
            doc.awareness,
            authorized.update,
            conn,
          );
          const controlledIds = doc.conns.get(conn);
          for (const clientId of authorized.claimedClientIds) {
            if (!doc.awareness.getStates().has(clientId)) {
              controlledIds?.delete(clientId);
            }
          }
        }
        break;
      }
      case messageQueryAwareness:
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(
            doc.awareness,
            Array.from(doc.awareness.getStates().keys()),
          ),
        );
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder), onBeforeEvict);
        }
        break;
      default:
        break;
    }
  } catch (err) {
    logScriptError("collab.core.message", err);
  }
};

const closeConn = (doc, conn, onBeforeEvict = null) => {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      Array.from(controlledIds ?? []),
      null,
    );
    if (doc.conns.size === 0) {
      // Room is empty — schedule eviction after the idle grace period.
      // The DB is the durable source of truth, so eviction is safe.
      scheduleEviction(doc.name, ROOM_IDLE_TTL_MS, onBeforeEvict);
    }
  }
  try {
    conn.close();
  } catch {
    // ignore
  }
};

export const rawSocketClosed = (socket) =>
  Boolean(socket.destroyed || socket.closed || socket.writable === false);

export const send = (doc, conn, message, onBeforeEvict = null) => {
  if (
    conn.readyState !== wsReadyStateConnecting &&
    conn.readyState !== wsReadyStateOpen
  ) {
    closeConn(doc, conn, onBeforeEvict);
    return;
  }
  try {
    conn.send(message, (err) => {
      if (err != null) {
        closeConn(doc, conn, onBeforeEvict);
      }
    });
  } catch {
    closeConn(doc, conn, onBeforeEvict);
  }
};

/**
 * Wires up a freshly upgraded websocket connection to its room. `roomName` is
 * derived by the caller from the request URL, which lets the same logic serve
 * both `ws://host:port/<room>` (standalone) and `wss://host/<prefix>/<room>`
 * (mounted on the app server) shapes.
 *
 * `onBeforeEvict` is an optional async callback invoked when the room is about
 * to be evicted (all connections closed, idle TTL expired) and there are
 * pending updates. Signature: `(roomName: string, update: Uint8Array) => Promise<void>`.
 * Errors from the callback are logged but never re-thrown so eviction always
 * completes.
 */
export const setupConnection = (
  conn,
  roomName,
  readOnly = false,
  onBeforeEvict = null,
  reauthorize = null,
) => {
  conn.binaryType = "arraybuffer";
  const room = roomName || "default";
  const limits = collabLimits();
  const existingDoc = docs.get(room);
  if (existingDoc && existingDoc.conns.size >= limits.maxConnectionsPerRoom) {
    logScriptError("collab.core.flood", new Error("room connection cap"), {
      room,
      reason: "room_connection_cap",
      budget: limits.maxConnectionsPerRoom,
    });
    conn.close();
    return;
  }
  if (connCount() >= limits.maxConnectionsTotal) {
    logScriptError("collab.core.flood", new Error("total connection cap"), {
      reason: "total_connection_cap",
      budget: limits.maxConnectionsTotal,
    });
    conn.close();
    return;
  }
  const doc = getYDoc(room);
  conn.__textiqReadOnly = readOnly;
  // Cancel any pending eviction — this connection revives the room.
  cancelEviction(room);
  doc.conns.set(conn, new Set());

  conn.on("message", (message) =>
    messageListener(
      conn,
      doc,
      new Uint8Array(message),
      Boolean(conn.__textiqReadOnly),
      onBeforeEvict,
    ),
  );

  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) {
        closeConn(doc, conn, onBeforeEvict);
      }
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch {
        closeConn(doc, conn, onBeforeEvict);
        clearInterval(pingInterval);
      }
    }
  }, PING_TIMEOUT);
  pingInterval.unref?.();

  const accessInterval =
    typeof reauthorize === "function"
      ? setInterval(
          async () => {
            try {
              const decision = await reauthorize();
              if (!decision?.ok) {
                closeConn(doc, conn, onBeforeEvict);
                clearInterval(accessInterval);
                return;
              }
              conn.__textiqReadOnly = Boolean(decision.readOnly);
            } catch (err) {
              logScriptError("collab.core.reauthorize", err, { room });
              closeConn(doc, conn, onBeforeEvict);
              clearInterval(accessInterval);
            }
          },
          readPositiveInt(
            process.env.COLLAB_ACCESS_REVALIDATE_MS,
            DEFAULT_ACCESS_REVALIDATE_MS,
          ),
        )
      : null;
  accessInterval?.unref?.();

  conn.on("close", () => {
    closeConn(doc, conn, onBeforeEvict);
    clearInterval(pingInterval);
    if (accessInterval) {
      clearInterval(accessInterval);
    }
  });
  conn.on("pong", () => {
    pongReceived = true;
  });

  // Sync step 1: ask the client for anything we don't have / offer what we have.
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder), onBeforeEvict);
  }
  // Send current presence so the newcomer immediately sees who's here.
  const states = doc.awareness.getStates();
  if (states.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        doc.awareness,
        Array.from(states.keys()),
      ),
    );
    send(doc, conn, encoding.toUint8Array(encoder), onBeforeEvict);
  }
};

/** Number of in-memory rooms, exposed for health checks. */
export const roomCount = () => docs.size;

/** Total number of active WebSocket connections across all rooms. */
export const connCount = () => {
  let total = 0;
  for (const doc of docs.values()) {
    total += doc.conns.size;
  }
  return total;
};

/**
 * Writes a minimal HTTP error response to a raw upgrade socket and destroys it,
 * so an unauthorized/forbidden upgrade is refused with a real status code
 * (issue #88 AC #1 / #4) instead of completing the WebSocket handshake.
 */
const refuseUpgrade = (socket, status) => {
  const reason =
    { 401: "Unauthorized", 403: "Forbidden", 500: "Internal Server Error" }[
      status
    ] || "Bad Request";
  try {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\n` +
        "Connection: close\r\n" +
        "Content-Length: 0\r\n" +
        "\r\n",
    );
  } catch {
    // ignore — socket may already be gone
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
};

/**
 * Creates a `noServer` WebSocketServer and a `handleUpgrade` you can attach to
 * any Node HTTP server's `upgrade` event. `roomFromUrl` maps a request URL to a
 * room name so the same core works at the host root (standalone) or under a
 * path prefix (mounted on the app server).
 *
 * `options.authorize(req, room)` authenticates and authorizes the upgrade before
 * the handshake completes (issue #88). It must resolve to
 * `{ ok, status, readOnly? }`: when `ok` is false the upgrade is refused with the
 * given status (401 unauthenticated / 403 no access); when `ok` is true the
 * connection is wired, read-only for viewers (`readOnly: true`).
 *
 * `options.onBeforeEvict(roomName, update)` is an optional async callback
 * invoked when a room is about to be evicted and has pending unsaved changes.
 * The callback receives the room name and the full Yjs update bytes so it can
 * flush them to durable storage. Errors are logged and never re-thrown.
 */
export function createCollabWss(roomFromUrl, options = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const authorize = options.authorize;
  if (typeof authorize !== "function") {
    throw new Error("[collab] createCollabWss requires options.authorize");
  }
  const onBeforeEvict = options.onBeforeEvict ?? null;
  const toRoom =
    roomFromUrl ?? ((url) => (url || "/").slice(1).split("?")[0] || "default");

  wss.on("connection", (conn, req, decision) => {
    const room = toRoom(req.url || "/");
    setupConnection(
      conn,
      room,
      Boolean(decision?.readOnly),
      onBeforeEvict,
      () => authorize(req, room),
    );
  });

  const handleUpgrade = async (req, socket, head) => {
    if (rawSocketClosed(socket)) {
      return;
    }
    if (!allowUpgradeAttempt(clientIpFromUpgrade(req))) {
      logScriptError("collab.core.flood", new Error("upgrade rate exceeded"), {
        reason: "upgrade_rate",
      });
      refuseUpgrade(socket, 429);
      return;
    }
    let decision = { ok: true, readOnly: false };
    try {
      decision = await authorize(req, toRoom(req.url || "/"));
    } catch (err) {
      logScriptError("collab.core.authorize", err);
      decision = { ok: false, status: 500 };
    }
    if (!decision || !decision.ok) {
      refuseUpgrade(socket, decision?.status || 403);
      return;
    }
    if (rawSocketClosed(socket)) {
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, decision);
    });
  };

  return { wss, handleUpgrade };
}
