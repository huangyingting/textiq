/**
 * The single shared source for the AI "text → visual" generation request used
 * by every editing surface (the desktop per-block spark and the touch editing
 * sheet). Centralising the `/api/generate` POST, response parsing, error
 * messaging, source-text stamping, and selection eligibility here keeps the
 * fetch/credit handling in exactly one place — surfaces never re-implement it.
 *
 * The eligibility and parsing helpers are DOM-free and React-free so they can be
 * exercised headlessly under `node --test`; {@link requestVisualCandidates}
 * accepts an injectable `fetch` so the network path is testable too.
 */

import type { DetailLevel, Orientation } from "@/lib/ai/prompt";
import {
  IDEMPOTENCY_KEY_HEADER,
  resolveOperationIdempotencyKey,
} from "@/lib/ai/idempotency-key";
import { apiErrorMessageFromPayload } from "@/lib/api/error-message";
import {
  hashSourceText,
  safeParseVisual,
  type Visual,
  type VisualKind,
} from "@/lib/visual/schema";

/** The (optional) generation knobs surfaced by the spark/sheet UIs. */
export interface GenerateOptions {
  type?: VisualKind | "auto";
  orientation?: Orientation;
  detailLevel?: DetailLevel | "auto";
  stayCloserToText?: boolean;
}

/** Distinguishes credit/quota errors from generic generation errors. */
type GenerateErrorKind = "credit" | "other";

/** Result of a generation request: either usable candidates or a user-facing error. */
export type GenerateResult =
  | { ok: true; candidates: Visual[] }
  | { ok: false; error: string; errorKind: GenerateErrorKind };

/** Returns true when a failed {@link GenerateResult} is a credit/quota error. */
export function isCreditError(result: GenerateResult): boolean {
  return !result.ok && result.errorKind === "credit";
}

/** The minimal selection projection generation needs (a subset of EditorContextSnapshot). */
export interface GenerateSelection {
  kind: string;
  blockKey?: string;
  blockText?: string;
  selectionText?: string;
  selectionEndBlockKey?: string;
}

/** A resolved generation target: which block to anchor under and the text to send. */
export interface GenerateTarget {
  blockKey: string;
  text: string;
}

const FALLBACK_REQUEST_ERROR =
  "We couldn't generate a visual. Please try again.";
const EMPTY_CANDIDATES_ERROR = "No usable visuals came back. Please try again.";
export const VISUAL_GENERATION_NETWORK_ERROR =
  "Couldn't reach the generator. Check your connection and try again.";
const INVALID_IDEMPOTENCY_KEY_ERROR =
  "Couldn't create a valid generation idempotency key. Please retry.";

/** Pull the raw `candidates` array off a JSON payload (un-validated). */
export function candidatesFrom(payload: unknown): unknown[] {
  if (payload && typeof payload === "object" && "candidates" in payload) {
    const candidates = (payload as { candidates: unknown }).candidates;
    if (Array.isArray(candidates)) {
      return candidates;
    }
  }
  return [];
}

/** Validate + collect the well-formed {@link Visual}s from a response payload. */
export function parseCandidates(payload: unknown): Visual[] {
  const valid: Visual[] = [];
  for (const item of candidatesFrom(payload)) {
    const result = safeParseVisual(item);
    if (result.success) {
      valid.push(result.data);
    }
  }
  return valid;
}

/** Build the `/api/generate` request body, omitting "auto"/unset knobs. */
export function buildGenerateBody(
  text: string,
  opts: GenerateOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = { text };
  if (opts.type && opts.type !== "auto") body.type = opts.type;
  if (opts.orientation && opts.orientation !== "auto") {
    body.orientation = opts.orientation;
  }
  if (opts.detailLevel && opts.detailLevel !== "auto") {
    body.detailLevel = opts.detailLevel;
  }
  if (opts.stayCloserToText) body.stayCloserToText = true;
  return body;
}

/** True when `text` has non-whitespace content worth turning into a visual. */
export function canGenerateFromText(text: string | undefined | null): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

/**
 * Resolve the block a touch-surface generation should target, or `null` when the
 * selection can't drive a generation. Generation is offered for a live text
 * selection (`range`) with selected text or a caret inside a non-empty block
 * (`collapsed`) that has a live block key and non-empty block text.
 */
export function generateTargetForContext(
  ctx: GenerateSelection,
): GenerateTarget | null {
  if (ctx.kind !== "range" && ctx.kind !== "collapsed") {
    /* node:coverage disable */
    return null;
  }
  let text: string;
  let blockKey: string | undefined;
  if (ctx.kind === "range") {
    text = ctx.selectionText?.trim() ?? "";
    blockKey =
      ctx.selectionEndBlockKey ?? ctx.blockKey; /* node:coverage enable */
  } else {
    text = ctx.blockText?.trim() ?? "";
    blockKey = ctx.blockKey;
  }
  if (text === "" || !blockKey) {
    return null;
  }
  return { blockKey, text };
}

/** Whether a "Generate visual" affordance should be enabled for this selection. */
export function canGenerateForSelection(ctx: GenerateSelection): boolean {
  return generateTargetForContext(ctx) !== null;
}

/**
 * Stamp the source text onto a generated visual so it remembers the text it was
 * derived from (and can be diffed/regenerated later). Pure: returns the visual
 * unchanged when there is no usable source text.
 */
export function stampSourceText(visual: Visual, sourceText: string): Visual {
  const trimmed = sourceText.trim();
  if (trimmed === "") {
    return visual;
  }
  return {
    ...visual,
    sourceText: trimmed,
    sourceTextHash: hashSourceText(trimmed),
  };
}

/**
 * POST the block text to `/api/generate` and return validated candidates or a
 * user-facing error. This is the ONE place the fetch + credit/error handling
 * lives; both the desktop spark and the touch sheet call through here so their
 * loading/error/empty semantics stay identical. `fetchImpl` is injectable for
 * tests.
 */
export async function requestVisualCandidates(
  text: string,
  opts: GenerateOptions = {},
  fetchImpl: typeof fetch = fetch,
  request: {
    idempotencyKey?: string;
  } = {},
): Promise<GenerateResult> {
  let operationKey: string;
  try {
    operationKey = resolveOperationIdempotencyKey(
      "visual-generate",
      request.idempotencyKey,
    );
  } catch {
    return {
      ok: false,
      error: INVALID_IDEMPOTENCY_KEY_ERROR,
      errorKind: "other",
    };
  }

  try {
    const headers = new Headers({ "content-type": "application/json" });
    headers.set(IDEMPOTENCY_KEY_HEADER, operationKey);

    const response = await fetchImpl("/api/generate", {
      method: "POST",
      headers,
      body: JSON.stringify(buildGenerateBody(text, opts)),
    });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        error: apiErrorMessageFromPayload(payload, FALLBACK_REQUEST_ERROR),
        errorKind: response.status === 402 ? "credit" : "other",
      };
    }

    const candidates = parseCandidates(payload);
    if (candidates.length === 0) {
      return { ok: false, error: EMPTY_CANDIDATES_ERROR, errorKind: "other" };
    }

    return { ok: true, candidates };
  } catch {
    return {
      ok: false,
      error: VISUAL_GENERATION_NETWORK_ERROR,
      errorKind: "other",
    };
  }
}
