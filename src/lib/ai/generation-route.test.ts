import assert from "node:assert/strict";
import { test } from "node:test";

import { NextResponse } from "next/server";

import { GenerateTimeoutError } from "@/lib/ai/deadline";
import { GenerationError } from "@/lib/ai/generate";
import {
  createGenerationRouteHandler,
  type GenerationRouteConfig,
  type GenerationRouteDeps,
  type GenerationRouteRequest,
  type PayloadParseResult,
} from "@/lib/ai/generation-route";
import { readJsonObject } from "@/lib/api/route-adapters";
import {
  ANON_COOKIE_NAME,
  newAnonState,
  parseAnonCookie,
  signAnonState,
} from "@/lib/ai/quota";
import { InsufficientCreditsError } from "@/lib/billing/credits";
import type { MeteredUsageReservation } from "@/lib/billing/metered-usage";

interface FakePayload {
  text: string;
}

interface FakeResult {
  value: string;
}

interface FakeState {
  user: { id: string } | null;
  now: number;
  balance: number;
  rateAllowed: boolean;
  rateResetAt: number;
  generateError: Error | null;
  captureError: Error | null;
  captureInsufficientCredits: boolean;
  refundError: Error | null;
  generated: number;
  reserved: unknown[];
  captured: unknown[];
  refunded: unknown[];
  deducted: unknown[];
  denials: unknown[];
  logs: unknown[];
  subjects: string[];
}

const SECRET = "test-secret";
const PERIOD_END = new Date("2026-07-01T00:00:00Z");

function parsePayload(
  body: Record<string, unknown>,
): PayloadParseResult<FakePayload> {
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) {
    return { ok: false, status: 400, message: "`text` is required." };
  }
  return { ok: true, payload: { text } };
}

function createConfig(
  state: FakeState,
): GenerationRouteConfig<FakePayload, FakeResult> {
  return {
    logScope: "api.fake-generate",
    operation: "fake-generate",
    rateLimitSubjects: {
      user: "fake-user",
      anonymousIp: "fake-anon-ip",
    },
    anonymousQuotaExceededMessage:
      "You've used all your free generations. Sign in to keep creating fakes.",
    unexpectedErrorMessage: "Unexpected error while generating fakes.",
    parsePayload,
    creditText: (payload) => payload.text,
    generate: async ({ payload }) => {
      state.generated += 1;
      if (state.generateError) {
        throw state.generateError;
      }
      return { value: payload.text.toUpperCase() };
    },
    successResponse: (result) => NextResponse.json({ result }),
    mapGenerationError: (error) => {
      if (error instanceof GenerationError) {
        return {
          status: 502,
          message:
            "We couldn't generate fakes from that text. Please try again.",
          log: { reason: "generation-failed", status: 502 },
        };
      }
      return null;
    },
  };
}

function createState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    user: { id: "user-1" },
    now: Date.parse("2026-06-25T00:00:00Z"),
    balance: 10,
    rateAllowed: true,
    rateResetAt: Date.parse("2026-06-25T00:01:00Z"),
    generateError: null,
    captureError: null,
    captureInsufficientCredits: false,
    refundError: null,
    generated: 0,
    reserved: [],
    captured: [],
    refunded: [],
    deducted: [],
    denials: [],
    logs: [],
    subjects: [],
    ...overrides,
  };
}

