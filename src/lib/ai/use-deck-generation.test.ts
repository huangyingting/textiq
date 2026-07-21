import assert from "node:assert/strict";
import { test } from "node:test";

import { createReactRenderHarness } from "@/test/react-render-harness";
import { IDEMPOTENCY_KEY_HEADER } from "@/lib/ai/idempotency-key";

import { useDeckGeneration } from "./use-deck-generation";

const VALID_DECK = {
  schemaVersion: 7,
  canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
  theme: { packageId: "neutral" },
  assets: { images: {} },
  slides: [
    {
      id: "slide-0001",
      type: "slide",
      template: { kind: "cover" },
      style: { ref: "slide.cover" },
      children: [],
    },
  ],
} as const;

async function waitForScheduledEffects(): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function successfulDeckResponse(): Response {
  return new Response(
    JSON.stringify({
      deck: VALID_DECK,
      truncated: false,
      diagnostics: [],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

test("useDeckGeneration reuses idempotency keys for the same operation and rotates for new input", async () => {
  const seenKeys: string[] = [];
  const originalFetch = globalThis.fetch;
  const renderer = createReactRenderHarness();

  globalThis.fetch = (async (_input, init) => {
    seenKeys.push(new Headers(init?.headers).get(IDEMPOTENCY_KEY_HEADER) ?? "");
    return successfulDeckResponse();
  }) as typeof fetch;

  try {
    const render = () => renderer.run(() => useDeckGeneration());
    const contentA = {
      root: { children: [{ type: "paragraph", text: "alpha" }] },
    };
    const contentB = {
      root: { children: [{ type: "paragraph", text: "beta" }] },
    };

    await render().generate(
      contentA,
      { length: "medium" },
      { themePackageId: "noir" },
    );
    await waitForScheduledEffects();
    await render().generate(
      contentA,
      { length: "medium" },
      { themePackageId: "noir" },
    );
    await waitForScheduledEffects();
    await render().generate(
      contentB,
      { length: "medium" },
      { themePackageId: "noir" },
    );
    await waitForScheduledEffects();

    assert.equal(seenKeys.length, 3);
    assert.equal(seenKeys[0], seenKeys[1]);
    assert.notEqual(seenKeys[1], seenKeys[2]);
    assert.ok(seenKeys.every((key) => key.startsWith("deck-generate-")));
  } finally {
    renderer.cleanup();
    globalThis.fetch = originalFetch;
  }
});

test("useDeckGeneration reset starts a new idempotency lifecycle", async () => {
  const seenKeys: string[] = [];
  const originalFetch = globalThis.fetch;
  const renderer = createReactRenderHarness();

  globalThis.fetch = (async (_input, init) => {
    seenKeys.push(new Headers(init?.headers).get(IDEMPOTENCY_KEY_HEADER) ?? "");
    return successfulDeckResponse();
  }) as typeof fetch;

  try {
    const render = () => renderer.run(() => useDeckGeneration());
    const content = {
      root: { children: [{ type: "paragraph", text: "alpha" }] },
    };

    await render().generate(
      content,
      { length: "medium" },
      { themePackageId: "clarity" },
    );
    await waitForScheduledEffects();
    render().reset();
    await render().generate(
      content,
      { length: "medium" },
      { themePackageId: "clarity" },
    );
    await waitForScheduledEffects();

    assert.equal(seenKeys.length, 2);
    assert.notEqual(seenKeys[0], seenKeys[1]);
  } finally {
    renderer.cleanup();
    globalThis.fetch = originalFetch;
  }
});

test("useDeckGeneration returns superseded when a newer request replaces an in-flight request", async () => {
  const originalFetch = globalThis.fetch;
  const renderer = createReactRenderHarness();
  const firstFetch = createDeferred<Response>();
  const secondFetch = createDeferred<Response>();
  let callCount = 0;

  globalThis.fetch = (async (_input, init) => {
    callCount += 1;
    if (callCount === 1) {
      init?.signal?.addEventListener(
        "abort",
        () => firstFetch.reject(abortError()),
        { once: true },
      );
      return firstFetch.promise;
    }
    return secondFetch.promise;
  }) as typeof fetch;

  try {
    const render = () => renderer.run(() => useDeckGeneration());
    const first = render().generate(
      { root: { children: [{ type: "paragraph", text: "first" }] } },
      { length: "medium" },
      { themePackageId: "noir" },
    );
    const second = render().generate(
      { root: { children: [{ type: "paragraph", text: "second" }] } },
      { length: "medium" },
      { themePackageId: "noir" },
    );

    const firstResult = await first;
    assert.equal(firstResult.ok, false);
    if (!firstResult.ok) {
      assert.equal(firstResult.canceled, true);
      if (firstResult.canceled) {
        assert.equal(firstResult.cancelKind, "superseded");
      }
    }

    secondFetch.resolve(successfulDeckResponse());
    const secondResult = await second;
    assert.equal(secondResult.ok, true);
  } finally {
    renderer.cleanup();
    globalThis.fetch = originalFetch;
  }
});

test("useDeckGeneration reset ignores a late success from an aborted request", async () => {
  const originalFetch = globalThis.fetch;
  const renderer = createReactRenderHarness();
  const pendingFetch = createDeferred<Response>();

  globalThis.fetch = (async () => pendingFetch.promise) as typeof fetch;

  try {
    const render = () => renderer.run(() => useDeckGeneration());
    const generation = render().generate(
      { root: { children: [{ type: "paragraph", text: "cancel me" }] } },
      { length: "medium" },
      { themePackageId: "noir" },
    );
    await waitForScheduledEffects();

    render().reset();
    pendingFetch.resolve(successfulDeckResponse());

    const result = await generation;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.canceled, true);
      if (result.canceled) assert.equal(result.cancelKind, "canceled");
    }

    const state = render();
    assert.equal(state.status, "idle");
    assert.equal(state.deck, null);
    assert.equal(state.error, null);
  } finally {
    renderer.cleanup();
    globalThis.fetch = originalFetch;
  }
});
