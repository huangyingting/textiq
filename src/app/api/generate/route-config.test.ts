/**
 * Top-level wiring contract for `POST /api/generate` (#1882): asserts the
 * route-specific `GenerationRouteConfig` built by `buildGenerateRouteConfig`
 * — rate-limit subjects/messages, validator/generator delegation, and
 * response shaping — without exercising `createGenerationRouteHandler`
 * (covered by `generation-route.test.ts`) or the real `generateVisuals`
 * model pipeline (covered by `generate.test.ts`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { CompleteFn } from "@/lib/ai/generation-runner";
import type { Visual } from "@/lib/visual/schema";
import { buildVisual } from "@/test/builders/visual";

import { mapGenerateError, parseGeneratePayload } from "./parser";
import { buildGenerateRouteConfig, GENERATE_LOG_SCOPE } from "./route-config";

const FAKE_COMPLETE: CompleteFn = async () => "unused";

test("#1882: generate route config carries the expected scope/operation", () => {
  const config = buildGenerateRouteConfig();
  assert.equal(config.logScope, GENERATE_LOG_SCOPE);
  assert.equal(config.logScope, "api.generate");
  assert.equal(config.operation, "generate");
});

test("#1882: generate route config uses distinct visual rate-limit subjects", () => {
  const config = buildGenerateRouteConfig();
  assert.deepEqual(config.rateLimitSubjects, {
    user: "ai.visual.user",
    anonymousIp: "ai.visual.anonymous-ip",
  });
});

test("#1997: generate route config never reuses deck namespaces", () => {
  const config = buildGenerateRouteConfig();
  assert.notDeepEqual(config.rateLimitSubjects, {
    user: "ai.deck.user",
    anonymousIp: "ai.deck.anonymous-ip",
  });
});

test("#1882: generate route config carries the expected anonymous/unexpected messages", () => {
  const config = buildGenerateRouteConfig();
  assert.equal(
    config.anonymousQuotaExceededMessage,
    "You've used all your free generations. Sign in to keep creating visuals.",
  );
  assert.equal(
    config.unexpectedErrorMessage,
    "Unexpected error while generating visuals.",
  );
});

test("#1882: generate route config has no deck-only azure token budget or persistence hook", () => {
  const config = buildGenerateRouteConfig();
  assert.equal(config.azureMaxOutputTokens, undefined);
  assert.equal(config.onSuccess, undefined);
});

test("#1882: generate route config delegates payload parsing to parseGeneratePayload", () => {
  const config = buildGenerateRouteConfig();
  assert.equal(config.parsePayload, parseGeneratePayload);
});

test("#1882: generate route config delegates error mapping to mapGenerateError", () => {
  const config = buildGenerateRouteConfig();
  assert.equal(config.mapGenerationError, mapGenerateError);
});

test("#1882: generate route config credits by the raw request text", () => {
  const config = buildGenerateRouteConfig();
  assert.equal(config.creditText({ text: "hello world" }), "hello world");
});

test("#1882: generate route config's generate() delegates to the injected generateVisuals with {complete}", async () => {
  const calls: Array<{ payload: unknown; deps: unknown }> = [];
  const fakeResult: Visual[] = [buildVisual({ title: "v1" })];
  const config = buildGenerateRouteConfig({
    generateVisuals: async (payload, deps) => {
      calls.push({ payload, deps });
      return fakeResult;
    },
  });

  const payload = { text: "hello" };
  const result = await config.generate({
    payload,
    requestId: "req-1",
    user: null,
    complete: FAKE_COMPLETE,
  });

  assert.equal(result, fakeResult);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.payload, payload);
  assert.equal(
    (calls[0]?.deps as { complete: CompleteFn }).complete,
    FAKE_COMPLETE,
  );
});

test("#1882: generate route config's successResponse wraps candidates in {candidates}", async () => {
  const config = buildGenerateRouteConfig();
  const fakeResult: Visual[] = [buildVisual({ title: "v1" })];
  const response = config.successResponse(fakeResult, {
    payload: { text: "hello" },
    requestId: "req-1",
    user: null,
    latencyMs: 12,
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { candidates: fakeResult });
});
