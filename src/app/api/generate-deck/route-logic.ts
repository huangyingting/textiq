import { countWords } from "@/lib/ai/deck-metrics";
import type { CompleteFn } from "@/lib/ai/generate";
import {
  runDeckGeneration,
  type RunDeckGenerationInput,
  type RunDeckGenerationResult,
} from "@/lib/ai/run-deck-generation";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type { Deck } from "@/lib/presentation/schema";
import { safeParseDeck } from "@/lib/presentation/validation";
import type { ThemePackageId } from "@/lib/presentation/theme-package-ids";
import { logInfo } from "@/lib/log";

import type { GenerateDeckPayload } from "./parser";

export const GENERATE_DECK_LOG_SCOPE = "api.generate-deck";

export interface GenerateDeckRouteResult {
  deck: Deck;
  truncated: boolean;
  diagnostics: PresentationDiagnostic[];
  planner: "ai";
  mode: NonNullable<GenerateDeckPayload["options"]["mode"]>;
  themePackageId?: ThemePackageId;
  selectedKindCounts?: Record<string, number>;
}

export interface GenerateDeckResponseMetadata {
  planner: "ai";
  mode: NonNullable<GenerateDeckPayload["options"]["mode"]>;
  tableSlideCount: number;
  schemaValid: boolean;
  themePackageId?: ThemePackageId;
  selectedKindCounts?: Record<string, number>;
}

export interface GenerateDeckRouteDeps {
  runDeck(input: RunDeckGenerationInput): Promise<RunDeckGenerationResult>;
  logInfo(
    scope: string,
    message: string,
    context?: Record<string, unknown>,
  ): void;
}

const defaultDeps: GenerateDeckRouteDeps = {
  runDeck: runDeckGeneration,
  logInfo,
};

export async function generateDeckForRoute(
  input: {
    payload: GenerateDeckPayload;
    complete: CompleteFn;
    requestId?: string;
  },
  overrides: Partial<GenerateDeckRouteDeps> = {},
): Promise<GenerateDeckRouteResult> {
  const deps = { ...defaultDeps, ...overrides };
  const { payload, complete } = input;
  const result = await deps.runDeck({
    contentJson: payload.contentJson,
    visuals: payload.visuals,
    themePackageId: payload.themePackageId,
    complete,
    options: payload.options,
  });
  return {
    deck: result.deck,
    truncated: result.truncated,
    diagnostics: result.diagnostics,
    planner: "ai",
    mode: payload.options.mode ?? "faithful",
    themePackageId: payload.themePackageId,
    selectedKindCounts: result.selectedKindCounts,
  };
}

function countTableSlides(deck: Deck): number {
  let count = 0;
  for (const slide of deck.slides) {
    const children = Array.isArray(slide.children) ? slide.children : [];
    if (children.some((child) => child.type === "table")) {
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Minimal presentation route metrics (content-free, safe to log)
// ---------------------------------------------------------------------------

interface RouteMetrics {
  slideCount: number;
  wordsPerSlide: number;
  percentSlidesWithVisual: number;
  schemaValid: boolean;
  sourceWordCount?: number;
}

function computeRouteMetrics(
  deck: Deck,
  options: { sourceWordCount?: number } = {},
): RouteMetrics {
  const slideCount = deck.slides.length;
  let totalWords = 0;
  let slidesWithVisual = 0;

  for (const slide of deck.slides) {
    const children = Array.isArray(slide.children) ? slide.children : [];
    let slideHasVisual = false;
    for (const child of children) {
      if (child.type === "text") {
        for (const para of child.content?.paragraphs ?? []) {
          totalWords += countWords(para.text);
        }
      }
      if (child.type === "image" || child.type === "visual") {
        slideHasVisual = true;
      }
    }
    if (slideHasVisual) {
      slidesWithVisual += 1;
    }
  }

  const wordsPerSlide = slideCount > 0 ? totalWords / slideCount : 0;
  const percentSlidesWithVisual =
    slideCount > 0 ? slidesWithVisual / slideCount : 0;
  const schemaValid = safeParseDeck(deck).success;

  const metrics: RouteMetrics = {
    slideCount,
    wordsPerSlide,
    percentSlidesWithVisual,
    schemaValid,
  };

  if (
    typeof options.sourceWordCount === "number" &&
    options.sourceWordCount > 0
  ) {
    metrics.sourceWordCount = options.sourceWordCount;
  }

  return metrics;
}

function buildGenerateDeckResponseMetadata(
  result: GenerateDeckRouteResult,
  schemaValid: boolean,
): GenerateDeckResponseMetadata {
  return {
    planner: result.planner,
    mode: result.mode,
    tableSlideCount: countTableSlides(result.deck),
    schemaValid,
    ...(result.themePackageId ? { themePackageId: result.themePackageId } : {}),
    ...(result.selectedKindCounts
      ? { selectedKindCounts: result.selectedKindCounts }
      : {}),
  };
}

export function buildGenerateDeckSuccessResponse(
  result: GenerateDeckRouteResult,
): {
  deck: Deck;
  truncated: boolean;
  diagnostics: PresentationDiagnostic[];
  metadata: GenerateDeckResponseMetadata;
} {
  const metrics = computeRouteMetrics(result.deck);
  return {
    deck: result.deck,
    truncated: result.truncated,
    diagnostics: result.diagnostics,
    metadata: buildGenerateDeckResponseMetadata(result, metrics.schemaValid),
  };
}

export function buildGenerateDeckSuccessLogFields(
  result: GenerateDeckRouteResult,
  context: {
    payload: GenerateDeckPayload;
    requestId: string;
    latencyMs: number;
  },
): Record<string, unknown> {
  const metrics = computeRouteMetrics(result.deck, {
    sourceWordCount: countWords(context.payload.outline),
  });
  return {
    requestId: context.requestId,
    latencyMs: context.latencyMs,
    outlineChars: context.payload.outline.length,
    outlineWords: metrics.sourceWordCount ?? 0,
    slideCount: metrics.slideCount,
    wordsPerSlide: metrics.wordsPerSlide,
    percentSlidesWithVisual: metrics.percentSlidesWithVisual,
    schemaValid: metrics.schemaValid,
    truncated: result.truncated,
    planner: result.planner,
    mode: result.mode,
    tableSlideCount: countTableSlides(result.deck),
    ...(result.themePackageId ? { packageId: result.themePackageId } : {}),
    ...(result.selectedKindCounts
      ? { selectedKindCounts: result.selectedKindCounts }
      : {}),
  };
}

export function logGenerateDeckSuccess(
  result: GenerateDeckRouteResult,
  context: {
    payload: GenerateDeckPayload;
    requestId: string;
    latencyMs: number;
  },
  logger: GenerateDeckRouteDeps["logInfo"] = logInfo,
): void {
  try {
    logger(
      GENERATE_DECK_LOG_SCOPE,
      "deck-generated",
      buildGenerateDeckSuccessLogFields(result, context),
    );
  } catch {
    // Metrics logging is best-effort and must never affect the response.
  }
}
