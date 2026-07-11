/**
 * Top-level export/runtime and feature-gate contract for
 * `POST /api/generate-deck` (#1882). Route-specific config wiring is covered
 * by `route-config.test.ts`; the shared handler internals are covered by
 * `generation-route.test.ts`. This file asserts what the route module
 * statically exports plus the disabled-404 / enabled-delegation gate built
 * by `createGenerateDeckPostHandler` — using an injected `handle` stub so no
 * real generation pipeline runs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import * as route from "./route";
import { createGenerateDeckPostHandler } from "./route";

const FAKE_REQUEST = {} as NextRequest;

test("#1882: generate-deck route pins the Node.js runtime (Azure/node:crypto need it)", () => {
  assert.equal(route.runtime, "nodejs");
});

test("#1882: generate-deck route exports a single POST handler and the DI builder", () => {
  assert.equal(typeof route.POST, "function");
  assert.equal(route.POST.length, 1);
  assert.equal(typeof route.createGenerateDeckPostHandler, "function");
});

test("#1882: generate-deck POST returns 404 BEFORE delegating when the feature flag is disabled", async () => {
  let handleCalls = 0;
  const post = createGenerateDeckPostHandler({
    isAiDeckGenEnabled: () => false,
    handle: async () => {
      handleCalls += 1;
      return NextResponse.json({ unexpected: true });
    },
  });

  const response = await post(FAKE_REQUEST);

  assert.equal(response.status, 404);
  assert.equal(handleCalls, 0);
  const body = await response.json();
  assert.deepEqual(body, { error: "Not found.", code: "NOT_FOUND" });
});

test("#1882: generate-deck POST delegates to the generation handler when the feature flag is enabled", async () => {
  let receivedRequest: NextRequest | null = null;
  const sentinel = NextResponse.json({ candidateDeck: true });
  const post = createGenerateDeckPostHandler({
    isAiDeckGenEnabled: () => true,
    handle: async (request) => {
      receivedRequest = request;
      return sentinel;
    },
  });

  const response = await post(FAKE_REQUEST);

  assert.equal(response, sentinel);
  assert.equal(receivedRequest, FAKE_REQUEST);
});

test("#1882: the default-exported POST wires the real isAiDeckGenEnabled flag (disabled by default in tests)", async () => {
  const previous = process.env.AI_DECK_GEN_ENABLED;
  delete process.env.AI_DECK_GEN_ENABLED;
  try {
    const response = await route.POST(FAKE_REQUEST);
    assert.equal(response.status, 404);
  } finally {
    if (previous === undefined) {
      delete process.env.AI_DECK_GEN_ENABLED;
    } else {
      process.env.AI_DECK_GEN_ENABLED = previous;
    }
  }
});