function createDeps(state: FakeState): GenerationRouteDeps {
  return {
    requestId: () => "request-1",
    now: () => state.now,
    getSecret: () => SECRET,
    getAzureConfig: () => ({
      endpoint: "https://example.openai.azure.com",
      apiKey: "key",
      deployment: "deployment",
      apiVersion: "2024-10-21",
    }),
    azureChatComplete: async () => "{}",
    withAbortDeadline: (factory) => factory(new AbortController().signal),
    timeoutMs: 45_000,
    getCurrentUser: async () => state.user,
    rateLimitStore: {
      async get() {
        return undefined;
      },
      async set() {},
    },
    checkRateLimitWithStore: async (_store, key) => {
      state.subjects.push(key);
      return {
        allowed: state.rateAllowed,
        remaining: state.rateAllowed ? 9 : 0,
        limit: 10,
        resetAt: state.rateResetAt,
      };
    },
    rateLimitSubject: (scope, identifier) => `${scope}:${identifier}`,
    userRateLimit: () => 10,
    userRateWindowMs: () => 60_000,
    checkIpRateLimit: async ({ namespace, headers }) => {
      const ip = headers.get("x-forwarded-for") ?? "unknown";
      const hash = `hash:${SECRET}:${ip}`;
      const key = `${namespace}:${hash}`;
      state.subjects.push(key);
      return {
        allowed: state.rateAllowed,
        result: {
          allowed: state.rateAllowed,
          remaining: state.rateAllowed ? 9 : 0,
          limit: 10,
          resetAt: state.rateResetAt,
        },
        retryAfterSeconds: state.rateAllowed
          ? undefined
          : Math.max(1, Math.ceil((state.rateResetAt - state.now) / 1000)),
        subjectHash: hash,
        key,
      };
    },
    anonTrialLimit: () => 5,
    parseAnonCookie,
    newAnonState,
    signAnonState,
    reserveMeteredUsage: async (opts) => {
      const creditCost = opts.creditText
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      if (state.balance < creditCost) {
        return {
          ok: false,
          reason: "insufficient-credits",
          creditCost,
          balance: state.balance,
          periodEnd: PERIOD_END,
          message:
            `Insufficient credits: you need ${creditCost} but have ${state.balance}. ` +
            `Your credits reset on ${PERIOD_END.toLocaleDateString()}. ` +
            "Upgrade your plan or wait for your credits to reset.",
        };
      }
      const reservation: MeteredUsageReservation = {
        idempotencyKey: opts.idempotencyKey,
        userId: opts.userId,
        operation: opts.operation,
        creditCost,
        ledgerReserved: creditCost > 0,
      };
      state.reserved.push(opts);
      return { ok: true, reservation };
    },
    captureMeteredUsage: async (reservation) => {
      state.captured.push(reservation);
      if (state.captureError) {
        return {
          ok: false,
          error: state.captureError,
          insufficientCredits: state.captureInsufficientCredits,
        };
      }
      return { ok: true };
    },
    refundMeteredUsage: async (reservation) => {
      state.refunded.push(reservation);
      if (state.refundError) {
        throw state.refundError;
      }
    },
    isAzureConfigError: () => false,
    isTimeoutError: (error) => error instanceof GenerateTimeoutError,
    isInsufficientCreditsError: (error) =>
      error instanceof InsufficientCreditsError,
    logError: (_scope, error, fields) => {
      state.logs.push({ error, fields });
    },
    logRouteDenial: (opts) => {
      state.denials.push(opts);
    },
  };
}

function createRequest(
  body: unknown,
  options: { headers?: HeadersInit; cookies?: Record<string, string> } = {},
): GenerationRouteRequest {
  const cookies = new Map(Object.entries(options.cookies ?? {}));
  return {
    async json() {
      if (body instanceof Error) {
        throw body;
      }
      return body;
    },
    async text() {
      if (body instanceof Error) {
        throw body;
      }
      return JSON.stringify(body) ?? "";
    },
    headers: new Headers(options.headers),
    cookies: {
      get(name) {
        const value = cookies.get(name);
        return value === undefined ? undefined : { value };
      },
    },
  };
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json();
}

test("readJsonObject returns route-compatible invalid payload errors", async () => {
  const invalidJson = await readJsonObject(
    createRequest(new Error("bad json")),
  );
  assert.equal(invalidJson.ok, false);
  assert.equal(invalidJson.response.status, 400);
  assert.deepEqual(await responseJson(invalidJson.response), {
    error: "Request body must be valid JSON.",
    code: "VALIDATION_ERROR",
  });

  const nonObject = await readJsonObject(createRequest([]));
  assert.equal(nonObject.ok, false);
  assert.equal(nonObject.response.status, 400);
  assert.deepEqual(await responseJson(nonObject.response), {
    error: "Request body must be a JSON object.",
    code: "VALIDATION_ERROR",
  });
});

test("invalid parsed payload returns validation error before auth or Azure setup", async () => {
  const state = createState();
  const deps = {
    ...createDeps(state),
    getSecret: () => {
      throw new Error("auth should not be checked for invalid payloads");
    },
  };
  const handler = createGenerationRouteHandler(createConfig(state), deps);

  const response = await handler(createRequest({ text: "   " }));

  assert.equal(response.status, 400);
  assert.deepEqual(await responseJson(response), {
    error: "`text` is required.",
    code: "VALIDATION_ERROR",
  });
  assert.equal(state.generated, 0);
});

test("authenticated success reserves then captures credits without setting anon cookie", async () => {
  const state = createState();
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), {
    result: { value: "HELLO WORLD" },
  });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(state.subjects[0], "fake-user:user-1");
  assert.equal(state.generated, 1);
  assert.equal(state.reserved.length, 1);
  assert.equal(state.captured.length, 1);
  assert.equal(state.refunded.length, 0);
});

