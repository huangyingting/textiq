/**
 * presentation deck generation pipeline.
 *
 * Produces a `Deck` from AI output via:
 *   SemanticDeckPlanV1 → DocumentSlidePlanV1 → compileDocumentSlidePlanToDeck
 *
 * This module does NOT materialise v6 element trees. The output is always a
 * valid `Deck` ready for `safeParseDeck`, render resolution, and export.
 *
 */

import {
  EmptyInputError,
  GenerationError,
  InputTooLongError,
  MAX_INPUT_CHARS,
  type CompleteFn,
} from "@/lib/ai/generate";
import { runGenerationAttempts } from "@/lib/ai/generation-runner";
import {
  buildDeckGenerationSource,
  type DeckGenerationSource,
} from "@/lib/ai/deck-source";
import type { DeckGenerationOptions } from "@/lib/ai/deck-generation-options";
import { buildDeckMessages } from "@/lib/ai/deck-prompt";
import type { Visual } from "@/lib/visual/schema";
import type { Deck } from "@/lib/presentation/schema";
import type { CanvasSpec } from "@/lib/presentation/types";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import {
  buildDocumentSourcePlanV1,
  compileDocumentSlidePlanToDeck,
  repairDocumentSlidePlan,
  type DocumentSlidePlanV1,
} from "@/lib/presentation/document-slide-plan";

const DEFAULT_MAX_ATTEMPTS = 2;

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface RunDeckGenerationInput {
  contentJson: unknown;
  visuals: ReadonlyMap<string, Visual>;
  themePackageId: string;
  complete: CompleteFn;
  /** Pre-built source; if omitted it is derived from contentJson + visuals. */
  source?: DeckGenerationSource;
  options?: DeckGenerationOptions;
  /** Canvas spec for the generated deck. Defaults to 16:9. */
  canvas?: CanvasSpec;
  maxAttempts?: number;
}

export interface RunDeckGenerationResult {
  deck: Deck;
  truncated: boolean;
  selectedKindCounts: Record<string, number>;
  /** Diagnostics collected during repair + compile. */
  diagnostics: PresentationDiagnostic[];
}

// ---------------------------------------------------------------------------
// Repaired plan shape (returned from runGenerationAttempts)
// ---------------------------------------------------------------------------

interface RepairedDeckPlan {
  plan: DocumentSlidePlanV1;
  diagnostics: PresentationDiagnostic[];
  selectedKindCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the presentation AI generation pipeline:
 *   1. Extracts an outline + visual inventory from the document.
 *   2. Calls the AI with a structured document-source prompt.
 *   3. Repairs the raw AI response as `DocumentSlidePlanV1`.
 *   4. Compiles, stamps provenance, assembles, and validates a `Deck`.
 *
 * Throws `EmptyInputError`, `InputTooLongError`, or `GenerationError` on
 * unrecoverable failures.
 */
export async function runDeckGeneration(
  input: RunDeckGenerationInput,
): Promise<RunDeckGenerationResult> {
  const source =
    input.source ?? buildDeckGenerationSource(input.contentJson, input.visuals);
  const documentSource = buildDocumentSourcePlanV1({
    contentJson: input.contentJson,
  });

  const outline = source.outline.trim();
  if (!outline) throw new EmptyInputError();
  if (outline.length > MAX_INPUT_CHARS) {
    throw new InputTooLongError(outline.length);
  }

  const repairedPlan = await runGenerationAttempts<
    RepairedDeckPlan,
    RepairedDeckPlan
  >({
    pipeline: "deck",
    maxAttempts: Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    initialFailureReason:
      "The AI did not return a valid presentation document slide plan.",
    complete: input.complete,
    buildMessages: (retryReason) =>
      buildDeckMessages({
        outline,
        sourcePlan: documentSource.sourcePlan,
        themePackageId: input.themePackageId,
        ...(input.options !== undefined ? { options: input.options } : {}),
        ...(retryReason !== undefined ? { retryReason } : {}),
      }),
    repair: (parsed) => {
      const result = repairDocumentSlidePlan({
        input: parsed,
        sourcePlan: documentSource.sourcePlan,
      });
      const hasFatal = result.diagnostics.some(
        (d) => d.severity === "fatal" || d.severity === "error",
      );
      if (hasFatal || result.plan.slides.length === 0) {
        return {
          success: false,
          reason:
            "The AI response was not a valid presentation document slide plan.",
          meta: { slideCount: result.plan.slides.length },
        };
      }
      const selectedKindCounts: Record<string, number> = {};
      for (const slide of result.plan.slides) {
        selectedKindCounts[slide.kind] =
          (selectedKindCounts[slide.kind] ?? 0) + 1;
      }
      return {
        success: true,
        data: {
          plan: result.plan,
          diagnostics: result.diagnostics,
          selectedKindCounts,
        },
        meta: { slideCount: result.plan.slides.length },
      };
    },
    validate: (repaired) => ({ success: true, data: repaired }),
    makeServiceError: (reason, cause) =>
      new GenerationError(`The AI service could not be reached: ${reason}`, {
        cause,
      }),
    makeFinalError: (attempts, lastReason) =>
      new GenerationError(
        `Could not generate a valid presentation document slide plan after ${attempts} attempt(s). ${lastReason}`,
      ),
  });

  const allDiagnostics: PresentationDiagnostic[] = [
    ...repairedPlan.diagnostics,
  ];

  const compiled = compileDocumentSlidePlanToDeck({
    plan: repairedPlan.plan,
    blockMap: documentSource.blockMap,
    themePackageId: input.themePackageId,
    ...(input.canvas ? { canvas: input.canvas } : {}),
  });
  if (!compiled.ok) {
    throw new GenerationError(
      `Generated deck failed presentation validation: ${(compiled.validationErrors ?? [compiled.error]).join("; ")}`,
    );
  }
  allDiagnostics.push(...compiled.diagnostics);

  return {
    deck: compiled.deck,
    truncated: source.truncated,
    selectedKindCounts: repairedPlan.selectedKindCounts,
    diagnostics: allDiagnostics,
  };
}
