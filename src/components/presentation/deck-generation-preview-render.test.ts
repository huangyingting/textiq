import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import {
  buildDeck,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import { createServerRenderHarness } from "@/test/react-server-renderer";
import { DeckDiagnosticsReview } from "./deck-diagnostics-review";
import {
  DeckGenerationDiagnosticsNotice,
  DeckGenerationPreview,
} from "./deck-generation-preview";

function createHookRenderer() {
  return createServerRenderHarness({ idPrefix: "preview-test-id" });
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
  assert.ok(
    collectElements(secondTree).some(
      (element) => element.type === DeckDiagnosticsReview,
    ),
  );
});