test("zero-credit authenticated success skips capture", async () => {
  const state = createState();
  const config: GenerationRouteConfig<FakePayload, FakeResult> = {
    ...createConfig(state),
    creditText: () => "",
  };
  const handler = createGenerationRouteHandler(config, createDeps(state));

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 200);
  assert.equal(state.reserved.length, 1);
  assert.equal(state.captured.length, 0);
});

test("anonymous success increments the signed one-year trial cookie", async () => {
  const state = createState({ user: null });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(
    createRequest(
      { text: "hello anon" },
      { headers: { "x-forwarded-for": "203.0.113.1" } },
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(state.subjects[0], "fake-anon-ip:hash:test-secret:203.0.113.1");
  assert.equal(state.reserved.length, 0);
  assert.equal(state.captured.length, 0);

  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.ok(setCookie.startsWith(`${ANON_COOKIE_NAME}=`));
  assert.match(setCookie, /Max-Age=31536000/);
  assert.match(setCookie, /HttpOnly/);
  const value = setCookie.split(";")[0]?.slice(`${ANON_COOKIE_NAME}=`.length);
  assert.ok(value);
  const parsed = parseAnonCookie(value, SECRET);
  assert.equal(parsed?.count, 1);
});

test("rate limit returns 429 with Retry-After before generation", async () => {
  const state = createState({
    rateAllowed: false,
    rateResetAt: Date.parse("2026-06-25T00:00:09Z"),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "9");
  assert.deepEqual(await responseJson(response), {
    error: "Rate limit exceeded. Please wait a moment and try again.",
    code: "RATE_LIMITED",
  });
  assert.equal(state.generated, 0);
  assert.equal(state.denials.length, 1);
});

test("insufficient credits returns 402 before reserve or generation", async () => {
  const state = createState({ balance: 1 });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 402);
  assert.deepEqual(await responseJson(response), {
    error:
      "Insufficient credits: you need 2 but have 1. " +
      `Your credits reset on ${PERIOD_END.toLocaleDateString()}. ` +
      "Upgrade your plan or wait for your credits to reset.",
    code: "PAYMENT_REQUIRED",
  });
  assert.equal(state.generated, 0);
  assert.equal(state.reserved.length, 0);
  assert.equal(state.denials.length, 1);
});

test("timeout refunds reserved usage and preserves 504 semantics", async () => {
  const state = createState({
    generateError: new GenerateTimeoutError(45_000),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 504);
  assert.deepEqual(await responseJson(response), {
    error: "The AI took too long to respond. Please try again.",
    code: "SERVER_ERROR",
  });
  assert.equal(state.reserved.length, 1);
  assert.equal(state.captured.length, 0);
  assert.equal(state.refunded.length, 1);
  assert.equal(state.denials.length, 1);
});

test("generation errors without a reserved ledger skip refund attempts", async () => {
  const state = createState({
    generateError: new GenerationError("invalid model output"),
  });
  const deps = {
    ...createDeps(state),
    reserveMeteredUsage: async () => {
      const reservation: MeteredUsageReservation = {
        idempotencyKey: "request-1",
        userId: "user-1",
        operation: "fake-generate",
        creditCost: 0,
        ledgerReserved: false,
      };
      state.reserved.push(reservation);
      return { ok: true as const, reservation };
    },
  };
  const handler = createGenerationRouteHandler(createConfig(state), deps);

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 502);
  assert.equal(state.refunded.length, 0);
});

test("generation failure refunds reserved usage and preserves 502 semantics", async () => {
  const state = createState({
    generateError: new GenerationError("invalid model output"),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 502);
  assert.deepEqual(await responseJson(response), {
    error: "We couldn't generate fakes from that text. Please try again.",
    code: "SERVER_ERROR",
  });
  assert.equal(state.reserved.length, 1);
  assert.equal(state.captured.length, 0);
  assert.equal(state.refunded.length, 1);
  assert.equal(state.logs.length, 1);
});

test("missing auth secret fails closed before Azure setup", async () => {
  const state = createState();
  const deps = { ...createDeps(state), getSecret: () => undefined };
  const handler = createGenerationRouteHandler(createConfig(state), deps);

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 500);
  assert.deepEqual(await responseJson(response), {
    error: "Server is misconfigured (missing AUTH_SECRET).",
    code: "SERVER_ERROR",
  });
  assert.equal(state.generated, 0);
  assert.equal(state.logs.length, 1);
});

test("Azure configuration errors return the feature-disabled response", async () => {
  const state = createState();
  const azureError = new Error("missing deployment");
  const deps = {
    ...createDeps(state),
    getAzureConfig: () => {
      throw azureError;
    },
    isAzureConfigError: (error: unknown) => error === azureError,
  };
  const handler = createGenerationRouteHandler(createConfig(state), deps);

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 503);
  assert.deepEqual(await responseJson(response), {
    error: "AI generation is not configured.",
    code: "FEATURE_DISABLED",
  });
  assert.equal(state.generated, 0);
  assert.equal(state.logs.length, 1);
});

test("unexpected Azure setup errors are logged and rethrown", async () => {
  const state = createState();
  const setupError = new Error("unexpected Azure setup failure");
  const deps = {
    ...createDeps(state),
    getAzureConfig: () => {
      throw setupError;
    },
  };
  const handler = createGenerationRouteHandler(createConfig(state), deps);

  await assert.rejects(() => handler(createRequest({ text: "hello world" })), {
    message: "unexpected Azure setup failure",
  });
  assert.equal(state.logs.length, 1);
});

test("complete helper calls Azure with config, timeout, and max output tokens", async () => {
  const state = createState();
  const seen: Record<string, unknown> = {};
  const deps = {
    ...createDeps(state),
    withAbortDeadline: async <T>(
      factory: (signal: AbortSignal) => Promise<T>,
      timeoutMs: number,
    ) => {
      seen.timeoutMs = timeoutMs;
      return factory(new AbortController().signal);
    },
    azureChatComplete: async (messages: unknown, options: unknown) => {
      seen.messages = messages;
      seen.options = options;
      return "azure-result";
    },
  };
  const config: GenerationRouteConfig<FakePayload, FakeResult> = {
    ...createConfig(state),
    azureMaxOutputTokens: 123,
    generate: async ({ complete }) => ({
      value: await complete([{ role: "user", content: "hello" }]),
    }),
  };
  const handler = createGenerationRouteHandler(config, deps);

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), {
    result: { value: "azure-result" },
  });
  assert.equal(seen.timeoutMs, 45_000);
  assert.deepEqual(seen.messages, [{ role: "user", content: "hello" }]);
  assert.equal(
    (seen.options as { maxOutputTokens?: number }).maxOutputTokens,
    123,
  );
});

