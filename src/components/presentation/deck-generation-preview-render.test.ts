import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import {
  buildDeck,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import { createReactRenderHarness } from "@/test/react-render-harness";
import { makeDiagnostic } from "@/lib/presentation/diagnostics";
import { DeckDiagnosticsReview } from "./deck-diagnostics-review";
import {
  DeckGenerationDiagnosticsNotice,
  DeckGenerationPreview,
} from "./deck-generation-preview";

function createHookRenderer() {
  return createReactRenderHarness({ idPrefix: "preview-test-id" });
}

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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function findAction(tree: ReactNode, label: string): ReactElement {
  const action = collectElements(tree).find(
    (element) =>
      textContent((element.props as { children?: ReactNode }).children) ===
      label,
  );
  assert.ok(action, `Missing ${label} action`);
  return action;
}

function previewDecks() {
  const baseline = buildDeck([
    buildSlide("content", [buildTextNode({ id: "text-a" })], {
      id: "slide-a",
      notes: "Baseline",
    }),
  ]);
  const proposal = buildDeck([
    buildSlide("content", [buildTextNode({ id: "text-a" })], {
      id: "slide-a",
      notes: "Changed",
    }),
    buildSlide("content", [buildTextNode({ id: "text-b" })], {
      id: "slide-b",
      notes: "Added",
    }),
  ]);
  return { baseline, proposal };
}

test("DeckGenerationPreview routes review, apply, derive, and cancel actions", async () => {
  const { baseline, proposal } = previewDecks();
  const calls: string[] = [];
  const applied: unknown[] = [];
  const hookRenderer = createHookRenderer();

  const firstTree = hookRenderer.run(() =>
    DeckGenerationPreview({
      proposedDeck: proposal,
      baselineDeck: baseline,
      truncated: true,
      generationDiagnostics: [
        {
          code: "unsupported-template-control",
          category: "validation",
          severity: "warning",
          message: "Layout repaired",
          target: { scope: "deck" },
        },
        {
          code: "unsupported-template-control",
          category: "validation",
          severity: "warning",
          message: "Layout repaired",
          target: { scope: "deck" },
        },
      ],
      contentJson: "{}",
      options: { length: "short" },
      themePackageId: "noir",
      onApply: (deck, diagnostics) => {
        calls.push("apply");
        applied.push(deck, diagnostics);
      },
      onDerive: () => calls.push("derive"),
      onCancel: () => calls.push("cancel"),
    }),
  );
  const firstElements = collectElements(firstTree);
  const notice = firstElements.find(
    (element) => element.type === DeckGenerationDiagnosticsNotice,
  );
  assert.ok(notice);
  (notice.props as { onReview: () => void }).onReview();

  const actionResults: unknown[] = [];
  for (const label of ["Cancel", "Use derived deck instead", "Apply"]) {
    const button = firstElements.find(
      (element) =>
        textContent((element.props as { children?: ReactNode }).children) ===
        label,
    );
    assert.ok(button, `Missing ${label} button`);
    actionResults.push((button.props as { onClick: () => unknown }).onClick());
  }
  await Promise.all(actionResults);

  const secondTree = hookRenderer.run(() =>
    DeckGenerationPreview({
      proposedDeck: proposal,
      baselineDeck: baseline,
      truncated: true,
      generationDiagnostics: [
        makeDiagnostic("missing-asset", "error", "Image asset missing", {
          slideId: "slide-b",
          nodeId: "text-b",
          details: { assetId: "hero" },
          action: { type: "open-asset-panel" },
        }),
      ],
      contentJson: "{}",
      options: { length: "short" },
      themePackageId: "noir",
      onApply: () => undefined,
      onDerive: () => undefined,
      onCancel: () => undefined,
    }),
  );

  assert.deepEqual(calls, ["cancel", "derive", "apply"]);
  assert.equal(applied[0], proposal);
  assert.deepEqual(applied[1], [
    {
      code: "unsupported-template-control",
      category: "validation",
      severity: "warning",
      message: "Layout repaired",
      target: { scope: "deck" },
    },
  ]);
  const review = collectElements(secondTree).find(
    (element) => element.type === DeckDiagnosticsReview,
  );
  assert.ok(review);
  const reviewProps = review.props as Record<string, unknown>;
  assert.equal("onNavigate" in reviewProps, false);
  assert.equal("onAction" in reviewProps, false);
});

test("DeckDiagnosticsReview only renders controls backed by real handlers", () => {
  const diagnostic = makeDiagnostic(
    "missing-asset",
    "error",
    "Image asset missing",
    {
      slideId: "slide-b",
      nodeId: "text-b",
      details: { assetId: "hero" },
      action: { type: "open-asset-panel" },
    },
  );

  const previewReview = DeckDiagnosticsReview({
    diagnostics: [diagnostic],
    onClose: () => undefined,
  });
  assert.equal(
    collectElements(previewReview).some(
      (element) => textContent(element) === "Go to target",
    ),
    false,
  );
  assert.equal(
    collectElements(previewReview).some(
      (element) => textContent(element) === "Open asset panel",
    ),
    false,
  );

  const calls: string[] = [];
  const interactiveReview = DeckDiagnosticsReview({
    diagnostics: [diagnostic],
    onClose: () => undefined,
    onNavigate: (target) => calls.push(`navigate:${target.code}`),
    onAction: (action, target) =>
      calls.push(`action:${action.type}:${target.code}`),
  });
  const buttons = collectElements(interactiveReview).filter(
    (element) => element.type === "button",
  );
  const goToTarget = buttons.find(
    (element) => textContent(element) === "Go to target",
  );
  const openAssetPanel = buttons.find(
    (element) => textContent(element) === "Open asset panel",
  );
  assert.ok(goToTarget);
  assert.ok(openAssetPanel);

  (goToTarget.props as { onClick: () => void }).onClick();
  (openAssetPanel.props as { onClick: () => void }).onClick();

  assert.deepEqual(calls, [
    "navigate:missing-asset",
    "action:open-asset-panel:missing-asset",
  ]);
});

test("DeckGenerationPreview sends the original theme package on regenerate", async () => {
  const { baseline, proposal } = previewDecks();
  const hookRenderer = createHookRenderer();
  const originalFetch = globalThis.fetch;
  const regenerated = buildDeck(
    [
      buildSlide("content", [buildTextNode({ id: "text-regenerated" })], {
        id: "slide-regenerated",
      }),
    ],
    { theme: { packageId: "noir" } },
  );
  let seenUrl = "";
  let seenBody: unknown = null;

  globalThis.fetch = (async (url, init) => {
    seenUrl = String(url);
    seenBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ deck: regenerated, truncated: false, diagnostics: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const tree = hookRenderer.run(() =>
      DeckGenerationPreview({
        proposedDeck: proposal,
        baselineDeck: baseline,
        truncated: false,
        generationDiagnostics: [],
        contentJson: '{"root":{"children":[]}}',
        options: { length: "medium" },
        themePackageId: "noir",
        onApply: () => undefined,
        onDerive: () => undefined,
        onCancel: () => undefined,
      }),
    );
    const regenerate = collectElements(tree).find(
      (element) =>
        textContent((element.props as { children?: ReactNode }).children) ===
        "Regenerate",
    );
    assert.ok(regenerate, "Missing Regenerate button");

    await (regenerate.props as { onClick: () => Promise<void> }).onClick();

    assert.equal(seenUrl, "/api/generate-deck");
    assert.deepEqual(seenBody, {
      contentJson: '{"root":{"children":[]}}',
      options: { length: "medium" },
      themePackageId: "noir",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeckGenerationPreview serializes regeneration against duplicate and competing actions", async () => {
  const { baseline, proposal } = previewDecks();
  const hookRenderer = createHookRenderer();
  const originalFetch = globalThis.fetch;
  const pendingFetch = createDeferred<Response>();
  const regenerated = buildDeck(
    [
      buildSlide("content", [buildTextNode({ id: "text-regenerated" })], {
        id: "slide-regenerated",
      }),
    ],
    { theme: { packageId: "noir" } },
  );
  let fetchCalls = 0;
  let applyCalls = 0;
  let appliedDeck: unknown;
  let deriveCalls = 0;
  let cancelCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return pendingFetch.promise;
  }) as typeof fetch;

  const render = () =>
    hookRenderer.run(() =>
      DeckGenerationPreview({
        proposedDeck: proposal,
        baselineDeck: baseline,
        truncated: false,
        generationDiagnostics: [],
        contentJson: '{"root":{"children":[]}}',
        options: { length: "medium" },
        themePackageId: "noir",
        onApply: (deck) => {
          applyCalls += 1;
          appliedDeck = deck;
        },
        onDerive: () => {
          deriveCalls += 1;
        },
        onCancel: () => {
          cancelCalls += 1;
        },
      }),
    );

  try {
    const tree = render();
    const regenerate = findAction(tree, "Regenerate").props as {
      onClick: () => Promise<void>;
    };
    const first = regenerate.onClick();
    const duplicate = regenerate.onClick();
    (findAction(tree, "Apply").props as { onClick: () => void }).onClick();
    (
      findAction(tree, "Use derived deck instead").props as {
        onClick: () => void;
      }
    ).onClick();
    (findAction(tree, "Cancel").props as { onClick: () => void }).onClick();

    assert.equal(fetchCalls, 1);
    assert.equal(applyCalls, 0);
    assert.equal(deriveCalls, 0);
    assert.equal(cancelCalls, 0);

    pendingFetch.resolve(
      new Response(
        JSON.stringify({
          deck: regenerated,
          truncated: false,
          diagnostics: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await Promise.all([first, duplicate]);

    (findAction(render(), "Apply").props as { onClick: () => void }).onClick();
    assert.equal(applyCalls, 1);
    assert.deepEqual(appliedDeck, regenerated);
  } finally {
    hookRenderer.cleanup();
    globalThis.fetch = originalFetch;
  }
});
