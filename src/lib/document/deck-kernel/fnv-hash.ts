/**
 * Shared deterministic FNV-1a 32-bit string hash utility (issue #487).
 *
 * Both `deck.ts` and `deck-hash.ts` previously maintained copies of the same
 * function (`fnv1aHex32` in deck.ts; `fnv1aHex` in deck-hash.ts) to avoid a
 * circular import (deck-hash.ts imports types from deck.ts). Extracting the
 * implementation into this standalone module breaks that cycle: neither
 * deck.ts nor deck-hash.ts needs to import from each other just for the hash.
 *
 * This module has NO imports from the presentation layer, so it can be safely
 * imported by any module without creating cycles.
 *
 * Output is byte-for-byte identical to both former copies.
 */

/**
 * FNV-1a 32-bit string hash, returned as an 8-char zero-padded hex string.
 * Deterministic and dependency-free — runs identically in the browser and Node.
 */
export function fnv1aHash32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash * FNV_prime (16777619) with 32-bit overflow via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned 32-bit then hex.
  return (hash >>> 0).toString(16).padStart(8, "0");
}
