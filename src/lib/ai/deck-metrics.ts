/**
 * Pure, DOM-free evaluation metrics for AI-generated decks (issue #270).
 *
 * Two responsibilities, both side-effect-free and unit-tested under
 * `node --test`:
 *
 *   • {@link computeDeckMetrics} — distills a {@link Deck} (plus the optional
 *     source word count) into a plain object of quality/shape signals: slide
 *     count, total word count, average words per slide, the share of slides
 *     carrying a visual, and whether the deck is `safeParseDeck`-valid. These
 *     feed the route's per-request structured log so deck quality and size are
 *     observable over time.
 *
 *   • {@link deckEditDistance} — a lightweight numeric "how much did the user
 *     change the AI deck" signal computed from a `before`/`after` deck pair. It
 *     reuses the pure {@link diffDecks} matcher for slide-level add/remove/change
 *     counts and adds an element-count delta, so the apply→edit→save flow can
 *     log a single distance number (ids/counts only — never content).
 *
 * Everything here is computed from counts and is content-free by construction:
 * no slide text, titles, or notes are ever returned, so the output is always
 * safe to log alongside a `requestId`.
 */

import {
  normalizeTextParagraphs,
  type Deck,
  type Slide,
} from "@/lib/document/deck-model";
import { safeParseDeck } from "@/lib/document/deck-schema";
import { diffDecks } from "@/lib/document/deck-diff";

/** Quality/shape signals distilled from a deck. Plain, content-free, loggable. */
export interface DeckMetrics {
  /** Number of slides in the deck. */
  slideCount: number;
  /** Total words across all slide text + bullets (titles, body, bullets). */
  totalWordCount: number;
  /** Average words per slide (`totalWordCount / slideCount`; 0 when empty). */
  wordsPerSlide: number;
  /** Count of slides that carry at least one visual/image element. */
  slidesWithVisual: number;
  /** Share (0–1) of slides carrying a visual; 0 for an empty deck. */
  percentSlidesWithVisual: number;
  /** True when the deck passes {@link safeParseDeck}. */
  schemaValid: boolean;
  /** Source document word count, echoed back when provided. */
  sourceWordCount?: number;
  /** Slides produced per source word (`slideCount / sourceWordCount`). */
  slidesPerSourceWord?: number;
}

/** Options for {@link computeDeckMetrics}. */
export interface DeckMetricsOptions {
  /** Word count of the source document/outline the deck was generated from. */
  sourceWordCount?: number;
}

/** Counts whitespace-delimited words in a string (0 for empty/blank/non-string). */
export function countWords(text: string): number {
  if (typeof text !== "string") return 0;
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Words contributed by a single slide's authoritative `elements[]` content.
 *
 * Defensive against malformed slides so {@link computeDeckMetrics} can still
 * report `schemaValid: false` instead of throwing on invalid input.
 */
function slideWordCount(slide: Slide): number {
  const elements = Array.isArray(slide.elements) ? slide.elements : [];
  if (elements.length > 0) {
    let words = 0;
    for (const element of elements) {
      if (element.kind === "text") {
        const paragraphs = normalizeTextParagraphs(element);
        for (const paragraph of paragraphs) {
          words += countWords(paragraph.text);
        }
        /* node:coverage ignore next 2 -- Textless-element behavior is asserted; tsx maps this loop close as uncovered. */
      }
    }
    return words;
  }

  /* node:coverage ignore next 2 -- Empty-element behavior is asserted; tsx maps this fallback as uncovered. */
  return 0;
}

/** True when a slide carries at least one visual or image element. */
function slideHasVisual(slide: Slide): boolean {
  const elements = Array.isArray(slide.elements) ? slide.elements : [];
  if (elements.length > 0) {
    return elements.some(
      (element) => element.kind === "visual" || element.kind === "image",
    );
  }
  return false;
}

/** Total element count across the deck. */
function totalElementCount(deck: Deck): number {
  let total = 0;
  for (const slide of deck.slides) {
    total += Array.isArray(slide.elements) ? slide.elements.length : 0;
  }
  return total;
}

/**
 * Compute content-free quality/shape metrics for a deck. Pure and DOM-free; the
 * returned object contains only numbers/flags and is safe to log.
 */
export function computeDeckMetrics(
  deck: Deck,
  options: DeckMetricsOptions = {},
): DeckMetrics {
  const slideCount = deck.slides.length;

  let totalWordCount = 0;
  let slidesWithVisual = 0;
  for (const slide of deck.slides) {
    totalWordCount += slideWordCount(slide);
    if (slideHasVisual(slide)) {
      slidesWithVisual += 1;
    }
  }

  const wordsPerSlide = slideCount > 0 ? totalWordCount / slideCount : 0;
  const percentSlidesWithVisual =
    slideCount > 0 ? slidesWithVisual / slideCount : 0;
  const schemaValid = safeParseDeck(deck).success;

  const metrics: DeckMetrics = {
    slideCount,
    totalWordCount,
    wordsPerSlide,
    slidesWithVisual,
    percentSlidesWithVisual,
    schemaValid,
  };

  const { sourceWordCount } = options;
  if (typeof sourceWordCount === "number" && sourceWordCount > 0) {
    metrics.sourceWordCount = sourceWordCount;
    metrics.slidesPerSourceWord = slideCount / sourceWordCount;
  }

  return metrics;
}

/**
 * A content-free measure of how much `after` differs from `before`. Slide-level
 * add/remove/change counts come from {@link diffDecks}; `elementDelta` is the
 * absolute change in total element count. `distance` is their sum — a single
 * number suitable for logging a post-apply edit signal.
 */
export interface DeckEditDistance {
  /** Slides present in `after` with no `before` match. */
  slidesAdded: number;
  /** Slides present in `before` with no `after` match. */
  slidesRemoved: number;
  /** Matched slides whose content changed between `before` and `after`. */
  slidesChanged: number;
  /** Absolute difference in total element count (`|after − before|`). */
  elementDelta: number;
  /** Aggregate distance: added + removed + changed + elementDelta. */
  distance: number;
}

/**
 * Numeric edit distance between two decks (e.g. the applied AI deck vs. the
 * deck the user later saves). Pure and immutable — neither input is mutated.
 * Identical decks yield `distance === 0`.
 */
export function deckEditDistance(before: Deck, after: Deck): DeckEditDistance {
  const diff = diffDecks(before, after);
  const elementDelta = Math.abs(
    totalElementCount(after) - totalElementCount(before),
  );
  return {
    slidesAdded: diff.added,
    slidesRemoved: diff.removed,
    slidesChanged: diff.changed,
    elementDelta,
    distance: diff.added + diff.removed + diff.changed + elementDelta,
  };
}
