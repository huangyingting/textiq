import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  AzureConfigError,
  azureChatComplete,
  getAzureConfig,
  type AzureConfig,
} from "@/lib/ai/azure";
import type { ChatMessage } from "@/lib/ai/prompt";

// ---------------------------------------------------------------------------
// Helpers — stub the global `fetch` so we can assert on the request body the
// Azure client builds without doing any network I/O.
// ---------------------------------------------------------------------------

const CONFIG: AzureConfig = {
  endpoint: "https://example.openai.azure.com",
  apiKey: "test-key",
  deployment: "gpt-5.5",
  apiVersion: "2024-10-21",
};

const MESSAGES: ChatMessage[] = [{ role: "user", content: "hi" }];

function responseFixture(value: unknown): Response {
  return value as unknown as Response;
}

function fetchFixture(
  fetchImpl: (...args: Parameters<typeof fetch>) => Promise<Response>,
): typeof fetch {
  return fetchImpl as typeof fetch;
}

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

/**
 * Replaces `globalThis.fetch` with a stub that records the parsed JSON body of
 * the request and returns a minimal valid chat-completion response. Returns a
 * getter for the captured body.
 */
function stubFetch(): () => Record<string, unknown> {
  let captured: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return () => captured;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("includes the provided maxOutputTokens as max_completion_tokens", async () => {
  const getBody = stubFetch();

  await azureChatComplete(MESSAGES, {
    config: CONFIG,
    maxOutputTokens: 16000,
  });

  assert.equal(getBody().max_completion_tokens, 16000);
});

test("defaults max_completion_tokens when maxOutputTokens is omitted", async () => {
  const getBody = stubFetch();

  await azureChatComplete(MESSAGES, { config: CONFIG });

  // A sensible non-zero default is applied so /api/generate callers that do not
  // pass a cap keep working unchanged.
  assert.equal(getBody().max_completion_tokens, 4000);
});

test("requests JSON-object response mode", async () => {
  const getBody = stubFetch();

  await azureChatComplete(MESSAGES, { config: CONFIG });

  assert.deepEqual(getBody().response_format, { type: "json_object" });
});

test("getAzureConfig trims endpoint slashes and applies optional defaults", () => {
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com///";
  process.env.AZURE_OPENAI_API_KEY = "test-key";
  delete process.env.AZURE_OPENAI_DEPLOYMENT;
  delete process.env.AZURE_OPENAI_API_VERSION;

  assert.deepEqual(getAzureConfig(), {
    endpoint: "https://example.openai.azure.com",
    apiKey: "test-key",
    deployment: "gpt-5.5",
    apiVersion: "2024-10-21",
  });
});

test("getAzureConfig uses explicit deployment and API version", () => {
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
  process.env.AZURE_OPENAI_API_KEY = "test-key";
  process.env.AZURE_OPENAI_DEPLOYMENT = "deck-model";
  process.env.AZURE_OPENAI_API_VERSION = "2025-01-01-preview";

  assert.deepEqual(getAzureConfig(), {
    endpoint: "https://example.openai.azure.com",
    apiKey: "test-key",
    deployment: "deck-model",
    apiVersion: "2025-01-01-preview",
  });
});

test("getAzureConfig rejects missing endpoint or API key", () => {
  delete process.env.AZURE_OPENAI_ENDPOINT;
  process.env.AZURE_OPENAI_API_KEY = "test-key";

  assert.throws(
    () => getAzureConfig(),
    (error) =>
      error instanceof AzureConfigError &&
      /AZURE_OPENAI_ENDPOINT/.test(error.message),
  );
});

test("azureChatComplete sends URL, headers, messages, and abort signal", async () => {
  const controller = new AbortController();
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await azureChatComplete(MESSAGES, {
    config: CONFIG,
    signal: controller.signal,
  });

  assert.equal(result, '{"ok":true}');
  assert.equal(
    capturedUrl,
    "https://example.openai.azure.com/openai/deployments/gpt-5.5/chat/completions?api-version=2024-10-21",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.equal(
    (capturedInit?.headers as Record<string, string>)["api-key"],
    "test-key",
  );
  assert.equal(
    (capturedInit?.headers as Record<string, string>)["content-type"],
    "application/json",
  );
  assert.equal(capturedInit?.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(capturedInit?.body)).messages, MESSAGES);
});

test("azureChatComplete reports network failures", async () => {
  globalThis.fetch = (async () => {
    throw new Error("socket closed");
  }) as typeof fetch;

  await assert.rejects(
    () => azureChatComplete(MESSAGES, { config: CONFIG }),
    /Failed to reach Azure OpenAI: socket closed/,
  );
});

test("azureChatComplete includes readable Azure error response details", async () => {
  globalThis.fetch = (async () =>
    new Response("quota exceeded", { status: 429 })) as typeof fetch;

  await assert.rejects(
    () => azureChatComplete(MESSAGES, { config: CONFIG }),
    (error: Error & { status?: number }) =>
      error.name === "AzureRequestError" &&
      error.status === 429 &&
      /quota exceeded/.test(error.message),
  );
});

test("azureChatComplete handles unreadable Azure error response bodies", async () => {
  globalThis.fetch = fetchFixture(async () =>
    responseFixture({
      ok: false,
      status: 502,
      text: async () => {
        throw new Error("body stream failed");
      },
    }),
  );

  await assert.rejects(
    () => azureChatComplete(MESSAGES, { config: CONFIG }),
    /Azure OpenAI request failed \(502\)$/,
  );
});

test("azureChatComplete rejects non-JSON and empty completion responses", async () => {
  globalThis.fetch = (async () =>
    new Response("not json", { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => azureChatComplete(MESSAGES, { config: CONFIG }),
    /non-JSON response/,
  );

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: "  " } }] }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;
  await assert.rejects(
    () => azureChatComplete(MESSAGES, { config: CONFIG }),
    /empty completion/,
  );
});
