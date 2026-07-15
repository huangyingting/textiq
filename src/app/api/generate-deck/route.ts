/**
 * POST /api/generate-deck — turn a document into a presentation Deck (#265).
 *
 * Mirrors the EXACT control flow of `POST /api/generate` (US-010): parse →
 * validate (outline length/shape, before any LLM call) → check Azure config →
 * identify the user → enforce quota (anonymous trial cookie + hashed-IP
 * throttle) or per-user rate limit + credit metering → generate via Azure
 * OpenAI (wrapped in the abort deadline, with an output-token budget) → charge
 * credits on success → return `{ deck, truncated, diagnostics }` (the
 * `truncated` flag tells the UI when the source outline was trimmed to fit the
 * input budget, and `diagnostics` carries AI repair/compile warnings through the
 * preview handoff).
 *
 * Request contract
 * ----------------
 *   { contentJson: <serialised Lexical editor state>, options?: { length?,
 *     tone?, audience? } }
 *
 * Authenticated idempotency contract:
 *   - callers MUST send `Idempotency-Key` (8-128 chars, `[A-Za-z0-9._:-]`),
 *   - retries for the same logical operation must reuse the same key, and
 *   - distinct operations must send distinct keys.
 * Missing/invalid keys are rejected with 400 before metering/generation.
 *
 * The document's VISUALS are derived from `contentJson` itself: every embedded
 * visual node carries its own `visual` payload, so {@link collectDocumentBlocks}
 * yields the `{ visualId → Visual }` map with no DB round-trip or document id.
 * Because the caller supplies the content directly (exactly like `/api/generate`
 * accepts raw `text`), there is no cross-document access and no document-id
 * permission check to perform — the route is gated only by quota and credits.
 *
 * The whole route is feature-flagged behind {@link isAiDeckGenEnabled}
 * (`AI_DECK_GEN_ENABLED`, default OFF): when disabled it returns 404 BEFORE
 * doing any work.
 *
 * Status-code semantics match `/api/generate`: 413 input too long, 429 rate
 * limit (+ `Retry-After`), 402 insufficient credits, 502 bad model output, 504
 * timeout, 503 Azure misconfig.
 */

import { type NextRequest, type NextResponse } from "next/server";

import { createGenerationRouteHandler } from "@/lib/ai/generation-route";
import { notFound } from "@/lib/api/errors";
import { isAiDeckGenEnabled } from "@/lib/ai/config";

import { buildGenerateDeckRouteConfig } from "./route-config";

// Use the Node.js runtime: the Azure call and node:crypto signing need it.
export const runtime = "nodejs";

const handleGenerateDeck = createGenerationRouteHandler(
  buildGenerateDeckRouteConfig(),
);

export interface GenerateDeckPostDeps {
  /** Feature gate checked BEFORE any work is done; defaults to the real flag. */
  isAiDeckGenEnabled: typeof isAiDeckGenEnabled;
  /** The generation delegate invoked once the feature gate passes. */
  handle: (request: NextRequest) => Promise<NextResponse>;
}

/**
 * Builds the `POST` handler with injectable deps so tests can assert the
 * disabled-404 gate and the enabled-delegation contract without exercising
 * the real generation pipeline.
 */
export function createGenerateDeckPostHandler(
  overrides: Partial<GenerateDeckPostDeps> = {},
): (request: NextRequest) => Promise<NextResponse> {
  const deps: GenerateDeckPostDeps = {
    isAiDeckGenEnabled,
    handle: handleGenerateDeck,
    ...overrides,
  };

  return async function POST(request: NextRequest): Promise<NextResponse> {
    // Disabled-by-default feature flag: bail out BEFORE doing any work so the
    // route is invisible until an operator opts in.
    if (!deps.isAiDeckGenEnabled()) {
      return notFound("Not found.");
    }

    return deps.handle(request);
  };
}

export const POST = createGenerateDeckPostHandler();
