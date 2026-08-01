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
import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  createSelectionState,
  selectedNodeIds,
  type SelectionState,
} from "./selection-model";
import {
  createSourceReviewController,
  deriveSourceReviewControllerInputs,
  sourceStatusLabelForReview,
  type SourceReviewController,
  type UseSourceReviewControllerArgs,
  useSourceReviewController,
} from "./use-source-review-controller";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

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

function createControllerHarness(
  getArgs: () => UseSourceReviewControllerArgs,
): () => SourceReviewController {
  let sourceReviewStatus = "";
  const setSourceReviewStatus: Dispatch<SetStateAction<string>> = (next) => {
    sourceReviewStatus =
      typeof next === "function" ? next(sourceReviewStatus) : next;
  };

  return () => {
    const args = getArgs();
    return createSourceReviewController({
      ...args,
      ...deriveSourceReviewControllerInputs(args),
      sourceReviewStatus,
      setSourceReviewStatus,
    });
  };
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
    const sourceBlockIndex = buildSourceBlockIndex();
    let currentDeck = buildSourceLinkedDeck();
    let activeSlideIndex = 0;
    let selection = createSelectionState("normal");
    let announcement = "";

    const setSelection: Dispatch<SetStateAction<SelectionState>> = (next) => {
      selection = applySelectionUpdate(selection, next);
    };
    const renderController = createControllerHarness(() => ({
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
      setStageAnnouncement: (message) => {
        announcement = message;
      },
    }));

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
    const sourceBlockIndex = buildSourceBlockIndex();
    let currentDeck = buildSourceLinkedDeck();
    let activeSlideIndex = 0;
    let selection = createSelectionState("normal");
    let focusedNodeId: string | undefined;
    let openedPanel: string | undefined;

    const setSelection: Dispatch<SetStateAction<SelectionState>> = (next) => {
      selection = applySelectionUpdate(selection, next);
    };
    const renderController = createControllerHarness(() => ({
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
      setStageAnnouncement: () => undefined,
    }));

    renderController().handleReviewSourceLinks();

    assert.equal(activeSlideIndex, 0);
    assert.deepEqual(selectedNodeIds(selection), ["text-stale"]);
    assert.equal(focusedNodeId, "text-stale");
    assert.equal(openedPanel, "source");
  });

  test("unmounting invalidates a pending selected-source refresh before it mutates the deck", async () => {
    const deck = buildSourceLinkedDeck();
    const activeSlide = deck.slides[0];
    const selectedNode = activeSlide?.children[0];
    assert.ok(activeSlide);
    assert.ok(selectedNode?.source);
    if (!activeSlide || !selectedNode?.source) return;

    const refreshAttempt = deferred<{
      contentPatch: {
        paragraphs: Array<{ id: string; text: string }>;
      };
    }>();
    const changedDecks: Deck[] = [];
    const announcements: string[] = [];
    const renderer = createReactRenderHarness();
    const controller = renderer.run(() =>
      useSourceReviewController({
        documentId: "doc-1",
        documentBlocks: [],
        deck,
        activeSlide,
        selectedNode,
        onRefreshSource: () => refreshAttempt.promise,
        onDeckChange: (nextDeck) => changedDecks.push(nextDeck),
        setActiveSlideIndex: () => undefined,
        setSelection: () => undefined,
        focusSelectedNodeSoon: () => undefined,
        openInspectorPanel: () => undefined,
        setStageAnnouncement: (message) => announcements.push(message),
      }),
    );
    const settled = controller.handleRefreshSelectedSource();
    assert.deepEqual(changedDecks, []);

    renderer.cleanup();
    refreshAttempt.resolve({
      contentPatch: {
        paragraphs: [
          { id: "text-stale-source-p-1", text: "Late host refresh" },
        ],
      },
    });
    await settled;

    assert.deepEqual(changedDecks, []);
    assert.deepEqual(announcements, []);
  });

  test("selected-source refresh has one synchronous operation boundary and exposes pending state", async () => {
    const deck = buildSourceLinkedDeck();
    const activeSlide = deck.slides[0];
    const selectedNode = activeSlide?.children[0];
    assert.ok(activeSlide);
    assert.ok(selectedNode?.source);
    if (!activeSlide || !selectedNode?.source) return;

    const refreshAttempt = deferred<{
      contentPatch: {
        paragraphs: Array<{ id: string; text: string }>;
      };
    }>();
    let refreshCalls = 0;
    const changedDecks: Deck[] = [];
    const renderer = createReactRenderHarness();
    const renderController = () =>
      renderer.run(() =>
        useSourceReviewController({
          documentId: "doc-1",
          documentBlocks: [],
          deck,
          activeSlide,
          selectedNode,
          onRefreshSource: () => {
            refreshCalls += 1;
            return refreshAttempt.promise;
          },
          onDeckChange: (nextDeck) => changedDecks.push(nextDeck),
          setActiveSlideIndex: () => undefined,
          setSelection: () => undefined,
          focusSelectedNodeSoon: () => undefined,
          openInspectorPanel: () => undefined,
          setStageAnnouncement: () => undefined,
        }),
      );
    let controller = renderController();
    const first = controller.handleRefreshSelectedSource();
    const duplicate = controller.handleRefreshSelectedSource();

    assert.equal(refreshCalls, 1);
    controller = renderController();
    assert.equal(controller.sourceRefreshPending, true);

    refreshAttempt.resolve({
      contentPatch: {
        paragraphs: [
          { id: "text-stale-source-p-1", text: "Current host refresh" },
        ],
      },
    });
    await Promise.all([first, duplicate]);

    controller = renderController();
    assert.equal(controller.sourceRefreshPending, false);
    assert.equal(changedDecks.length, 1);
    renderer.cleanup();
  });

  test("a deck identity change invalidates the older selected-source refresh", async () => {
    const oldDeck = buildSourceLinkedDeck();
    const oldSlide = oldDeck.slides[0];
    const oldNode = oldSlide?.children[0];
    assert.ok(oldSlide);
    assert.ok(oldNode?.source);
    if (!oldSlide || !oldNode?.source) return;

    const refreshAttempt = deferred<{
      contentPatch: {
        paragraphs: Array<{ id: string; text: string }>;
      };
    }>();
    const changedDecks: Deck[] = [];
    const renderer = createReactRenderHarness();
    const renderController = (deck: Deck) => {
      const activeSlide = deck.slides[0];
      const selectedNode = activeSlide?.children[0];
      assert.ok(activeSlide);
      assert.ok(selectedNode?.source);
      if (!activeSlide || !selectedNode?.source) {
        throw new Error("Expected a source-linked node.");
      }
      return renderer.run(() =>
        useSourceReviewController({
          documentId: "doc-1",
          documentBlocks: [],
          deck,
          activeSlide,
          selectedNode,
          onRefreshSource: () => refreshAttempt.promise,
          onDeckChange: (nextDeck) => changedDecks.push(nextDeck),
          setActiveSlideIndex: () => undefined,
          setSelection: () => undefined,
          focusSelectedNodeSoon: () => undefined,
          openInspectorPanel: () => undefined,
          setStageAnnouncement: () => undefined,
        }),
      );
    };
    const oldController = renderController(oldDeck);
    const settled = oldController.handleRefreshSelectedSource();
    const replacementDeck = buildSourceLinkedDeck();
    const replacementController = renderController(replacementDeck);
    assert.equal(replacementController.sourceRefreshPending, false);

    refreshAttempt.resolve({
      contentPatch: {
        paragraphs: [
          { id: "text-stale-source-p-1", text: "Obsolete host refresh" },
        ],
      },
    });
    await settled;

    assert.deepEqual(changedDecks, []);
    renderer.cleanup();
  });

  test("selected-source refresh rejection resolves with generic recoverable feedback", async () => {
    const deck = buildSourceLinkedDeck();
    const activeSlide = deck.slides[0];
    const selectedNode = activeSlide?.children[0];
    assert.ok(activeSlide);
    assert.ok(selectedNode?.source);
    if (!activeSlide || !selectedNode?.source) return;

    const announcements: string[] = [];
    const renderer = createReactRenderHarness();
    const renderController = () =>
      renderer.run(() =>
        useSourceReviewController({
          documentId: "doc-1",
          documentBlocks: [],
          deck,
          activeSlide,
          selectedNode,
          onRefreshSource: async () => {
            throw new Error("private source adapter failure");
          },
          onDeckChange: () => undefined,
          setActiveSlideIndex: () => undefined,
          setSelection: () => undefined,
          focusSelectedNodeSoon: () => undefined,
          openInspectorPanel: () => undefined,
          setStageAnnouncement: (message) => announcements.push(message),
        }),
      );
    let controller = renderController();
    await controller.handleRefreshSelectedSource();
    controller = renderController();

    assert.equal(
      controller.sourceReviewStatus,
      "Could not refresh this source. Please try again.",
    );
    assert.deepEqual(announcements, [
      "Could not refresh this source. Please try again.",
    ]);
    assert.doesNotMatch(
      controller.sourceReviewStatus,
      /private source adapter failure/,
    );
    assert.equal(controller.sourceRefreshPending, false);
    renderer.cleanup();
  });
});
