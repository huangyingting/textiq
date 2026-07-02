import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ReactNode } from "react";

import type {
  SourceBlockIndex,
  SourceBlockIndexEntry,
} from "@/lib/presentation/block-index";
import type {
  DiagnosticAction,
  PresentationDiagnostic,
} from "@/lib/presentation/diagnostics";
import { findNodeById } from "@/lib/presentation/node-tree-ops";
import { diagnosticActionDescriptor } from "@/lib/presentation/review-action-descriptors";
import type { Deck } from "@/lib/presentation/schema";
import {
  buildDeck,
  buildSlide,
  buildTextContent,
  buildTextNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import {
  DeckDiagnosticsReview,
  type DeckDiagnosticsReviewProps,
} from "./deck-diagnostics-review";
import { SlideEditorFooter } from "./slide-editor-footer";
import { SlideEditor } from "./slide-editor";
import {
  SourceReviewPanel,
  type SourceReviewPanelProps,
} from "./source-review-panel";
import {
  collectElements,
  createHookRenderer,
  findRequiredElement,
  flattenText,
  withWindow,
} from "./slide-editor-failure-test-utils";

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

async function withEditorWindow<T>(run: () => Promise<T> | T): Promise<T> {
  return await withWindow(async () => {
    const windowWithMatchMedia =
      globalThis.window as typeof globalThis.window & {
        matchMedia: (query: string) => MediaQueryList;
      };
    windowWithMatchMedia.matchMedia = (query: string) =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
    return run();
  });
}

function textNode(deck: Deck, nodeId: string) {
  const node = findNodeById(deck.slides[0]?.children ?? [], nodeId);
  if (!node || node.type !== "text") {
    assert.fail(`Expected text node ${nodeId}.`);
  }
  return node;
}

function textContent(deck: Deck, nodeId: string): string {
  return textNode(deck, nodeId)
    .content.paragraphs.map((paragraph) => paragraph.text)
    .join("\n");
}

function sourcePanelProps(root: ReactNode): SourceReviewPanelProps {
  return findRequiredElement(
    root,
    (element) => element.type === SourceReviewPanel,
    "Expected source review panel.",
  ).props as unknown as SourceReviewPanelProps;
}

function diagnosticsReviewProps(root: ReactNode): DeckDiagnosticsReviewProps {
  return findRequiredElement(
    root,
    (element) => element.type === DeckDiagnosticsReview,
    "Expected deck diagnostics review.",
  ).props as unknown as DeckDiagnosticsReviewProps;
}

function clickDiagnosticsReview(root: ReactNode): void {
  const footer = findRequiredElement(
    root,
    (element) => element.type === SlideEditorFooter,
    "Expected editor footer.",
  );
  (
    footer.props as { onOpenDiagnosticsReview: () => void }
  ).onOpenDiagnosticsReview();
}

function diagnosticByCode(
  diagnostics: readonly PresentationDiagnostic[],
  code: PresentationDiagnostic["code"],
): PresentationDiagnostic {
  const diagnostic = diagnostics.find((item) => item.code === code);
  assert.ok(diagnostic, `Expected ${code} diagnostic.`);
  return diagnostic;
}

function requiredAction(diagnostic: PresentationDiagnostic): DiagnosticAction {
  assert.ok(diagnostic.action, `Expected ${diagnostic.code} action.`);
  return diagnostic.action;
}

describe("SlideEditor source diagnostics review failures", () => {
  test("routes Source Review refresh-all and relink actions through safe deck changes", async () => {
    await withEditorWindow(() => {
      const hookRenderer = createHookRenderer();
      const sourceBlockIndex = buildSourceBlockIndex();
      let currentDeck = buildSourceLinkedDeck();
      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditor({
            documentId: "doc-1",
            deck: currentDeck,
            sourceBlockIndex,
            onDeckChange: (nextDeck) => {
              currentDeck = nextDeck;
            },
          }),
        );

      let tree = renderTree();
      let panel = sourcePanelProps(tree);
      assert.deepEqual(
        panel.items.map((item) => `${item.nodeId}:${item.state}`),
        ["text-stale:stale", "text-orphan:orphan"],
      );

      panel.onRefreshAll();

      assert.equal(
        textContent(currentDeck, "text-stale"),
        "Updated stale source copy",
      );
      assert.equal(
        textNode(currentDeck, "text-stale").source?.refresh?.state,
        "fresh",
      );
      assert.equal(textContent(currentDeck, "text-orphan"), "Needs relink");

      tree = renderTree();
      panel = sourcePanelProps(tree);
      assert.match(
        panel.statusMessage ?? "",
        /Refreshed 1 source links; skipped 1\./,
      );
      assert.deepEqual(
        panel.items.map((item) => `${item.nodeId}:${item.state}`),
        ["text-orphan:orphan"],
      );

      panel.onRelink("slide-source", "text-orphan", RELINK_BLOCK);

      assert.equal(
        textContent(currentDeck, "text-orphan"),
        "Relinked source copy",
      );
      assert.equal(
        textNode(currentDeck, "text-orphan").source?.blockId,
        "block-relink",
      );
      assert.equal(
        textNode(currentDeck, "text-orphan").source?.refresh?.state,
        "fresh",
      );

      tree = renderTree();
      panel = sourcePanelProps(tree);
      assert.equal(panel.items.length, 0);
      assert.equal(panel.statusMessage, "Relinked node to Relink target.");
    });
  });

  test("routes source diagnostics review actions through Source Review repair flow", async () => {
    await withEditorWindow(() => {
      const hookRenderer = createHookRenderer();
      const sourceBlockIndex = buildSourceBlockIndex();
      let currentDeck = buildSourceLinkedDeck();
      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditor({
            documentId: "doc-1",
            deck: currentDeck,
            sourceBlockIndex,
            onDeckChange: (nextDeck) => {
              currentDeck = nextDeck;
            },
          }),
        );

      let tree = renderTree();
      clickDiagnosticsReview(tree);

      tree = renderTree();
      let review = diagnosticsReviewProps(tree);
      const staleDiagnostic = diagnosticByCode(
        review.diagnostics,
        "stale-source",
      );
      const orphanDiagnostic = diagnosticByCode(
        review.diagnostics,
        "orphaned-source",
      );
      const staleAction = requiredAction(staleDiagnostic);
      const orphanAction = requiredAction(orphanDiagnostic);
      const staleDescriptor = diagnosticActionDescriptor(staleAction);
      const orphanDescriptor = diagnosticActionDescriptor(orphanAction);

      assert.equal(staleAction.type, "refresh-source");
      assert.equal(staleDescriptor.repairEligibility, "source-review");
      assert.equal(staleDescriptor.safety, "safe");
      assert.equal(orphanAction.type, "relink-source");
      assert.equal(orphanDescriptor.repairEligibility, "source-review");
      assert.equal(orphanDescriptor.safety, "safe-destructive");

      review.onAction(staleAction, staleDiagnostic);

      assert.equal(
        textContent(currentDeck, "text-stale"),
        "Updated stale source copy",
      );

      tree = renderTree();
      assert.equal(
        collectElements(
          tree,
          (element) => element.type === DeckDiagnosticsReview,
        ).length,
        0,
        "Expected source refresh diagnostic action to close diagnostics review.",
      );

      clickDiagnosticsReview(tree);
      tree = renderTree();
      review = diagnosticsReviewProps(tree);
      const orphanAfterRefresh = diagnosticByCode(
        review.diagnostics,
        "orphaned-source",
      );
      review.onAction(requiredAction(orphanAfterRefresh), orphanAfterRefresh);

      tree = renderTree();
      assert.equal(textContent(currentDeck, "text-orphan"), "Needs relink");
      assert.equal(
        textNode(currentDeck, "text-orphan").source?.blockId,
        "missing-block",
      );
      assert.match(
        flattenText(tree),
        /Choose a source block to relink this node\./,
      );
      assert.equal(sourcePanelProps(tree).items[0]?.nodeId, "text-orphan");
    });
  });
});
