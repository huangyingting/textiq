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
