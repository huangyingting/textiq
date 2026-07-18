/** Deck revision-token generation for optimistic locking. */

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
