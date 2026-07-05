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

test("SlideEditorOpenDialog sends the active theme package when generating", async () => {
  const hookRenderer = createReactRenderHarness({
    idPrefix: "open-dialog-test-id",
  });
  const generatedDeck = buildDeck(
    [
      buildSlide("content", [buildTextNode({ id: "text-generated" })], {
        id: "slide-generated",
      }),
    ],
    { theme: { packageId: "noir" } },
  );
  const originalFetch = globalThis.fetch;
  let seenBody: unknown = null;
  const applied: unknown[] = [];

  globalThis.fetch = (async (_url, init) => {
    seenBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        deck: generatedDeck,
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
    const generate = collectElements(tree).find(
      (element) =>
        textContent((element.props as { children?: ReactNode }).children) ===
        "Generate with AI",
    );
    assert.ok(generate, "Missing Generate with AI button");

    await (generate.props as { onClick: () => Promise<void> }).onClick();

    assert.deepEqual(seenBody, {
      contentJson: '{"root":{"children":[]}}',
      options: { length: "medium" },
      themePackageId: "noir",
    });
    assert.deepEqual(
      (applied[0] as { deck?: unknown } | undefined)?.deck,
      generatedDeck,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
