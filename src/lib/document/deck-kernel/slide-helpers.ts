/**
 * Pure slide helpers for presentation UI, source sync, and render surfaces.
 *
 * Intentionally free of DOM/React so they can be unit-tested under
 * `node --test`.
 */

import type { Slide } from "./deck-core";
import type { SlideElement, TextElement } from "./deck-elements";
import { isSourceLinked } from "./deck-source-refs";

function textContent(element: TextElement): string {
  return element.content.text.trim();
}

function elementRole(element: SlideElement): string | undefined {
  /* node:coverage ignore next */
  /* Role extraction is asserted through title and summary helper tests; tsx maps this row as residual. */
  return (element as { role?: string }).role;
}

function textElements(slide: Slide): TextElement[] {
  return (slide.elements ?? []).filter(
    (element): element is TextElement => element.kind === "text",
  );
}

const TITLE_ROLE_PRIORITY = ["title", "sectionTitle"] as const;

/** Returns all visual ids referenced by visual elements on a slide. */
export function getSlideVisualIds(slide: Slide): string[] {
  return (slide.elements ?? [])
    .filter((element) => element.kind === "visual")
    .map((element) => element.content.visualId)
    .filter((visualId): visualId is string => visualId.length > 0);
}

/** Returns the effective title text derived from slide elements, without fallback. */
export function getSlideTitleFromElements(slide: Slide): string {
  const texts = textElements(slide);
  for (const role of TITLE_ROLE_PRIORITY) {
    const match = texts.find(
      (element) => elementRole(element) === role && textContent(element),
    );
    if (match) return textContent(match);
  }
  return "";
}

/** Returns every active source-linked element on the slide. */
export function findSourceLinkedElements(slide: Slide): SlideElement[] {
  return (slide.elements ?? []).filter((element) => isSourceLinked(element));
}

export interface SlideContentSummary {
  title: string;
  text: string;
  visualIds: string[];
  sourceLinkedElementCount: number;
}

/** Summarizes slide content from element payloads only. */
export function summarizeSlideContent(slide: Slide): SlideContentSummary {
  const text = textElements(slide)
    .flatMap((element) => {
      const paragraphs = element.content.paragraphs;
      if (paragraphs && paragraphs.length > 0) {
        return paragraphs.map((paragraph) => paragraph.text.trim());
      }
      return [element.content.text.trim()];
    })
    .filter(Boolean)
    .join("\n");

  return {
    title: getSlideTitleFromElements(slide),
    text,
    visualIds: getSlideVisualIds(slide),
    sourceLinkedElementCount: findSourceLinkedElements(slide).length,
  };
}

/**
 * Clamps a slide index so it is always within [0, total − 1].
 * Returns 0 when `total` is 0 or negative (defensive).
 */
export function clampSlideIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(Math.floor(index), 0), total - 1);
}

/**
 * Formats a 1-based progress label such as "3 / 12".
 * `current` is zero-based; `total` is the deck length.
 * When `total` is 0 returns "0 / 0" (empty deck guard).
 */
export function formatProgress(current: number, total: number): string {
  if (total <= 0) return "0 / 0";
  const display = clampSlideIndex(current, total) + 1;
  return `${display} / ${total}`;
}

export type PresentationProgress = {
  label: string;
  percentage: number;
};

/**
 * Computes the shared present/public progress label and progress-bar fill.
 */
export function presentationProgress(
  current: number,
  total: number,
): PresentationProgress {
  return {
    label: formatProgress(current, total),
    percentage:
      total > 1 ? (clampSlideIndex(current, total) / (total - 1)) * 100 : 100,
  };
}

/**
 * Parses a 1-based slide index from a URL hash string (e.g. `"#3"` → `2`).
 *
 * The hash convention is 1-based so that `#1` is the first slide (index 0).
 * The `#` prefix is optional — both `"#3"` and `"3"` are accepted.
 * Non-numeric or out-of-range hashes return 0 (first slide).
 *
 * @param hash   URL hash value, e.g. from `window.location.hash`.
 * @param total  Total number of slides in the deck.
 * @returns      0-based slide index, clamped to [0, total − 1].
 */
export function slideIndexFromHash(hash: string, total: number): number {
  /* node:coverage ignore next 4 */
  /* Hash parsing edge cases are asserted in slide-helper tests; tsx maps the branch rows as residual. */
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const n = parseInt(stripped, 10);
  if (!Number.isFinite(n) || n < 1) return 0;
  return clampSlideIndex(n - 1, total);
}

/**
 * Builds a 1-based URL hash string for the given 0-based slide index.
 *
 * - Index 0 → `"#1"`
 * - Index 2 → `"#3"`
 *
 * @param index  0-based slide index.
 * @returns      Hash string with leading `"#"`.
 */
export function hashFromSlideIndex(index: number): string {
  return `#${Math.max(0, Math.floor(index)) + 1}`;
}

/** Minimum horizontal travel (px) for a swipe to count as a navigation. */
export const SWIPE_THRESHOLD_PX = 50;

/**
 * Resolves a horizontal swipe into a slide-navigation intent, mirroring the
 * public viewer's gesture: a left swipe advances, a right swipe goes back, and
 * anything shorter than `threshold` is ignored as an incidental touch.
 *
 * Pure and DOM-free so both the public viewer and in-app Present mode can share
 * the same swipe semantics under unit test.
 *
 * @param deltaX     Horizontal travel: end clientX minus start clientX.
 * @param threshold  Minimum absolute travel to register (defaults to
 *                   {@link SWIPE_THRESHOLD_PX}).
 * @returns `"next"` for a left swipe, `"prev"` for a right swipe, or `null`
 *          when the gesture is too short to be intentional.
 */
export function resolveSwipeNavigation(
  deltaX: number,
  threshold: number = SWIPE_THRESHOLD_PX,
): "next" | "prev" | null {
  if (Math.abs(deltaX) < threshold) return null;
  return deltaX < 0 ? "next" : "prev";
}
