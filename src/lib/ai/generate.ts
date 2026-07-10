/**
 * Core text → visual generation logic (US-010).
 *
 * This module is intentionally free of any network or framework dependencies:
 * the LLM call is injected as a `complete` function so the logic can be unit
 * tested deterministically. The route handler wires in the real Azure client.
 *
 * Responsibilities:
 *   - reject empty input and input longer than {@link MAX_INPUT_CHARS} BEFORE
 *     calling the model,
 *   - ask the model for `>= MIN_CANDIDATES` visuals,
 *   - tolerate code fences / surrounding prose when extracting JSON,
 *   - validate every candidate against the canonical visual schema,
 *   - retry on garbled / insufficient output and, when retries are exhausted,
 *     throw a {@link GenerationError} with a clear message.
 */

import { buildGenerationMessages } from "@/lib/ai/prompt";
import {
  runGenerationAttempts,
  type CompleteFn,
} from "@/lib/ai/generation-runner";
import {
  AI_GENERATION_INPUT_MAX_CHARS,
  formatVisualInputTooLongError,
} from "@/lib/limits";
import {
  safeParseVisual,
  type Visual,
  type VisualKind,
} from "@/lib/visual/schema";
import type { DetailLevel, Orientation } from "@/lib/ai/prompt";
import { isPlainObject } from "@/lib/type-guards";

export { extractJson, type CompleteFn } from "@/lib/ai/generation-runner";

/** Maximum accepted input length; longer text is rejected before any LLM call. */
export const MAX_INPUT_CHARS = AI_GENERATION_INPUT_MAX_CHARS;

/** Minimum number of valid candidate visuals a generation must yield. */
export const MIN_CANDIDATES = 3;

/** Upper bound on returned candidates to keep responses small. */
const MAX_CANDIDATES = 6;

/** Default number of LLM attempts (the first try plus retries). */
const DEFAULT_MAX_ATTEMPTS = 2;

/** Thrown when the input text is empty/blank. */
export class EmptyInputError extends Error {
  constructor() {
    super("Input text is required.");
    this.name = "EmptyInputError";
  }
}

/** Thrown when the input text exceeds {@link MAX_INPUT_CHARS}. */
export class InputTooLongError extends Error {
  readonly length: number;
  readonly limit: number;
  constructor(length: number) {
    super(formatVisualInputTooLongError(length));
    this.name = "InputTooLongError";
    this.length = length;
    this.limit = MAX_INPUT_CHARS;
  }
}

/** Thrown when the model cannot produce enough valid candidates. */
export class GenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GenerationError";
  }
}

export interface GenerateInput {
  text: string;
  /** Optional desired visual type. */
  type?: VisualKind;
  /** Override the minimum number of candidates requested. */
  count?: number;
  /** Layout orientation hint. `"auto"` (or omitted) = today's behavior. */
  orientation?: Orientation;
  /**
   * `"detailed"` expands the text; `"summary"` produces a compact output.
   * Omitting reproduces today's behavior.
   */
  detailLevel?: DetailLevel;
  /**
   * When `true`, instructs the model to preserve original wording in labels.
   */
  stayCloserToText?: boolean;
}

export interface GenerateDeps {
  complete: CompleteFn;
  /** First attempt + retries. Defaults to {@link DEFAULT_MAX_ATTEMPTS}. */
  maxAttempts?: number;
  /** Minimum valid candidates required. Defaults to {@link MIN_CANDIDATES}. */
  minCandidates?: number;
}

/** Reads candidate visual objects from the current model response shape. */
export function coerceCandidates(parsed: unknown): unknown[] {
  if (!isPlainObject(parsed)) {
    return [];
  }
  /* node:coverage ignore next -- Current-wrapper success and fallback paths are asserted; tsx maps this ternary as uncovered. */
  return Array.isArray(parsed.visuals) ? parsed.visuals : [];
}

/** Puts candidates matching `type` first while preserving relative order. */
function preferType(candidates: Visual[], type: VisualKind): Visual[] {
  const matching = candidates.filter((visual) => visual.type === type);
  const rest = candidates.filter((visual) => visual.type !== type);
  return [...matching, ...rest];
}

/**
 * Turns text into `>= minCandidates` validated {@link Visual} candidates.
 *
 * @throws {EmptyInputError} when the text is blank.
 * @throws {InputTooLongError} when the text exceeds {@link MAX_INPUT_CHARS}.
 * @throws {GenerationError} when no valid set of candidates can be produced.
 */
export async function generateVisuals(
  input: GenerateInput,
  deps: GenerateDeps,
): Promise<Visual[]> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) {
    throw new EmptyInputError();
  }
  if (text.length > MAX_INPUT_CHARS) {
    /* node:coverage ignore next */
    /* Oversized-input branch is asserted; tsx maps the throw tail as uncovered. */
    throw new InputTooLongError(text.length);
  }

  const minCandidates = deps.minCandidates ?? MIN_CANDIDATES;
  const maxAttempts = Math.max(1, deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  /* node:coverage ignore next -- Requested-count precedence is asserted; tsx maps this expression as uncovered. */
  const requested = Math.max(minCandidates, input.count ?? minCandidates);

  return runGenerationAttempts<unknown[], Visual[]>({
    pipeline: "visual",
    maxAttempts,
    initialFailureReason: "The AI did not return any valid visuals.",
    complete: deps.complete,
    buildMessages: (retryReason) =>
      buildGenerationMessages({
        text,
        type: input.type,
        count: requested,
        retryReason,
        orientation: input.orientation,
        detailLevel: input.detailLevel,
        stayCloserToText: input.stayCloserToText,
      }),
    repair: (parsed) => {
      const rawCandidates = coerceCandidates(parsed);
      return rawCandidates.length > 0
        ? {
            success: true,
            data: rawCandidates,
            meta: { rawCandidateCount: rawCandidates.length },
          }
        : {
            success: false,
            reason: "The AI response contained no visuals.",
            meta: { rawCandidateCount: 0, minCandidateCount: minCandidates },
          };
    },
    validate: (rawCandidates) => {
      const valid: Visual[] = [];
      for (const candidate of rawCandidates) {
        const result = safeParseVisual(candidate);
        if (result.success) {
          valid.push(result.data);
        }
      }

      if (valid.length >= minCandidates) {
        const ordered = input.type ? preferType(valid, input.type) : valid;
        return { success: true, data: ordered.slice(0, MAX_CANDIDATES) };
      }

      return {
        success: false,
        reason: `Only ${valid.length} of ${rawCandidates.length} visuals were valid (need ${minCandidates}).`,
        meta: {
          rawCandidateCount: rawCandidates.length,
          validCandidateCount: valid.length,
          minCandidateCount: minCandidates,
        },
      };
    },
    makeServiceError: (reason, cause) =>
      new GenerationError(`The AI service could not be reached: ${reason}`, {
        cause,
      }),
    makeFinalError: (attempts, lastReason) =>
      new GenerationError(
        `Could not generate ${minCandidates} valid visuals after ${attempts} attempt(s). ${lastReason}`,
      ),
  });
}
