import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Dispatch, SetStateAction } from "react";

import type {
  SourceBlockIndex,
  SourceBlockIndexEntry,
} from "@/lib/presentation/block-index";
import { findNodeById } from "@/lib/presentation/node-tree-ops";
import type { Deck } from "@/lib/presentation/schema";
import {
  buildDeck,
  buildSlide,
  buildTextContent,
  buildTextNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import { createServerRenderHarness } from "@/test/react-server-renderer";

import {
  createSelectionState,
  selectedNodeIds,
  type SelectionState,
} from "./selection-model";
import {
  sourceStatusLabelForReview,
  useSourceReviewController,
} from "./use-source-review-controller";

const STALE_BLOCK: SourceBlockIndexEntry = {
  documentId: "doc-1",
  id: "block-stale",
  kind: "text",
  hash: "hash-stale-current",
  displayLabel: "Updated stale source",
  refresh: { kind: "text", text: "Updated stale source copy" },
};

const RELINK_BLOCK: SourceBlockIndexEntry = {
  documentId: "doc-1",
  id: "block-relink",
  kind: "text",
  hash: "hash-relink-current",
  displayLabel: "Relink target",
  refresh: { kind: "text", text: "Relinked source copy" },
};

function buildSourceBlockIndex(): SourceBlockIndex {
  return {
    documentId: "doc-1",
    blocks: [STALE_BLOCK, RELINK_BLOCK],
  };
}

function buildSourceLinkedDeck(): Deck {
  resetBuilderCounter();
  return buildDeck([
    buildSlide(
      "content",
      [
        buildTextNode({
          id: "text-stale",
          name: "Stale source",
          content: buildTextContent(["Old stale copy"]),
          source: {
            documentId: "doc-1",
            blockId: "block-stale",
            blockKind: "text",
            contentHash: "hash-stale-old",
            display: { blockLabel: "Old stale source" },
          },
        }),
        buildTextNode({
          id: "text-orphan",
          name: "Orphan source",
          content: buildTextContent(["Needs relink"]),
          source: {
            documentId: "doc-1",
            blockId: "missing-block",
            blockKind: "text",
            contentHash: "hash-orphan-old",
            display: { blockLabel: "Missing source" },
          },
        }),
      ],
      { id: "slide-source", name: "Source slide" },
    ),
  ]);
}

function textContent(deck: Deck, nodeId: string): string {
  const node = findNodeById(deck.slides[0]?.children ?? [], nodeId);
  if (!node || node.type !== "text") {
    assert.fail(`Expected text node ${nodeId}.`);
  }
  return node.content.paragraphs.map((paragraph) => paragraph.text).join("\n");
}

function applySelectionUpdate(
  current: SelectionState,
  next: SetStateAction<SelectionState>,
): SelectionState {
  return typeof next === "function"
    ? (next as (previous: SelectionState) => SelectionState)(current)
    : next;
}

describe("useSourceReviewController", () => {
  test("labels source status from document availability and review count", () => {
    assert.equal(
      sourceStatusLabelForReview(undefined, 0),
      "No live document source",
    );
    assert.equal(
      sourceStatusLabelForReview(buildSourceBlockIndex(), 0),
      "Up to date",
    );
    assert.equal(
      sourceStatusLabelForReview(buildSourceBlockIndex(), 2),
      "2 source issues",
    );
  });

  test("refreshes source review items and preserves controller status", () => {
    const hookRenderer = createServerRenderHarness();
    const sourceBlockIndex = buildSourceBlockIndex();
    let currentDeck = buildSourceLinkedDeck();
    let activeSlideIndex = 0;
    let selection = createSelectionState("normal");
    let announcement = "";

    const setSelection: Dispatch<SetStateAction<SelectionState>> = (next) => {
      selection = applySelectionUpdate(selection, next);
    };
    const renderController = () =>
      hookRenderer.run(() =>
        useSourceReviewController({
          documentId: "doc-1",
          documentBlocks: [],
          sourceBlockIndex,
          deck: currentDeck,
          activeSlide: currentDeck.slides[activeSlideIndex],
          selectedNode: undefined,
          onDeckChange: (deck) => {
            currentDeck = deck;
          },
          setActiveSlideIndex: (index) => {
            activeSlideIndex = index;
          },
          setSelection,
          focusSelectedNodeSoon: () => undefined,
          openInspectorPanel: () => undefined,
          setSourceMenuOpen: () => undefined,
          setStageAnnouncement: (message) => {
            announcement = message;
          },
        }),
      );

    let controller = renderController();
    assert.deepEqual(
      controller.sourceReview.map((item) => `${item.nodeId}:${item.state}`),
      ["text-stale:stale", "text-orphan:orphan"],
    );

    controller.handleRefreshAllSources();

    assert.equal(
      textContent(currentDeck, "text-stale"),
      "Updated stale source copy",
    );
    assert.equal(textContent(currentDeck, "text-orphan"), "Needs relink");
    assert.match(announcement, /Refreshed 1 source links; skipped 1\./);

    controller = renderController();
    assert.match(
      controller.sourceReviewStatus,
      /Refreshed 1 source links; skipped 1\./,
    );
    assert.deepEqual(
      controller.sourceReview.map((item) => `${item.nodeId}:${item.state}`),
      ["text-orphan:orphan"],
    );
    assert.deepEqual(selectedNodeIds(selection), []);
  });

  test("review source links selects the first issue and opens the source inspector", () => {
    const hookRenderer = createServerRenderHarness();
    const sourceBlockIndex = buildSourceBlockIndex();
    let currentDeck = buildSourceLinkedDeck();
    let activeSlideIndex = 0;
    let selection = createSelectionState("normal");
    let focusedNodeId: string | undefined;
    let openedPanel: string | undefined;
    let sourceMenuOpen = true;

    const setSelection: Dispatch<SetStateAction<SelectionState>> = (next) => {
      selection = applySelectionUpdate(selection, next);
    };
    const renderController = () =>
      hookRenderer.run(() =>
        useSourceReviewController({
          documentId: "doc-1",
          documentBlocks: [],
          sourceBlockIndex,
          deck: currentDeck,
          activeSlide: currentDeck.slides[activeSlideIndex],
          selectedNode: undefined,
          onDeckChange: (deck) => {
            currentDeck = deck;
          },
          setActiveSlideIndex: (index) => {
            activeSlideIndex = index;
          },
          setSelection,
          focusSelectedNodeSoon: (nodeId) => {
            focusedNodeId = nodeId;
          },
          openInspectorPanel: (panel) => {
            openedPanel = panel;
          },
          setSourceMenuOpen: (open) => {
            sourceMenuOpen = open;
          },
          setStageAnnouncement: () => undefined,
        }),
      );

    renderController().handleReviewSourceLinks();

    assert.equal(activeSlideIndex, 0);
    assert.deepEqual(selectedNodeIds(selection), ["text-stale"]);
    assert.equal(focusedNodeId, "text-stale");
    assert.equal(openedPanel, "source");
    assert.equal(sourceMenuOpen, false);
  });
});
