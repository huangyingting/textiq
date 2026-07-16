/**
 * POST /api/generate — turn text into candidate visuals (US-010).
 *
 * Flow: parse → validate (length/type, before any LLM call) → check Azure config
 * → identify the user → enforce quota (anonymous trial cookie) or rate limit
 * (authenticated, per user) + credit metering → reserve durable hold via usage
 * ledger → generate via Azure OpenAI → capture hold on success (or refund on
 * failure) → return `{ candidates }` only after terminal billing settlement.
 *
 * Authenticated idempotency contract:
 *   - callers MUST send `Idempotency-Key` (8-128 chars, `[A-Za-z0-9._:-]`),
 *   - retries for the same logical operation must reuse the same key, and
 *   - distinct operations must send distinct keys.
 * Missing/invalid keys are rejected with 400 before metering/generation.
 *
 * Anonymous callers get a NON-resetting lifetime trial tracked by a signed
 * cookie AND a server-side fixed-window throttle keyed by hashed client IP, so
 * clearing the cookie does not grant unlimited generations; authenticated
 * callers are rate limited per user AND have their credit balance decremented
 * (~1 credit/word). Generation is blocked at zero credits with a clear 402
 * error, and exceeded limits return 429 with a `Retry-After` header.
 */

import { type NextRequest, type NextResponse } from "next/server";

import { createGenerationRouteHandler } from "@/lib/ai/generation-route";

import { buildGenerateRouteConfig } from "./route-config";

// Use the Node.js runtime: the Azure call and node:crypto signing need it.
export const runtime = "nodejs";

const handleGenerate = createGenerationRouteHandler(buildGenerateRouteConfig());

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleGenerate(request);
}
