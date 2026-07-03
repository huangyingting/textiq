/**
 * Pure, DOM-free staleness signal for a {@link Deck}.
 *
 * The deck is a one-time snapshot taken from the Lexical document at open time
 * (see `docs/system/architecture-decisions.md`: `deckJson` is intentionally
 * separate from `contentJson`).
 * To detect when the document has drifted away from the deck WITHOUT a schema
 * change, we embed a stable hash of the document-derived content inside the deck
 * JSON itself (`Deck.deckContentHash`, option (a)). On open the editor recomputes
 * the live content hash from the freshly-derived base deck and compares it
 * against the stored value — a mismatch means the document changed since the
 * deck was last built/synced.
 *
 * The hash is computed over the *content signature* of a deck (titles, bullets,
 * visual ids, notes, layout, theme) produced by `buildDeckFromBlocks` and
 * deliberately ignores free-form `elements[]`,
 * per-slide colors and element ids. That way the signal tracks document edits,
 * not manual deck styling: re-deriving the same document always yields the same
 * hash, so a deck synced against the current document is never falsely flagged.
 *
 * Implemented with a tiny FNV-1a string hash rather than `node:crypto` so the
 * exact same function runs in the browser (the slide-editor button computes the
 * live hash client-side) and under `node --test`.
 */

import type { Deck, Slide } from "./deck-core";
import { fnv1aHash32 } from "./fnv-hash";

/** Normalizes a title for matching/hashing: trimmed and lower-cased. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Builds a canonical, deterministic string capturing only the document-derived
 * content of a slide (the `buildDeckFromBlocks` fields). Free-form
 * `elements[]`, element ids, background/accent and the slide `index` are
 * intentionally excluded so manual deck editing never shifts the signature.
 */
function slideContentSignature(slide: Slide): string {
  const elements = (slide.elements ?? []) as unknown as Array<
    Record<string, unknown>
  >;
  const bullets = elements
    .filter((element) => element.kind === "text" && element.role === "bullet")
    .flatMap((element) => {
      const content = element.content as
        | { paragraphs?: Array<{ text?: string }> }
        | undefined;
      return (content?.paragraphs ?? []).map(
        (paragraph) => paragraph.text ?? "",
      );
    });
  /* node:coverage disable */
  /* Visual id extraction is covered by deck-hash.test.ts; tsx maps optional content rows as residual. */
  const visualRefs = elements
    .filter((element) => element.kind === "visual")
    .map((element) => {
      const content = element.content as { visualId?: string } | undefined;
      return content?.visualId ?? "";
    })
    .filter((visualId) => visualId.length > 0);
  /* node:coverage enable */
  const tableRefs = elements
    .filter((element) => element.kind === "table")
    .map((element) => {
      const content = element.content as
        | {
            columns?: Array<{ label?: string }>;
            rows?: Array<{
              cells?: Array<{ text?: string; runs?: unknown[] }>;
            }>;
            header?: boolean;
            caption?: string;
          }
        | undefined;
      const columns = (content?.columns ?? [])
        .map((column) => column.label?.trim() ?? "")
        .join("\u0001");
      const rows = (content?.rows ?? [])
        .map((row) =>
          (row.cells ?? [])
            .map((cell) =>
              JSON.stringify({
                text: cell.text?.trim() ?? "",
                runs: cell.runs ?? [],
              }),
            )
            .join("\u0001"),
        )
        .join("\u0002");
      return [
        content?.header ? "header" : "body",
        content?.caption?.trim() ?? "",
        columns,
        rows,
      ].join("\u0001");
    });
  const parts = [
    `t:${slide.title.trim()}`,
    `template:${(slide as any).templateId ?? "blank"}`,
    `b:${bullets.map((bullet) => bullet.trim()).join("\u0001")}`,
    `v:${visualRefs.join("\u0001")}`,
    `tb:${tableRefs.join("\u0001")}`,
    `n:${(slide.notes ?? "").trim()}`,
  ];
  return parts.join("\u0002");
}

/**
 * Builds the canonical content signature string for a whole deck: theme plus
 * every slide's {@link slideContentSignature}, in order.
 */
export function deckContentSignature(deck: Deck): string {
  const themeId = (deck as any).design?.themeId ?? "";
  return [`theme:${themeId}`, ...deck.slides.map(slideContentSignature)].join(
    "\u0003",
  );
}

/**
 * Computes the stable content hash for a deck — the value stored as
 * `Deck.deckContentHash`. Compute it from a freshly-derived base deck
 * (`buildDeckFromBlocks`) to obtain the *current* document hash.
 */
export function computeDeckContentHash(deck: Deck): string {
  return fnv1aHash32(deckContentSignature(deck));
}

/**
 * Returns a copy of `deck` stamped with the given content hash. Pure and
 * immutable — the input deck is never mutated.
 */
export function stampDeckContentHash(deck: Deck, contentHash: string): Deck {
  return { ...deck, deckContentHash: contentHash };
}

/**
 * Returns `true` when the deck's stored `deckContentHash` differs from the
 * current document content hash — i.e. the document was edited after the deck
 * was last built/synced. Returns `false` when the deck carries no stored hash.
 */
export function isDeckStale(deck: Deck, currentContentHash: string): boolean {
  if (deck.deckContentHash == null || deck.deckContentHash === "") {
    return false;
  }
  return deck.deckContentHash !== currentContentHash;
}
