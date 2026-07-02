import type { Deck, Slide } from "./deck-core";
import type { SlideElement } from "./deck-elements";
import { makeSlideId } from "./deck-ids";

/**
 * `Omit` that distributes over a discriminated union, preserving each member's
 * own fields (the built-in `Omit` collapses a union to its common keys).
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A partial patch for a single element, distributing over the union. */
export type ElementPatch = Partial<
  DistributiveOmit<SlideElement, "id" | "kind">
>;

/** Re-stamps each slide's `index` to match its position in the array. */
export function reindex(slides: Slide[]): Slide[] {
  return slides.map((slide, index) =>
    slide.index === index ? slide : { ...slide, index },
  );
}

/** Creates a blank slide. `index` is a placeholder; callers re-index. */
export function freshBlankSlide(): Slide {
  return {
    id: makeSlideId(),
    index: 0,
    title: "",
    notes: "",
    elements: [],
  } as unknown as Slide;
}

/** Maps a single slide by index, leaving the rest of the deck untouched. */
export function mapSlide(
  deck: Deck,
  index: number,
  fn: (slide: Slide) => Slide,
): Deck {
  if (index < 0 || index >= deck.slides.length) {
    return deck;
  }
  const slides = deck.slides.map((slide, i) =>
    i === index ? fn(slide) : slide,
  );
  return { ...deck, slides };
}

/** Returns the next z-index above the current maximum on a slide. */
export function nextZIndex(elements: readonly SlideElement[]): number {
  return (
    elements.reduce((max, element) => Math.max(max, element.zIndex), -1) + 1
  );
}
