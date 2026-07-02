import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SourceBlockIndexEntry } from "@/lib/presentation-vnext/block-index";
import type { SourceReviewItem } from "@/lib/presentation-vnext/source-links";
import {
  SourceReviewPanel,
  sourceReviewActionAriaLabel,
} from "./source-review-panel";

const block: SourceBlockIndexEntry = {
  documentId: "doc-1",
  id: "block-1",
  kind: "text",
  hash: "hash-1",
  displayLabel: "Executive summary",
  refresh: {
    kind: "text",
    text: "Executive summary with customer retention details and forecast assumptions.",
  },
};

function makeTextBlock(id: string, label: string): SourceBlockIndexEntry {
  return {
    documentId: "doc-1",
    id,
    kind: "text",
    hash: `hash-${id}`,
    displayLabel: label,
    refresh: { kind: "text", text: label },
  };
}

const items: SourceReviewItem[] = [
  {
    slideId: "slide-1",
    slideIndex: 0,
    slideLabel: "Slide 1",
    nodeId: "node-stale",
    nodeType: "text",
    nodeName: "Narrative",
    source: {
      documentId: "doc-1",
      blockId: "block-1",
      blockKind: "text",
      contentHash: "old-hash",
    },
    state: "stale",
    reason: "Source block content changed.",
    sourceLabel: "Executive summary",
    block,
  },
  {
    slideId: "slide-2",
    slideIndex: 1,
    slideLabel: "Slide 2",
    nodeId: "node-orphan",
    nodeType: "text",
    source: {
      documentId: "doc-1",
      blockId: "missing-block",
      blockKind: "text",
      contentHash: "missing-hash",
    },
    state: "orphan",
    reason: "Source block is missing from the current document.",
    sourceLabel: "missing-block",
  },
];

function collectClickHandlers(node: ReactNode): (() => void)[] {
  if (Array.isArray(node)) return node.flatMap(collectClickHandlers);
  if (!isValidElement(node)) return [];
  const props = node.props as { onClick?: () => void; children?: ReactNode };
  return [
    ...(typeof props.onClick === "function" ? [props.onClick] : []),
    ...collectClickHandlers(props.children),
  ];
}

function collectSelectHandlers(node: ReactNode): ((value: string) => void)[] {
  if (Array.isArray(node)) return node.flatMap(collectSelectHandlers);
  if (!isValidElement(node)) return [];
  const props = node.props as {
    onChange?: (event: { currentTarget: { value: string } }) => void;
    children?: ReactNode;
  };
  return [
    ...(node.type === "select" && typeof props.onChange === "function"
      ? [(value: string) => props.onChange?.({ currentTarget: { value } })]
      : []),
    ...collectSelectHandlers(props.children),
  ];
}

