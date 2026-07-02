import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import type { DeckChromeConfig, SlideProps } from "@/lib/presentation/schema";
import { DeckChromePanel } from "./deck-chrome-panel";

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

const chrome: DeckChromeConfig = {
  logo: {
    enabled: true,
    assetId: "logo-1",
    placement: "top-right",
    size: "medium",
  },
  footer: { enabled: true, text: "Footer", align: "center" },
  pageNumber: { enabled: true, format: "number", placement: "bottom-right" },
  watermark: {
    enabled: true,
    text: "Draft",
    layoutMode: "diagonal",
    size: "medium",
  },
  border: { enabled: true, color: "#cbd5e1", widthPt: 1 },
  safeArea: { enabled: true, color: "#94a3b8", widthPt: 0.75 },
};

const slideProps: SlideProps = {
  deckChrome: {
    logo: { mode: "override", value: chrome.logo ?? {} },
    footer: { mode: "override", value: chrome.footer ?? {} },
    pageNumber: { mode: "override", value: chrome.pageNumber ?? {} },
    watermark: { mode: "override", value: chrome.watermark ?? {} },
    border: { mode: "override", value: chrome.border ?? {} },
    safeArea: { mode: "override", value: chrome.safeArea ?? {} },
  },
};

test("DeckChromePanel wires global and slide override edit handlers", () => {
  const chromeUpdates: Array<Partial<DeckChromeConfig>> = [];
  const slideUpdates: Array<Partial<SlideProps>> = [];
  const tree = DeckChromePanel({
    chrome,
    slideProps,
    onUpdateChrome: (patch) => chromeUpdates.push(patch),
    onUpdateSlideProps: (patch) => slideUpdates.push(patch),
  });

  const changeEvent = { currentTarget: { checked: false, value: "2.5" } };
  for (const element of collectElements(tree)) {
    const props = element.props as {
      onClick?: () => void;
      onChange?: (event: typeof changeEvent) => void;
    };
    props.onClick?.();
    props.onChange?.(changeEvent);
  }

  assert.ok(chromeUpdates.length >= 20);
  assert.ok(slideUpdates.length >= 13);
  assert.deepEqual(slideUpdates[0], { deckChrome: undefined });
  assert.ok(chromeUpdates.some((patch) => patch.footer?.text === "2.5"));
  assert.ok(
    slideUpdates.some((patch) => patch.deckChrome?.footer?.mode === "override"),
  );
});
