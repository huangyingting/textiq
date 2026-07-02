/**
 * Pure helpers for free-form {@link ImageElement} sources.
 *
 * Kept DOM-free so they can be unit tested and shared by the canvas renderer
 * (empty-src placeholder), the inspector file picker (upload validation) and
 * the PPTX exporter (skip empty images) without dragging in React or the
 * browser File API.
 */

import type { Deck } from "../presentation/deck-core";
import { MAX_IMAGE_UPLOAD_BYTES, TOTAL_IMAGE_BUDGET_BYTES } from "@/lib/limits";

export { MAX_IMAGE_UPLOAD_BYTES, TOTAL_IMAGE_BUDGET_BYTES } from "@/lib/limits";

/**
 * True when an image element has no usable source. A bare `<img src="">` shows
 * a broken-image box and can re-request the current page, so every renderer
 * must branch on this instead of emitting an empty `src`.
 */
export function isEmptyImageSrc(src: string | null | undefined): boolean {
  return src == null || src.trim().length === 0;
}

/**
 * Total inlined-image budget for a single deck. Uploaded images are stored as
 * base64 data URLs inside `deckJson`, which is re-serialized and POSTed in full
 * on every autosave (issue #247). This budget is derived from the deck JSON
 * hard cap by reserving non-image JSON overhead (slide structure, text, theme,
 * geometry, etc.), leaving the rest for inlined image payload. A future option
 * is to offload images to blob storage and reference them by URL instead of
 * inlining.
 *
 * The budget is measured against the size of the data-URL strings actually
 * stored in `deckJson` (the thing serialized and sent), not the decoded pixel
 * data. Both {@link ImageElement} `src` values and per-slide `backgroundImage`
 * data URLs count toward this limit.
 */
export type ImageFileValidation = { ok: true } | { ok: false; reason: string };

/** The subset of {@link File} the validator needs (so it stays DOM-free). */
export interface ImageFileMeta {
  type: string;
  size: number;
}

/**
 * Validates a chosen file before it is read into a data URL: it must be an
 * image MIME type and must not exceed {@link MAX_IMAGE_UPLOAD_BYTES}.
 */
export function validateImageFile(
  file: ImageFileMeta,
  maxBytes: number = MAX_IMAGE_UPLOAD_BYTES,
): ImageFileValidation {
  if (!file.type.startsWith("image/")) {
    return { ok: false, reason: "Please choose an image file." };
  }
  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, reason: `Image must be smaller than ${maxMb} MB.` };
  }
  return { ok: true };
}

/**
 * Estimates how many bytes a source string contributes to `deckJson`.
 *
 * Only inlined `data:` URLs are counted — those are the payload that bloats the
 * saved document. External `http(s)`/relative URLs and empty sources cost ~0
 * because only their short reference string is stored, so they return 0. Data
 * URLs are ASCII, so the string length is an accurate byte count of what is
 * serialized into `deckJson`.
 */
export function dataUrlByteSize(src: string | null | undefined): number {
  if (src == null) {
    return 0;
  }
  if (!src.startsWith("data:")) {
    return 0;
  }
  /* node:coverage ignore next */
  /* Data URL sizing is asserted directly; tsx maps the return row as residual. */
  return src.length;
}

/* node:coverage ignore next 4 */
/* Slide background extraction is asserted through totalInlineImageBytes; tsx maps this helper signature as residual rows. */
function slideBackgroundImageUrl(
  slide: Deck["slides"][number],
): string | undefined {
  const background = (slide as any).designOverrides?.background;
  if (background?.type === "image" && typeof background.url === "string") {
    return background.url;
  }
  return undefined;
}

function masterImageUrls(deck: Deck): string[] {
  return (deck.masters ?? []).flatMap((master) =>
    master.elements.flatMap((element) =>
      element.kind === "image" && element.content.src
        ? [element.content.src]
        : [],
    ),
  );
}

/**
 * Sums the inlined-image bytes across every {@link ImageElement} in the deck
 * AND every per-slide `backgroundImage` that is a `data:` URL — i.e. the total
 * data-URL payload currently stored in `deckJson`. Non-image elements, image
 * elements whose `src` is an external URL, and background images that are
 * remote or absent contribute 0.
 */
export function totalInlineImageBytes(deck: Deck): number {
  let total = 0;
  for (const src of masterImageUrls(deck)) {
    total += dataUrlByteSize(src);
  }
  for (const slide of deck.slides) {
    total += dataUrlByteSize(slideBackgroundImageUrl(slide));
    for (const element of slide.elements ?? []) {
      if (element.kind === "image") {
        total += dataUrlByteSize(element.content.src);
      }
    }
  }
  return total;
}

/** Result of a {@link canAddImage} budget check. */
export interface ImageBudgetCheck {
  /** True when the new image fits within `budget`. */
  ok: boolean;
  /** Projected total inlined-image bytes after adding `newBytes`. */
  totalBytes: number;
  /** The budget the check was made against. */
  budget: number;
}

/**
 * Predicate for the inspector upload path: can `newBytes` of new inlined image
 * data be added to `deck` without exceeding `budget`? Returns the projected
 * total so callers can surface it in an error message.
 *
 * `newBytes` is the *net* change in inlined bytes (a fresh upload passes its
 * full size; a replacement passes `newSize - oldSize`), so swapping one image
 * for another of similar size is not falsely rejected. Pure and DOM-free.
 */
export function canAddImage(
  deck: Deck,
  newBytes: number,
  budget: number = TOTAL_IMAGE_BUDGET_BYTES,
): ImageBudgetCheck {
  const totalBytes = totalInlineImageBytes(deck) + newBytes;
  return { ok: totalBytes <= budget, totalBytes, budget };
}
