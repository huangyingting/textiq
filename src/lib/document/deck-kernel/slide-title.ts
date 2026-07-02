/**
 * Pure, DOM-free helper for labelling a slide in the thumbnail rail and other
 * chrome. Derivation order:
 *
 *  1. the highest-priority title text element (`role` title, then sectionTitle);
 *  2. otherwise the first non-empty text element content;
 *  3. otherwise the positional fallback `"Slide N"` (1-based).
 *
 * No React, no DOM — fully testable under `node --test`.
 */

import type { Slide } from "./deck-core";
import type { TextElement } from "./deck-elements";

/**
 * The slide's effective title (without any positional fallback). The title is
 * read from the highest-priority heading text element (`role` title → sectionTitle)
 * so on-stage edits stay the single source of truth. Returns `""` when no
 * heading element yields a non-empty title.
 *
 * Shared by {@link deriveSlideTitle} (rail label) and `deck-merge` (sync
 * matching key) so the displayed title and the matching key never drift apart —
 * a renamed title element matches its slide instead of orphaning it.
 */
const TITLE_ROLE_PRIORITY = ["title", "sectionTitle"] as const;

function textOf(element: TextElement): string {
  return element.content.text;
}

function roleOf(element: TextElement): string | undefined {
  return (element as { role?: string }).role;
}

export function slideEffectiveTitle(slide: Slide): string {
  const elements = slide.elements ?? [];
  for (const role of TITLE_ROLE_PRIORITY) {
    const heading = elements.find(
      (element): element is TextElement =>
        element.kind === "text" &&
        roleOf(element) === role &&
        textOf(element).trim().length > 0,
    );
    if (heading) {
      return textOf(heading).trim();
    }
  }
  return "";
}

/** Derives a human-readable title for `slide` at zero-based `index`. */
export function deriveSlideTitle(slide: Slide, index: number): string {
  const effective = slideEffectiveTitle(slide);
  if (effective) {
    return effective;
  }

  // Labelling-only fallback: a slide with body text but no title element still
  // gets a real label rather than "Slide N".
  const texts = (slide.elements ?? []).filter(
    (element): element is TextElement =>
      element.kind === "text" && textOf(element).trim().length > 0,
  );
  if (texts[0]) {
    return textOf(texts[0]).trim();
  }

  return `Slide ${index + 1}`;
}
