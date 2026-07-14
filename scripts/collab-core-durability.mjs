import * as Y from "yjs";

/**
 * Tracks the last durably-saved Yjs state vector per room. Set by the
 * persistence hook after a successful DB write via `setRoomSavedStateVector`.
 * @type {Map<string, Uint8Array>}
 */
export const savedStateVectors = new Map();

/**
 * Returns true when the current document state has diverged from the last
 * durably-saved state, i.e., there are pending updates that have not been
 * persisted yet.
 *
 * @param {Y.Doc} doc - The in-memory Yjs document for the room.
 * @param {Uint8Array | null} lastSavedStateVector - The Y.js state vector
 *   (from `Y.encodeStateVector(doc)`) recorded at the last confirmed durable
 *   save, or `null` if no save has been recorded for this room.
 * @returns {boolean} `true` when the room has unsaved changes.
 *
 * This is a pure function with no side effects — safe to test without any
 * network or DB dependencies.
 */
export function hasPendingUpdates(doc, lastSavedStateVector) {
  if (!lastSavedStateVector) {
    // No confirmed save for this room — treat all content as pending.
    // An empty document (no clock entries) is trivially "no pending updates".
    const currentVector = Y.encodeStateVector(doc);
    // An all-zero vector means the document is empty (no updates applied).
    return currentVector.some((byte) => byte !== 0);
  }
  // Compute the diff: if there is any update newer than lastSavedStateVector,
  // there are pending changes.
  const diff = Y.encodeStateAsUpdate(doc, lastSavedStateVector);
  // A Yjs update with no changes is just a 2-byte varint header (value 0).
  // Any payload longer than 2 bytes contains at least one pending operation.
  return diff.length > 2;
}

/**
 * Records that the room's current state has been durably saved. The caller
 * supplies the state vector captured **at the time of the save** (via
 * `Y.encodeStateVector(doc)`) so future `hasPendingUpdates` calls can detect
 * whether additional changes have arrived since the save completed.
 *
 * @param {string} roomName
 * @param {Uint8Array} stateVector
 */
export function setRoomSavedStateVector(roomName, stateVector) {
  savedStateVectors.set(roomName, stateVector);
}

/**
 * Returns the last durably-saved state vector recorded for a room, or `null`
 * if none has been recorded (room never saved, or already evicted).
 *
 * Pure read — safe to call from tests and health checks.
 *
 * @param {string} roomName
 * @returns {Uint8Array | null}
 */
export function getRoomSavedStateVector(roomName) {
  return savedStateVectors.get(roomName) ?? null;
}

/**
 * Records that a room has been **durably saved** by capturing the document's
 * current state vector. Call this ONLY after a confirmed durable write (e.g. a
 * successful Lexical autosave that committed `contentJson`), never after a
 * best-effort eviction flush.
 *
 * Saved-vector lifecycle (the vector tracks the last *confirmed durable* write):
 *  - A save with an active in-memory room advances the vector here.
 *  - Eviction does NOT advance the vector: the eviction snapshot flush is
 *    best-effort recovery, not the source of truth, so advancing on evict would
 *    falsely mark unsaved edits as durable. `evictRoom` instead clears the entry.
 *  - A save that arrives with no active room is a no-op (nothing to advance);
 *    the room reseeds from the DB on the next connection.
 *
 * In inline mode (collab socket and Next in the same process) this can be
 * invoked after a confirmed save; the standalone process runs separately and
 * relies on DB reseed on reconnect rather than cross-process vector advancement.
 *
 * @param {string} roomName
 * @param {Y.Doc} doc - The in-memory room document at save time.
 */
export function markRoomSaved(roomName, doc) {
  savedStateVectors.set(roomName, Y.encodeStateVector(doc));
}

export function clearRoomSavedStateVector(roomName) {
  savedStateVectors.delete(roomName);
}

export function roomHasPendingUpdates(roomName, doc) {
  return hasPendingUpdates(doc, savedStateVectors.get(roomName) ?? null);
}
