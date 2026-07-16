/** Max number of recent flush failures retained in memory. */
const FLUSH_FAILURE_RING_CAP = 20;

/**
 * In-memory ring buffer of recent eviction-flush failures, capped at
 * {@link FLUSH_FAILURE_RING_CAP}. Holds only safe ids — never document content.
 * @type {Array<{ room: string, docId: string, reason: string, at: string }>}
 */
export const flushFailureRing = [];

/** Monotonic counters for eviction-flush activity. */
export const flushCounters = { flushAttempts: 0, flushFailures: 0 };

/**
 * Record that an eviction flush was attempted. Increments the attempt counter.
 * Safe to call from the flush helper before issuing the network request.
 */
export function recordFlushAttempt() {
  flushCounters.flushAttempts += 1;
}

/**
 * Record an eviction-flush failure into the observability ring and increment
 * the failure counter. Only safe identifiers and a short reason are stored.
 *
 * @param {{ room: string, docId?: string, reason: string }} failure
 */
export function recordFlushFailure(failure) {
  flushCounters.flushFailures += 1;
  flushFailureRing.push({
    room: failure.room,
    docId: failure.docId ?? failure.room,
    reason: failure.reason,
    at: new Date().toISOString(),
  });
  while (flushFailureRing.length > FLUSH_FAILURE_RING_CAP) {
    flushFailureRing.shift();
  }
}

/**
 * Returns a copy of the recent flush failures (safe ids only), oldest first.
 * @returns {Array<{ room: string, docId: string, reason: string, at: string }>}
 */
export function recentFlushFailures() {
  return flushFailureRing.map((entry) => ({ ...entry }));
}

/**
 * Returns the current flush counters for health surfaces.
 * @returns {{ flushAttempts: number, flushFailures: number }}
 */
export function flushStats() {
  return { ...flushCounters };
}