describe("SourceReviewPanel", () => {
  test("renders deck-level source issues with safe actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(SourceReviewPanel, {
        items,
        sourceBlocks: [block],
        onSelect: () => undefined,
        onRefresh: () => undefined,
        onUnlink: () => undefined,
        onRelink: () => undefined,
        onNavigateSource: () => undefined,
        onDismiss: () => undefined,
        onRefreshAll: () => undefined,
        statusMessage: "Refreshed 1 source links; skipped 1.",
      }),
    );

    assert.match(html, /Source Review/);
    assert.match(html, /Slide 1/);
    assert.match(html, /Narrative/);
    assert.match(
      html,
      /Executive summary with customer retention details and forecast assumptions\./,
    );
    assert.match(html, /Source block not found\./);
    assert.match(html, /Stale/);
    assert.match(html, /Orphaned/);
    assert.match(html, /Refresh all safe stale \(1\)/);
    assert.match(html, /Source block is missing from the current document\./);
    assert.match(html, /Refreshed 1 source links; skipped 1\./);
    assert.match(html, /Mark unlinked/);
    assert.match(html, /Dismiss/);
    assert.ok(
      html.includes(
        `aria-label="${sourceReviewActionAriaLabel("go-to-target", items[0])}"`,
      ),
    );
    assert.ok(
      html.includes(
        `aria-label="${sourceReviewActionAriaLabel("go-to-source", items[0])}"`,
      ),
    );
    assert.ok(
      html.includes(
        `aria-label="${sourceReviewActionAriaLabel("refresh-source-link", items[0])}"`,
      ),
    );
    assert.ok(
      html.includes(
        `aria-label="${sourceReviewActionAriaLabel("relink-source", items[0])}"`,
      ),
    );
    assert.ok(
      html.includes(
        `aria-label="${sourceReviewActionAriaLabel("mark-source-unlinked", items[1])}"`,
      ),
    );
    assert.ok(
      html.includes(
        `aria-label="${sourceReviewActionAriaLabel("dismiss-source-issue", items[1])}"`,
      ),
    );
  });

  test("routes one-by-one source review actions", () => {
    const calls: string[] = [];
    const element = SourceReviewPanel({
      items: [items[0]],
      sourceBlocks: [block],
      onSelect: () => calls.push("select"),
      onRefresh: () => calls.push("refresh"),
      onUnlink: () => calls.push("unlink"),
      onRelink: () => calls.push("relink"),
      onNavigateSource: () => calls.push("source"),
      onDismiss: () => calls.push("dismiss"),
      onRefreshAll: () => calls.push("refresh-all"),
    });

    for (const handler of collectClickHandlers(element)) handler();

    assert.deepEqual(calls, [
      "refresh-all",
      "select",
      "source",
      "refresh",
      "unlink",
      "dismiss",
    ]);
  });

  test("routes relink dropdown selections to explicit source blocks", () => {
    const calls: string[] = [];
    const element = SourceReviewPanel({
      items: [items[1]],
      sourceBlocks: [block],
      onSelect: () => undefined,
      onRefresh: () => undefined,
      onUnlink: () => undefined,
      onRelink: (slideId, nodeId, selectedBlock) =>
        calls.push(`${slideId}:${nodeId}:${selectedBlock.id}`),
      onNavigateSource: () => undefined,
      onDismiss: () => undefined,
      onRefreshAll: () => undefined,
    });

    const [select] = collectSelectHandlers(element);
    assert.ok(select);
    select("text:block-1");

    assert.deepEqual(calls, ["slide-2:node-orphan:block-1"]);
  });

  test("supports relinking to source blocks beyond the previous eight-item cap", () => {
    const calls: string[] = [];
    const sourceBlocks = [
      ...Array.from({ length: 8 }, (_, index) =>
        makeTextBlock(`block-${index + 1}`, `Block ${index + 1}`),
      ),
      makeTextBlock("block-9", "Block 9"),
    ];
    const element = SourceReviewPanel({
      items: [items[1]],
      sourceBlocks,
      onSelect: () => undefined,
      onRefresh: () => undefined,
      onUnlink: () => undefined,
      onRelink: (slideId, nodeId, selectedBlock) =>
        calls.push(`${slideId}:${nodeId}:${selectedBlock.id}`),
      onNavigateSource: () => undefined,
      onDismiss: () => undefined,
      onRefreshAll: () => undefined,
    });

    const [select] = collectSelectHandlers(element);
    assert.ok(select);
    select("text:block-9");

    assert.deepEqual(calls, ["slide-2:node-orphan:block-9"]);
  });

  test("routes source navigation to the resolved document block", () => {
    const calls: string[] = [];
    const element = SourceReviewPanel({
      items: [items[0]],
      sourceBlocks: [block],
      onSelect: () => undefined,
      onRefresh: () => undefined,
      onUnlink: () => undefined,
      onRelink: () => undefined,
      onNavigateSource: (documentId, blockId) =>
        calls.push(`${documentId}:${blockId}`),
      onDismiss: () => undefined,
      onRefreshAll: () => undefined,
    });

    const sourceHandler = collectClickHandlers(element)[2];
    assert.ok(sourceHandler);
    sourceHandler();

    assert.deepEqual(calls, ["doc-1:block-1"]);
  });
});
