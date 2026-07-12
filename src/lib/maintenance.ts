/**
 * Maintenance / purge utilities.
 *
 * Exports pure, testable predicate/decision functions used by the server-side
 * maintenance sweep, plus a module-level in-memory throttle guard so the
 * global sweep (deleteMany across all users) runs at most once per
 * PURGE_MIN_INTERVAL_MS regardless of how many concurrent dashboard requests
 * arrive.
 *
 * Architecture:
 *   - Pure helpers (shouldRunPurge) are fully testable under `node --test`
 *     with no framework dependencies.
 *   - The module-level `lastGlobalPurgeAt` guard is an in-memory timestamp;
 *     it resets on process restart (acceptable — the purge is idempotent and
 *     the miss cost is just one extra sweep at startup).
 *
 * Invite-link purge eligibility (revoked, expired, or usage-exhausted rows
 * older than INVITE_LINK_RETENTION_MS) is decided entirely by the raw SQL in
 * `src/lib/document/trash.ts`'s `runDocumentMaintenance` — there is no
 * separate TypeScript predicate for it. Because `InviteLink` does not track
 * `revokedAt`/`exhaustedAt`, that SQL anchors the age check for every dead
 * branch (revoked, expired, exhausted) on `createdAt` alone; expiry only
 * adds its own independent `expiresAt < cutoff` condition for the expired
 * branch. See `src/lib/document/trash.test.ts` for the branch/parameter
 * contracts pinned against that query.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum gap between successive global maintenance sweeps (5 minutes). */
export const PURGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long after an invite link becomes inactive (revoked, expired, or
 * exhausted) before its row (and cascaded InviteLinkUse audit rows) are
 * eligible for permanent purge.  Kept at 7 days so workspace owners retain
 * a short-term audit window.
 */
export const INVITE_LINK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helpers (no DB, no framework — safe for node:test)
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the global purge sweep should run.
 *
 * @param lastRunAt - `Date.now()` value at the last completed sweep, or
 *   `null` if the sweep has never run in this process.
 * @param now       - Current `Date.now()` value (injected for testability).
 * @param intervalMs - Minimum gap between sweeps.
 */
export function shouldRunPurge(
  lastRunAt: number | null,
  now: number,
  intervalMs: number,
): boolean {
  return lastRunAt === null || now - lastRunAt >= intervalMs;
}

// ---------------------------------------------------------------------------
// Module-level throttle guard
// ---------------------------------------------------------------------------

/**
 * Timestamp (from Date.now()) of the last completed global sweep, or null
 * if none has run in this process.  Intentionally module-level so it
 * survives across concurrent requests within the same process.
 */
let lastGlobalPurgeAt: number | null = null;

/**
 * Returns `true` when the global maintenance sweep should run right now,
 * updating the guard if so.  Call this *before* issuing any DB writes;
 * the guard is updated optimistically so concurrent calls in the same tick
 * don't all race through.
 */
export function acquirePurgeLock(now: number = Date.now()): boolean {
  if (!shouldRunPurge(lastGlobalPurgeAt, now, PURGE_MIN_INTERVAL_MS)) {
    return false;
  }
  lastGlobalPurgeAt = now;
  return true;
}

/**
 * Resets the in-process throttle guard.  Used only in tests to restore a
 * clean state between cases.
 */
export function resetPurgeLockForTesting(): void {
  lastGlobalPurgeAt = null;
}
