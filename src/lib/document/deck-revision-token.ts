/**
 * Pure helpers for deck revision-token optimistic locking (#376).
 *
 * Extracted from `saveDeckJson` so they can be unit-tested without a database
 * and reused across server actions.
 *
 * All functions are DOM-free, server-free, and side-effect-free.
 */

import { customAlphabet } from "nanoid";

/**
 * Generates a fresh opaque revision token.  24-character URL-safe alphabet
 * (no ambiguous chars: 0/O, 1/l/I) — same character-set as the share-ID
 * generator used in the same file.
 */
export const generateRevisionToken = customAlphabet(
  "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ",
  24,
);

/**
 * Returns `true` when either side is missing an optimistic-lock token or the
 * caller's token does not match the server's current token.
 */
export function isRevisionConflict(
  clientToken: string | null | undefined,
  serverToken: string | null,
): boolean {
  if (clientToken == null || serverToken == null) return true;
  return serverToken !== clientToken;
}
