/**
 * Pure helper that removes orphaned visual references from a {@link Deck}.
 *
 * The deck stores only `visualId` string references, never visual payloads.
 * When a visual is deleted from a document's `contentJson` (or its id changes),
 * any slide still referencing the missing id renders a silent blank — the
 * audience on `/present/[shareId]` sees an empty slide. This helper drops those
 * dangling references so every load path renders only resolvable visuals.
 *
 * It is pure and side-effect-free: it returns a brand-new `Deck` (and new
 * `Slide` objects only where a change is needed) and never mutates the input.
 * No DOM, no React — fully testable under `node --test`.
 */

import type { Deck, Slide } from "./deck-kernel/deck-core";
import type { SlideElement } from "./deck-kernel/deck-elements";

function visualElementId(element: SlideElement): string | undefined {
  return (element as any).content?.visualId;
}

/**
 * Returns a copy of `deck` with every visual reference that is not present in
 * `knownVisualIds` removed:
 *
 * Drops `elements` of kind `"visual"` whose `visualId` is unknown. All other
 * element kinds are preserved untouched.
 *
 * Slides without any orphaned reference are returned by identity so callers can
 * cheaply detect "no change". The input deck and its slides/elements arrays are
 * never mutated.
 *
 * @param deck            The deck to sanitize.
 * @param knownVisualIds  The set of visual ids that resolve against the current
 *                        document content (built from `contentJson`).
 * @returns A new `Deck` free of orphaned visual references.
 */
export function stripOrphanedVisuals(
  deck: Deck,
  knownVisualIds: ReadonlySet<string>,
): Deck {
  const slides = deck.slides.map((slide) => stripSlide(slide, knownVisualIds));
  return { ...deck, slides };
}

function stripSlide(slide: Slide, knownVisualIds: ReadonlySet<string>): Slide {
  let nextElements: SlideElement[] | undefined = slide.elements;
  let elementsChanged = false;
  if (slide.elements) {
    nextElements = slide.elements.filter(
      (element) =>
        element.kind !== "visual" ||
        knownVisualIds.has(visualElementId(element) ?? ""),
    );
    elementsChanged = nextElements.length !== slide.elements.length;
  }

  if (!elementsChanged) {
    return slide;
  }

  return {
    ...slide,
    ...(slide.elements !== undefined ? { elements: nextElements } : {}),
  };
}
