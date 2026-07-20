import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import {
  buildDeck,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import { createReactRenderHarness } from "@/test/react-render-harness";
import { SlideEditorOpenDialog } from "./slide-editor-open-dialog";

function collectElements(node: ReactNode, elements: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (!isValidElement(node)) return elements;
  elements.push(node);
  collectElements((node.props as { children?: ReactNode }).children, elements);
  return elements;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function findElementByText(tree: ReactNode, label: string): ReactElement {
  const element = collectElements(tree).find(
    (candidate) =>
      textContent((candidate.props as { children?: ReactNode }).children) ===
      label,
  );
  assert.ok(element, `Missing ${label} element`);
  return element;
}

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

function generatedDeck() {
  return buildDeck(
    [
      buildSlide("content", [buildTextNode({ id: "text-generated" })], {
        id: "slide-generated",
      }),
    ],
    { theme: { packageId: "noir" } },
  );
}

function successfulDeckResponse(): Response {
  return new Response(
    JSON.stringify({
      deck: generatedDeck(),
      truncated: false,
      diagnostics: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("SlideEditorOpenDialog sends the active theme package when generating", async () => {
  const hookRenderer = createReactRenderHarness({
    idPrefix: "open-dialog-test-id",
  });
  const deck = generatedDeck();
  const originalFetch = globalThis.fetch;
  let seenBody: unknown = null;
  const applied: unknown[] = [];

  globalThis.fetch = (async (_url, init) => {
    seenBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        deck,
        truncated: false,
        diagnostics: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const tree = hookRenderer.run(() =>
      SlideEditorOpenDialog({
        contentJson: '{"root":{"children":[]}}',
        themePackageId: "noir",
        onApply: (result) => applied.push(result),
        onDerive: () => undefined,
        onClose: () => undefined,
      }),
    );
    const generate = findElementByText(tree, "Generate with AI");

    await (generate.props as { onClick: () => Promise<void> }).onClick();

    assert.deepEqual(seenBody, {
      contentJson: '{"root":{"children":[]}}',
      options: { length: "medium" },
      themePackageId: "noir",
    });
    assert.deepEqual(
      (applied[0] as { deck?: unknown } | undefined)?.deck,
      deck,
    );
  } finally {
    hookRenderer.cleanup();
    globalThis.fetch = originalFetch;
  }
});

test("SlideEditorOpenDialog canceling an in-flight generation does not derive or apply", async () => {
  const hookRenderer = createReactRenderHarness({
    idPrefix: "open-dialog-cancel-test-id",
  });
  const originalFetch = globalThis.fetch;
  const pendingFetch = createDeferred<Response>();
  let deriveCount = 0;
  let applyCount = 0;
  let closeCount = 0;

  globalThis.fetch = (async (_url, init) => {
    init?.signal?.addEventListener(
      "abort",
      () => pendingFetch.reject(abortError()),
      { once: true },
    );
    return pendingFetch.promise;
  }) as typeof fetch;

  const renderDialog = () =>
    hookRenderer.run(() =>
      SlideEditorOpenDialog({
        contentJson: '{"root":{"children":[]}}',
        themePackageId: "noir",
        onApply: () => {
          applyCount += 1;
        },
        onDerive: () => {
          deriveCount += 1;
        },
        onClose: () => {
          closeCount += 1;
        },
      }),
    );

  try {
    const generate = findElementByText(renderDialog(), "Generate with AI");
    const generation = (
      generate.props as { onClick: () => Promise<void> }
    ).onClick();
    await waitForScheduledEffects();

    const cancel = findElementByText(renderDialog(), "Cancel");
    (cancel.props as { onClick: () => void }).onClick();
    await generation;
    await waitForScheduledEffects();

    assert.equal(deriveCount, 0);
    assert.equal(applyCount, 0);
    assert.equal(closeCount, 0);
  } finally {
    hookRenderer.cleanup();
    globalThis.fetch = originalFetch;
  }
});

test("SlideEditorOpenDialog ignores a superseded generation result", async () => {
  const hookRenderer = createReactRenderHarness({
    idPrefix: "open-dialog-superseded-test-id",
  });
  const originalFetch = globalThis.fetch;
  const firstFetch = createDeferred<Response>();
  const secondFetch = createDeferred<Response>();
  let callCount = 0;
  let deriveCount = 0;
  let applyCount = 0;

  globalThis.fetch = (async (_url, init) => {
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

  const renderDialog = () =>
    hookRenderer.run(() =>
      SlideEditorOpenDialog({
        contentJson: '{"root":{"children":[]}}',
        themePackageId: "noir",
        onApply: () => {
          applyCount += 1;
        },
        onDerive: () => {
          deriveCount += 1;
        },
        onClose: () => undefined,
      }),
    );

  try {
    const generate = findElementByText(renderDialog(), "Generate with AI");
    const clickGenerate = generate.props as { onClick: () => Promise<void> };

    const first = clickGenerate.onClick();
    const second = clickGenerate.onClick();
    await first;
    assert.equal(deriveCount, 0);
    assert.equal(applyCount, 0);

    secondFetch.resolve(successfulDeckResponse());
    await second;

    assert.equal(deriveCount, 0);
    assert.equal(applyCount, 1);
  } finally {
    hookRenderer.cleanup();
    globalThis.fetch = originalFetch;
  }
});

test("SlideEditorOpenDialog still derives on a genuine generation failure", async () => {
  const hookRenderer = createReactRenderHarness({
    idPrefix: "open-dialog-failure-test-id",
  });
  const originalFetch = globalThis.fetch;
  let deriveCount = 0;
  let applyCount = 0;

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "boom" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const tree = hookRenderer.run(() =>
      SlideEditorOpenDialog({
        contentJson: '{"root":{"children":[]}}',
        themePackageId: "noir",
        onApply: () => {
          applyCount += 1;
        },
        onDerive: () => {
          deriveCount += 1;
        },
        onClose: () => undefined,
      }),
    );
    const generate = findElementByText(tree, "Generate with AI");

    await (generate.props as { onClick: () => Promise<void> }).onClick();

    assert.equal(deriveCount, 1);
    assert.equal(applyCount, 0);
  } finally {
    hookRenderer.cleanup();
    globalThis.fetch = originalFetch;
  }
});
