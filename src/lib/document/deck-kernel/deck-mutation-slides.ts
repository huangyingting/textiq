import type { Deck, Slide } from "./deck-core";
import { makeSlideId } from "./deck-ids";
import { freshBlankSlide, reindex } from "./deck-mutation-shared";

/** Reorders slides: moves the slide at `fromIndex` to `toIndex`. */
export function reorderSlides(
  deck: Deck,
  fromIndex: number,
  toIndex: number,
): Deck {
  const slides = [...deck.slides];
  if (
    fromIndex < 0 ||
    fromIndex >= slides.length ||
    toIndex < 0 ||
    toIndex >= slides.length ||
    fromIndex === toIndex
  ) {
    return deck;
  }

  const [moved] = slides.splice(fromIndex, 1);
  slides.splice(toIndex, 0, moved);

  return { ...deck, slides: reindex(slides) };
}

/**
 * Moves the slide at `index` one position toward the start (`direction < 0`) or
 * end (`direction > 0`) of the deck, clamping at both ends — a move that would
 * fall off either edge is a no-op that returns the same deck reference. Only the
 * sign of `direction` is used. Delegates to {@link reorderSlides} so re-indexing
 * stays in one place; powers the thumbnail rail's keyboard-accessible ↑/↓
 * reorder buttons.
 */
export function moveSlide(deck: Deck, index: number, direction: number): Deck {
  if (index < 0 || index >= deck.slides.length || direction === 0) {
    return deck;
  }
  const target = index + (direction > 0 ? 1 : -1);
  if (target < 0 || target >= deck.slides.length) {
    return deck;
  }
  return reorderSlides(deck, index, target);
}

/** Adds a blank slide after `afterIndex` (`-1` prepends). */
export function addSlide(deck: Deck, afterIndex: number): Deck {
  const slides = [...deck.slides];
  const insertAt = Math.max(0, Math.min(afterIndex + 1, slides.length));
  slides.splice(insertAt, 0, freshBlankSlide());

  return { ...deck, slides: reindex(slides) };
}

/**
 * Inserts a fully-formed `slide` after `afterIndex` (`-1` prepends), then
 * re-indexes. Unlike {@link addSlide} (which always appends a blank slide), this
 * places a caller-built slide — e.g. one produced by `buildTemplateSlide` — so
 * the editor's template picker can route an authored slide through the same
 * undo/redo `commit` path. The slide is taken as-is; its elements are preserved
 * verbatim.
 */
export function insertSlide(
  deck: Deck,
  afterIndex: number,
  slide: Slide,
): Deck {
  const slides = [...deck.slides];
  const insertAt = Math.max(0, Math.min(afterIndex + 1, slides.length));
  slides.splice(insertAt, 0, slide);

  return { ...deck, slides: reindex(slides) };
}

/** Duplicates the slide at `index`, inserting the copy right after it. */
export function duplicateSlide(deck: Deck, index: number): Deck {
  if (index < 0 || index >= deck.slides.length) {
    return deck;
  }

  const original = deck.slides[index];
  const copy: Slide = {
    ...original,
    id: makeSlideId(),
    ...(original.elements
      ? {
          elements: original.elements.map((element) =>
            structuredClone(element),
          ),
        }
      : {}),
  };

  const slides = [...deck.slides];
  slides.splice(index + 1, 0, copy);

  return { ...deck, slides: reindex(slides) };
}

/** Removes the slide at `index`, keeping at least one slide in the deck. */
export function removeSlide(deck: Deck, index: number): Deck {
  if (index < 0 || index >= deck.slides.length || deck.slides.length <= 1) {
    return deck;
  }

  const slides = [...deck.slides];
  slides.splice(index, 1);

  return { ...deck, slides: reindex(slides) };
}

/** Updates a slide's field(s) and re-indexes the deck. */
export function updateSlide(
  deck: Deck,
  index: number,
  patch: Partial<Omit<Slide, "index">>,
): Deck {
  if (index < 0 || index >= deck.slides.length) {
    return deck;
  }

  const slides = deck.slides.map((slide, i) =>
    i === index ? { ...slide, ...patch, index: slide.index } : slide,
  );

  return { ...deck, slides: reindex(slides) };
}
