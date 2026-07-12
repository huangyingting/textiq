/**
 * POST /api/generate — turn text into candidate visuals (US-010).
 *
 * Flow: parse → validate (length/type, before any LLM call) → check Azure config
 * → identify the user → enforce quota (anonymous trial cookie) or rate limit
 * (authenticated, per user) + credit metering → generate via Azure OpenAI →
 * charge credits on success → return `{ candidates }`.
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
