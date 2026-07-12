/**
 * Route-specific wiring for `POST /api/generate-deck`, isolated from
 * `createGenerationRouteHandler` so tests can assert the contract (rate-limit
 * subjects/messages, validator/generator delegation, response shaping,
 * telemetry `onSuccess` policy) without constructing the handler statically
 * at module load — the factory itself and deck-generation model behavior are
 * covered elsewhere.
 */
import { NextResponse } from "next/server";

import { DECK_OUTPUT_TOKEN_BUDGET } from "@/lib/limits";
import type { GenerationRouteConfig } from "@/lib/ai/generation-route";

import {
  mapGenerateDeckError,
  parseGenerateDeckPayload,
  type GenerateDeckPayload,
} from "./parser";
import {
  buildGenerateDeckSuccessResponse,
  generateDeckForRoute,
  GENERATE_DECK_LOG_SCOPE,
  logGenerateDeckSuccess,
  type GenerateDeckRouteResult,
} from "./route-logic";

export interface GenerateDeckRouteDeps {
  generateDeckForRoute: typeof generateDeckForRoute;
}

const defaultDeps: GenerateDeckRouteDeps = { generateDeckForRoute };

export function buildGenerateDeckRouteConfig(
  overrides: Partial<GenerateDeckRouteDeps> = {},
): GenerationRouteConfig<GenerateDeckPayload, GenerateDeckRouteResult> {
  const deps: GenerateDeckRouteDeps = { ...defaultDeps, ...overrides };

  return {
    logScope: GENERATE_DECK_LOG_SCOPE,
    operation: "generate-deck",
    rateLimitSubjects: {
      user: "ai.deck.user",
      anonymousIp: "ai.deck.anonymous-ip",
    },
    anonymousQuotaExceededMessage:
      "You've used all your free generations. Sign in to keep creating decks.",
    unexpectedErrorMessage: "Unexpected error while generating the deck.",
    azureMaxOutputTokens: DECK_OUTPUT_TOKEN_BUDGET,
    parsePayload: parseGenerateDeckPayload,
    creditText: (payload) => payload.outline,
    generate: (context) => deps.generateDeckForRoute(context),
    successResponse: (result) =>
      NextResponse.json(buildGenerateDeckSuccessResponse(result)),
    mapGenerationError: mapGenerateDeckError,
    onSuccess: logGenerateDeckSuccess,
  };
}
