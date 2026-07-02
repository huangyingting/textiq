/**
 * Utilities for building the `DocumentBlock[]` list that feeds
 * `buildDeckFromBlocks` in the public presentation routes.
 *
 * `contentJson` holds the full serialised editor state; `collectDocumentBlocks`
 * extracts blocks from it. This module keeps both present routes on the same
 * code path.
 *
 * Note: `contentJson` is typed as `unknown` to accept Prisma's `JsonValue`
 * directly — `collectDocumentBlocks` already handles the full `unknown` →
 * `DocumentBlock[]` narrowing internally.
 */

import type { DocumentBlock } from "@/lib/content";
import { collectDocumentBlocks } from "@/lib/content";

/**
 * Returns the `DocumentBlock[]` list to use for building a presentation deck.
 *
 * Empty or invalid content yields an empty array.
 */
export function buildPresentationBlocks(contentJson: unknown): DocumentBlock[] {
  if (contentJson) {
    const blocks = collectDocumentBlocks(contentJson);
    if (blocks.length > 0) return blocks;
  }
  return [];
}
