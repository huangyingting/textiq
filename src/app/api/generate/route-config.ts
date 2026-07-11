/**
 * Route-specific wiring for `POST /api/generate`, isolated from
 * `createGenerationRouteHandler` so tests can assert the contract (rate-limit
 * subjects/messages, validator/generator delegation, response shaping)
 * without constructing the handler statically at module load — the factory
 * itself and `generateVisuals`'s model behavior are covered elsewhere.
 */
import { NextResponse } from "next/server";

import { generateVisuals } from "@/lib/ai/generate";
import type { GenerationRouteConfig } from "@/lib/ai/generation-route";
import type { Visual } from "@/lib/visual/schema";

import {
  mapGenerateError,
  parseGeneratePayload,
  type GeneratePayload,
} from "./parser";

/** Scope tag for structured error logs from this route. */
export const GENERATE_LOG_SCOPE = "api.generate";

export interface GenerateRouteDeps {
  generateVisuals: typeof generateVisuals;
}

const defaultDeps: GenerateRouteDeps = { generateVisuals };

export function buildGenerateRouteConfig(
  overrides: Partial<GenerateRouteDeps> = {},
): GenerationRouteConfig<GeneratePayload, Visual[]> {
  const deps: GenerateRouteDeps = { ...defaultDeps, ...overrides };

  return {
    logScope: GENERATE_LOG_SCOPE,
    operation: "generate",
    rateLimitSubjects: {
      user: "ai.visual.user",
      anonymousIp: "ai.visual.anonymous-ip",
    },
    anonymousQuotaExceededMessage:
      "You've used all your free generations. Sign in to keep creating visuals.",
    unexpectedErrorMessage: "Unexpected error while generating visuals.",
    parsePayload: parseGeneratePayload,
    creditText: (payload) => payload.text,
    generate: ({ payload, complete }) =>
      deps.generateVisuals(payload, { complete }),
    successResponse: (candidates) => NextResponse.json({ candidates }),
    mapGenerationError: mapGenerateError,
  };
}