test("anonymous IP rate limit returns a network-specific 429", async () => {
  const state = createState({
    user: null,
    rateAllowed: false,
    rateResetAt: Date.parse("2026-06-25T00:00:30Z"),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(
    createRequest(
      { text: "hello anon" },
      { headers: { "x-forwarded-for": "198.51.100.7" } },
    ),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.deepEqual(await responseJson(response), {
    error:
      "Too many anonymous generations from your network. Please wait and try again, or sign in.",
    code: "RATE_LIMITED",
  });
  assert.equal(state.generated, 0);
  assert.equal(state.denials.length, 1);
});

test("anonymous trial quota returns configured quota message", async () => {
  const state = createState({ user: null });
  const deps = {
    ...createDeps(state),
    anonTrialLimit: () => 1,
  };
  const handler = createGenerationRouteHandler(createConfig(state), deps);
  const usedCookie = signAnonState({ id: "anon-used", count: 1 }, SECRET);

  const response = await handler(
    createRequest(
      { text: "hello anon" },
      { cookies: { [ANON_COOKIE_NAME]: usedCookie } },
    ),
  );

  assert.equal(response.status, 429);
  assert.deepEqual(await responseJson(response), {
    error:
      "You've used all your free generations. Sign in to keep creating fakes.",
    code: "RATE_LIMITED",
  });
  assert.equal(state.generated, 0);
  assert.equal(state.denials.length, 1);
});

test("capture insufficient credits converts a successful generation to payment required", async () => {
  const state = createState({
    captureError: new InsufficientCreditsError(0, 2),
    captureInsufficientCredits: true,
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 402);
  const body = await responseJson(response);
  assert.equal((body as { code?: string }).code, "PAYMENT_REQUIRED");
  assert.match(
    (body as { error?: string }).error ?? "",
    /Insufficient credits/,
  );
  assert.equal(state.generated, 1);
  assert.equal(state.captured.length, 1);
  assert.equal(state.denials.length, 1);
});

test("capture insufficient credits refunds the reserved usage exactly once (#1847)", async () => {
  const state = createState({
    captureError: new InsufficientCreditsError(0, 2),
    captureInsufficientCredits: true,
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  await handler(createRequest({ text: "hello world" }));

  assert.equal(
    state.refunded.length,
    1,
    "refundMeteredUsage must be called exactly once",
  );
  assert.equal(
    (state.refunded[0] as MeteredUsageReservation).idempotencyKey,
    "request-1",
    "refund must receive the original reservation",
  );
});

test("capture failures are logged but do not block the success response", async () => {
  const state = createState({
    captureError: new Error("ledger capture unavailable"),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), {
    result: { value: "HELLO WORLD" },
  });
  assert.equal(state.logs.length, 1);
});

test("generic capture failure refunds the reserved usage exactly once (#1847)", async () => {
  const state = createState({
    captureError: new Error("ledger capture unavailable"),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  await handler(createRequest({ text: "hello world" }));

  assert.equal(
    state.refunded.length,
    1,
    "refundMeteredUsage must be called exactly once",
  );
  assert.equal(
    (state.refunded[0] as MeteredUsageReservation).idempotencyKey,
    "request-1",
    "refund must receive the original reservation",
  );
});

test("successful capture does not call refund (#1847)", async () => {
  const state = createState();
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 200);
  assert.equal(state.captured.length, 1);
  assert.equal(
    state.refunded.length,
    0,
    "refundMeteredUsage must not be called on success",
  );
});

test("generation exception refunds exactly once and does not double-refund (#1847)", async () => {
  const state = createState({
    generateError: new GenerationError("invalid model output"),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  await handler(createRequest({ text: "hello world" }));

  assert.equal(
    state.refunded.length,
    1,
    "refundMeteredUsage must be called exactly once",
  );
  assert.equal(
    state.captured.length,
    0,
    "no capture attempt on generation exception",
  );
});

test("capture-failure refund settlement failure is structured-logged without changing response (#1847)", async () => {
  const state = createState({
    captureError: new Error("ledger capture unavailable"),
    refundError: new Error("refund settlement unavailable"),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  // Response policy preserved: generic capture failure still delivers result
  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), {
    result: { value: "HELLO WORLD" },
  });

  assert.equal(state.refunded.length, 1, "refund attempted exactly once");

  // Two log entries: capture failure + refund settlement failure
  const refundLog = state.logs.find(
    (l) =>
      ((l as { fields: Record<string, unknown> }).fields as { reason: string })
        .reason === "capture-refund-failed",
  );
  assert.ok(refundLog, "refund settlement failure must be structured-logged");
});

test("insufficient-credits capture refund settlement failure preserves 402 and is logged (#1847)", async () => {
  const state = createState({
    captureError: new InsufficientCreditsError(0, 2),
    captureInsufficientCredits: true,
    refundError: new Error("refund settlement unavailable"),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  // Response policy preserved: insufficient credits still returns 402
  assert.equal(response.status, 402);

  assert.equal(state.refunded.length, 1, "refund attempted exactly once");

  const refundLog = state.logs.find(
    (l) =>
      ((l as { fields: Record<string, unknown> }).fields as { reason: string })
        .reason === "capture-refund-failed",
  );
  assert.ok(refundLog, "refund settlement failure must be structured-logged");
});

test("capture-failure path does not trigger a second refund in the outer catch (#1847)", async () => {
  const state = createState({
    captureError: new InsufficientCreditsError(0, 2),
    captureInsufficientCredits: true,
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  await handler(createRequest({ text: "hello world" }));

  // The capture-failure refund must be the only one; the outer catch must not
  // attempt a second refund for the same reservation.
  assert.equal(
    state.refunded.length,
    1,
    "exactly one refund, no double-refund from outer catch",
  );
});

test("refund failures are logged while preserving the mapped generation error", async () => {
  const state = createState({
    generateError: new GenerationError("invalid model output"),
    refundError: new Error("refund unavailable"),
  });
  const handler = createGenerationRouteHandler(
    createConfig(state),
    createDeps(state),
  );

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 502);
  assert.equal(state.refunded.length, 1);
  assert.equal(state.logs.length, 2);
  assert.deepEqual((state.logs[0] as { fields: unknown }).fields, {
    requestId: "request-1",
    reason: "ledger-refund-failed",
  });
});

test("onSuccess receives latency and can finalize asynchronous side effects", async () => {
  const state = createState();
  const contexts: unknown[] = [];
  const config: GenerationRouteConfig<FakePayload, FakeResult> = {
    ...createConfig(state),
    onSuccess: async (_result, context) => {
      contexts.push(context);
    },
  };
  const handler = createGenerationRouteHandler(config, {
    ...createDeps(state),
    now: () => {
      state.now += 25;
      return state.now;
    },
  });

  const response = await handler(createRequest({ text: "hello world" }));

  assert.equal(response.status, 200);
  assert.equal(contexts.length, 1);
  assert.equal((contexts[0] as { latencyMs: number }).latencyMs, 25);
});
