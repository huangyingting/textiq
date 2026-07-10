import {
  checkLimit,
  type BudgetCheckResult,
  /* node:coverage ignore next -- Type-only import row is erased by TypeScript. */
  type LimitDefinition,
} from "@/lib/limits/budgets";

export const DECK_JSON_MAX_BYTES = 500_000;
export const MAX_DECK_JSON_BYTES = DECK_JSON_MAX_BYTES;
export const DECK_JSON_NON_IMAGE_RESERVE = 100_000;

export const DECK_JSON_HARD_BYTES = DECK_JSON_MAX_BYTES;
export const DECK_JSON_WARN_BYTES = Math.round(DECK_JSON_HARD_BYTES * 0.8);

export const SLIDES_HARD_COUNT = 50;
export const SLIDES_WARN_COUNT = 40;
export const EXPORT_PREFLIGHT_MAX_SLIDES = SLIDES_HARD_COUNT;

export const ELEMENTS_PER_SLIDE_HARD_COUNT = 100;
export const ELEMENTS_PER_SLIDE_WARN_COUNT = 75;

export const VISUALS_PER_DOCUMENT_HARD_COUNT = 200;
export const VISUALS_PER_DOCUMENT_WARN_COUNT = 150;

export const INLINE_IMAGE_HARD_BYTES =
  DECK_JSON_MAX_BYTES - DECK_JSON_NON_IMAGE_RESERVE;
export const INLINE_IMAGE_WARN_BYTES = Math.round(
  INLINE_IMAGE_HARD_BYTES * 0.75,
);
export const INLINE_IMAGES_HARD_COUNT = 20;
export const INLINE_IMAGES_WARN_COUNT = 15;

export const TOTAL_IMAGE_BUDGET_BYTES = INLINE_IMAGE_HARD_BYTES;
export const MAX_IMAGE_UPLOAD_BYTES = Math.floor(
  /* node:coverage ignore next 3 -- Derived limit is asserted by boundary tests; tsx maps multiline initializer as uncovered. */
  TOTAL_IMAGE_BUDGET_BYTES * (3 / 4),
);

export const AUTOSAVE_WARN_MS = 3_000;
export const EXPORT_PREFLIGHT_WARN_MS = 500;
export const EDITOR_OPEN_WARN_MS = 2_000;

export const DECK_JSON_LIMIT: LimitDefinition = {
  id: "deck.json.bytes",
  description: "Serialized deck JSON accepted by server saves.",
  value: DECK_JSON_HARD_BYTES,
  unit: "bytes",
  enforcement: "enforced",
  warnAt: DECK_JSON_WARN_BYTES,
  diagnostic: { scope: "save.deck", metric: "deckJsonBytes" },
  source: "src/lib/document/persistence-service.ts",
};

export const SLIDE_COUNT_LIMIT: LimitDefinition = {
  id: "deck.slides.count",
  description: "Deck slide count supported reliably by export preflight.",
  value: SLIDES_HARD_COUNT,
  unit: "count",
  enforcement: "warning",
  warnAt: SLIDES_WARN_COUNT,
  diagnostic: { scope: "export.preflight", metric: "slideCount" },
  source: "src/lib/limits/deck.ts",
};

export const ELEMENTS_PER_SLIDE_LIMIT: LimitDefinition = {
  id: "deck.slide-elements.count",
  description: "Recommended maximum number of elements per slide.",
  value: ELEMENTS_PER_SLIDE_HARD_COUNT,
  unit: "count",
  enforcement: "warning",
  warnAt: ELEMENTS_PER_SLIDE_WARN_COUNT,
  diagnostic: { scope: "deck.elements", metric: "elementsPerSlide" },
  source: "src/lib/limits/deck.ts",
};

export const VISUALS_PER_DOCUMENT_LIMIT: LimitDefinition = {
  id: "document.visuals.count",
  description: "Recommended maximum number of visual projections per document.",
  value: VISUALS_PER_DOCUMENT_HARD_COUNT,
  unit: "count",
  enforcement: "warning",
  warnAt: VISUALS_PER_DOCUMENT_WARN_COUNT,
  diagnostic: { scope: "visual.mirror", metric: "visualCount" },
  source: "src/lib/limits/deck.ts",
};

export const INLINE_IMAGE_LIMIT: LimitDefinition = {
  id: "deck.inline-image.bytes",
  description: "Combined data-URL bytes available inside deck JSON.",
  value: INLINE_IMAGE_HARD_BYTES,
  unit: "bytes",
  enforcement: "enforced",
  warnAt: INLINE_IMAGE_WARN_BYTES,
  diagnostic: { scope: "deck.image", metric: "inlineImageBytes" },
  source: "src/lib/limits/deck.ts",
};

export const INLINE_IMAGES_LIMIT: LimitDefinition = {
  id: "deck.inline-images.count",
  description: "Recommended maximum number of inlined images per deck.",
  value: INLINE_IMAGES_HARD_COUNT,
  unit: "count",
  enforcement: "warning",
  warnAt: INLINE_IMAGES_WARN_COUNT,
  diagnostic: { scope: "deck.image", metric: "inlineImageCount" },
  source: "src/lib/limits/deck.ts",
};

export const TIMING_BUDGETS: readonly LimitDefinition[] = [
  {
    id: "deck.autosave.ms",
    description: "Advisory autosave round-trip timing budget.",
    value: AUTOSAVE_WARN_MS,
    unit: "ms",
    enforcement: "warning",
    diagnostic: { scope: "deck.autosave", metric: "autosaveMs" },
    source: "src/lib/limits/deck.ts",
  },
  {
    id: "export.preflight.ms",
    description: "Advisory synchronous export preflight timing budget.",
    value: EXPORT_PREFLIGHT_WARN_MS,
    unit: "ms",
    enforcement: "warning",
    diagnostic: { scope: "export.preflight", metric: "preflightMs" },
    source: "src/lib/limits/deck.ts",
  },
  {
    id: "editor.open.ms",
    description: "Advisory editor open/hydration timing budget.",
    value: EDITOR_OPEN_WARN_MS,
    unit: "ms",
    enforcement: "warning",
    diagnostic: { scope: "editor.open", metric: "editorOpenMs" },
    source: "src/lib/limits/deck.ts",
  },
];

export function formatDeckTooLargeError(): string {
  return "Deck is too large to save.";
}

function withoutLimit(
  result: ReturnType<typeof checkLimit>,
): BudgetCheckResult {
  return {
    metric: result.metric,
    actual: result.actual,
    warnAt: result.warnAt,
    hardAt: result.hardAt,
    exceeded: result.exceeded,
    warned: result.warned,
  };
}

export function checkDeckJsonBudget(byteLength: number): BudgetCheckResult {
  return withoutLimit(checkLimit(DECK_JSON_LIMIT, byteLength));
}

export function checkSlideCountBudget(count: number): BudgetCheckResult {
  return withoutLimit(checkLimit(SLIDE_COUNT_LIMIT, count));
}

export function checkVisualCountBudget(count: number): BudgetCheckResult {
  return withoutLimit(checkLimit(VISUALS_PER_DOCUMENT_LIMIT, count));
}

export function checkInlineImageBudget(byteLength: number): BudgetCheckResult {
  return withoutLimit(checkLimit(INLINE_IMAGE_LIMIT, byteLength));
}
