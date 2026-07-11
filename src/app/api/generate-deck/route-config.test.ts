/**
 * Top-level wiring contract for `POST /api/generate-deck` (#1882): asserts
 * the route-specific `GenerationRouteConfig` built by
 * `buildGenerateDeckRouteConfig` — rate-limit subjects/messages, the deck
 * output-token budget, validator/generator/telemetry delegation, and
 * response shaping — without exercising `createGenerationRouteHandler`
 * (covered by `generation-route.test.ts`) or the real deck-generation
 * pipeline (covered by `route-logic.test.ts`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DECK_OUTPUT_TOKEN_BUDGET } from "@/lib/limits";
import type { CompleteFn } from "@/lib/ai/generation-runner";
import {
  buildContentSlide,
  buildDeck,
} from "@/test/builders/presentation-deck";

import { mapGenerateDeckError, parseGenerateDeckPayload } from "./parser";
import {
  buildGenerateDeckRouteConfig,
  type GenerateDeckRouteDeps,
} from "./route-config";
import {
  GENERATE_DECK_LOG_SCOPE,
  logGenerateDeckSuccess,
  type GenerateDeckRouteResult,
} from "./route-logic";

const FAKE_COMPLETE: CompleteFn = async () => "unused";

function makeResult(
  overrides: Partial<GenerateDeckRouteResult> = {},
): GenerateDeckRouteResult {
  return {
    deck: buildDeck([buildContentSlide()], { theme: { packageId: "noir" } }),
    truncated: false,
    diagnostics: [],
    planner: "ai",
    mode: "faithful",
    ...overrides,
  };
}

test("#1882: generate-deck route config carries the expected scope/operation", () => {
  const config = buildGenerateDeckRouteConfig();
  assert.equal(config.logScope, GENERATE_DECK_LOG_SCOPE);
  assert.equal(config.logScope, "api.generate-deck");
  assert.equal(config.operation, "generate-deck");
});

test("#1882: generate-deck route config uses distinct deck rate-limit subjects", () => {
  const config = buildGenerateDeckRouteConfig();
  assert.deepEqual(config.rateLimitSubjects, {
    user: "ai.deck.user",
    anonymousIp: "ai.deck.anonymous-ip",
  });
});

test("#1882: generate-deck route config carries the expected anonymous/unexpected messages", () => {
  const config = buildGenerateDeckRouteConfig();
  assert.equal(
    config.anonymousQuotaExceededMessage,
    "You've used all your free generations. Sign in to keep creating decks.",
  );
  assert.equal(
    config.unexpectedErrorMessage,
    "Unexpected error while generating the deck.",
  );
});

test("#1882: generate-deck route config applies the deck output-token budget (unlike /api/generate)", () => {
  const config = buildGenerateDeckRouteConfig();
  assert.equal(config.azureMaxOutputTokens, DECK_OUTPUT_TOKEN_BUDGET);
});

test("#1882: generate-deck route config wires the deck telemetry onSuccess policy", () => {
  const config = buildGenerateDeckRouteConfig();
  assert.equal(config.onSuccess, logGenerateDeckSuccess);
});

test("#1882: generate-deck route config delegates payload parsing to parseGenerateDeckPayload", () => {
  const config = buildGenerateDeckRouteConfig();
  assert.equal(config.parsePayload, parseGenerateDeckPayload);
});

test("#1882: generate-deck route config delegates error mapping to mapGenerateDeckError", () => {
  const config = buildGenerateDeckRouteConfig();
  assert.equal(config.mapGenerationError, mapGenerateDeckError);
});

test("#1882: generate-deck route config credits by the outline text, not the raw contentJson", () => {
  const config = buildGenerateDeckRouteConfig();
  assert.equal(
    config.creditText({
      contentJson: { root: { children: [] } },
      options: {},
      blocks: [],
      visuals: new Map(),
      outline: "Launch\nMeasure",
      truncated: false,
      themePackageId: "noir",
    }),
    "Launch\nMeasure",
  );
});

test("#1882: generate-deck route config's generate() delegates to the injected generateDeckForRoute", async () => {
  const calls: unknown[] = [];
  const fakeResult = makeResult({ truncated: true });
  const deps: Partial<GenerateDeckRouteDeps> = {
    generateDeckForRoute: async (input) => {
      calls.push(input);
      return fakeResult;
    },
  };
  const config = buildGenerateDeckRouteConfig(deps);

  const payload = {
    contentJson: { root: { children: [] } },
    options: {},
    blocks: [],
    visuals: new Map(),
    outline: "Launch",
    truncated: false,
    themePackageId: "noir" as const,
  };
  const result = await config.generate({
    payload,
    requestId: "req-1",
    user: null,
    complete: FAKE_COMPLETE,
  });

  assert.equal(result, fakeResult);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { payload: unknown }).payload, payload);
  assert.equal((calls[0] as { complete: CompleteFn }).complete, FAKE_COMPLETE);
});

test("#1882: generate-deck route config's successResponse wraps the deck result with metadata", async () => {
  const config = buildGenerateDeckRouteConfig();
  const fakeResult = makeResult();
  const response = config.successResponse(fakeResult, {
    payload: {
      contentJson: { root: { children: [] } },
      options: {},
      blocks: [],
      visuals: new Map(),
      outline: "Launch",
      truncated: false,
      themePackageId: "noir",
    },
    requestId: "req-1",
    user: null,
    latencyMs: 12,
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.deck, fakeResult.deck);
  assert.equal(body.truncated, fakeResult.truncated);
  assert.equal(body.metadata.planner, "ai");
  assert.equal(body.metadata.mode, "faithful");
});
