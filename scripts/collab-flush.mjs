/**
 * Eviction-flush helper for the collaboration server (#497).
 *
 * When a dirty room is evicted (all clients gone, idle TTL elapsed, unsaved
 * changes detected) `collab-core.mjs` calls an `onBeforeEvict(roomName, update)`
 * callback. This module builds that callback: it POSTs the room's Yjs update
 * (base64) to the app's internal flush endpoint (`/api/collab/flush`) with a
 * shared-secret header so the edit is persisted as a best-effort recovery
 * snapshot instead of being silently lost on eviction.
 *
 * Design notes:
 *  - The flush is **best-effort recovery**, not the source of truth. The
 *    canonical store is `Document.contentJson`, written by the editor's client
 *    autosave. A failed flush never advances the saved-state vector.
 *  - If `COLLAB_INTERNAL_SECRET` is unset the returned callback is a no-op that
 *    logs a single clear warning at construction time, so dev without the secret
 *    still runs (it just skips the recovery snapshot).
 *  - Errors never throw out of the callback — eviction must always complete.
 *  - Structured logs carry only safe ids/flags, never document content.
 *
 * Runs under plain Node (no TS path aliases), like the rest of `scripts/*.mjs`.
 */
import {
  recordFlushAttempt,
  recordFlushFailure,
} from "./collab-core-observability.mjs";
import {
  logScriptInfo,
  logScriptWarning,
  logScriptError,
} from "./structured-log.mjs";
import { readPositiveInt } from "./collab-utils.mjs";

const DEFAULT_FLUSH_TIMEOUT_MS = 5000;

/** Convert a Uint8Array Yjs update to a base64 string for JSON transport. */
const toBase64 = (update) => Buffer.from(update).toString("base64");

/**
 * Builds the `onBeforeEvict` callback wired into `createCollabWss`.
 *
 * @param {Object} options
 * @param {string} [options.flushUrl] Absolute URL of the internal flush
 *   endpoint, e.g. `http://127.0.0.1:4000/api/collab/flush`.
 * @param {string} [options.internalSecret] Shared secret sent as the
 *   `x-collab-internal-secret` header. When falsy the flusher is a no-op.
 * @param {typeof fetch} [options.fetchImpl] Override for testing.
 * @param {number} [options.timeoutMs] Flush request timeout.
 * @returns {(roomName: string, update: Uint8Array) => Promise<void>}
 */
export function createEvictionFlusher(options = {}) {
  const flushUrl = options.flushUrl;
  const internalSecret = options.internalSecret;
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = readPositiveInt(
    options.timeoutMs ?? process.env.COLLAB_FLUSH_TIMEOUT_MS,
    DEFAULT_FLUSH_TIMEOUT_MS,
  );

  if (!internalSecret) {
    // No-op flusher: dev without the secret still runs. Warn once at startup so
    // the operator knows the eviction recovery snapshot is disabled.
    logScriptWarning("collab.flush.configure", "eviction flush disabled", {
      reason: "missing-internal-secret",
    });
    return async () => {};
  }

  if (!flushUrl) {
    logScriptWarning("collab.flush.configure", "eviction flush disabled", {
      reason: "missing-flush-url",
    });
    return async () => {};
  }

  return async function onBeforeEvict(roomName, update) {
    // The room name IS the document id in both entry points.
    const docId = roomName;
    recordFlushAttempt();
    logScriptInfo("collab.flush.attempt", "eviction flush attempt", {
      room: roomName,
      docId,
      dirty: true,
      flushAttempt: true,
    });

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);
    timeout.unref?.();

    try {
      const res = await fetchImpl(flushUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-collab-internal-secret": internalSecret,
        },
        body: JSON.stringify({
          documentId: docId,
          room: roomName,
          update: toBase64(update),
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const failureReason = `http_${res.status}`;
        recordFlushFailure({ room: roomName, docId, reason: failureReason });
        logScriptError("collab.flush.result", new Error(failureReason), {
          room: roomName,
          docId,
          dirty: true,
          flushAttempt: true,
          ok: false,
          status: res.status,
          failureReason,
        });
        return;
      }

      logScriptInfo("collab.flush.result", "eviction flush succeeded", {
        room: roomName,
        docId,
        dirty: true,
        flushAttempt: true,
        ok: true,
        status: res.status,
      });
    } catch (err) {
      const failureReason =
        err instanceof Error ? err.name || "network_error" : "network_error";
      recordFlushFailure({ room: roomName, docId, reason: failureReason });
      logScriptError("collab.flush.result", err, {
        room: roomName,
        docId,
        dirty: true,
        flushAttempt: true,
        ok: false,
        failureReason,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}
