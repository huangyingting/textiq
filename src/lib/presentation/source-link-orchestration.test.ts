import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildDeck,
  buildSlide,
  buildTextContent,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import type { SourceBlockIndex } from "./block-index";
import type { Deck, SlideChildNode } from "./schema";
import { classifyDeckSourceLinks, sourceReviewItems } from "./source-links";
import {
  dismissSourceReviewItem,
  refreshAllSourceReviewItems,
  refreshSelectedSourceLink,
  refreshSourceReviewItem,
  relinkSourceReviewItem,
  unlinkSourceReviewItem,
} from "./source-link-orchestration";

const NOW = "2026-06-30T10:00:00.000Z";

function sourceNode(
  id: string,
  source: NonNullable<SlideChildNode["source"]>,
  text = id,
): SlideChildNode {
  return buildTextNode({
    id,
    name: id,
    content: buildTextContent([text]),
    source,
  });
}

function index(): SourceBlockIndex {
  return {
    documentId: "doc-1",
    blocks: [
      {
        documentId: "doc-1",
        id: "block-fresh",
        kind: "text",
        hash: "hash-fresh",
        displayLabel: "Fresh block",
        refresh: { kind: "text", text: "Fresh block" },
      },
      {
        documentId: "doc-1",
        id: "block-stale",
        kind: "text",
        hash: "hash-new",
        displayLabel: "Updated block",
        refresh: {
          kind: "text",
          text: "Updated block",
        },
      },
      {
        documentId: "doc-1",
        id: "block-table",
        kind: "table",
        hash: "hash-table",
        displayLabel: "Table block",
        refresh: {
          kind: "table",
          columns: [{ id: "c1", label: "Metric" }],
          rows: [{ id: "r1", cells: [{ text: "ARR" }] }],
        },
      },
    ],
  };
}

function deckWithSourceIssues(): Deck {
  return buildDeck([
    buildSlide(
      "content",
      [
        sourceNode("stale-node", {
          documentId: "doc-1",
          blockId: "block-stale",
          blockKind: "text",
          contentHash: "hash-old",
        }),
        sourceNode("orphan-node", {
          documentId: "doc-1",
          blockId: "missing-block",
          blockKind: "text",
          contentHash: "hash-missing",
        }),
        sourceNode("remote-node", {
          documentId: "doc-2",
          blockId: "block-stale",
          blockKind: "text",
          contentHash: "hash-old",
        }),
      ],
      { id: "slide-1", name: "Overview" },
    ),
  ]);
}

function sourceNodeById(
  deck: Deck,
  nodeId: string,
): SlideChildNode | undefined {
  return deck.slides[0]?.children.find((node) => node.id === nodeId);
}

describe("source-link-orchestration", () => {
  test("refreshSelectedSourceLink refreshes stale selected nodes from source index", async () => {
    const deck = deckWithSourceIssues();
    const slide = deck.slides[0];
    const node = sourceNodeById(deck, "stale-node");
    assert.ok(slide);
    assert.ok(node);
    if (!slide || !node) return;

    let fallbackCalled = false;
    const result = await refreshSelectedSourceLink({
      deck,
      slide,
      node,
      now: NOW,
      sourceBlockIndex: index(),
      onRefreshSource: async () => {
        fallbackCalled = true;
        return undefined;
      },
    });

    assert.equal(fallbackCalled, false);
    assert.equal(result?.statusMessage, "Refreshed source-linked node.");
    assert.deepEqual(result?.selection, {
      slideId: "slide-1",
      nodeId: "stale-node",
    });
    const refreshedNode = sourceNodeById(result?.deck ?? deck, "stale-node");
    assert.equal(
      refreshedNode?.type === "text"
        ? refreshedNode.content.paragraphs[0]?.text
        : "",
      "Updated block",
    );
  });

  test("refreshSelectedSourceLink applies host callback patches when no source index is available", async () => {
    const deck = deckWithSourceIssues();
    const slide = deck.slides[0];
    const node = sourceNodeById(deck, "stale-node");
    assert.ok(slide);
    assert.ok(node?.source);
    if (!slide || !node?.source) return;

    const result = await refreshSelectedSourceLink({
      deck,
      slide,
      node,
      now: NOW,
      onRefreshSource: async () => ({
        contentPatch: {
          paragraphs: [
            { id: "stale-node-source-p-1", text: "Host refreshed text" },
          ],
        },
        source: {
          ...node.source,
          contentHash: "hash-host",
        },
      }),
    });

    const refreshedNode = sourceNodeById(result?.deck ?? deck, "stale-node");
    assert.equal(
      refreshedNode?.type === "text"
        ? refreshedNode.content.paragraphs[0]?.text
        : "",
      "Host refreshed text",
    );
    assert.equal(refreshedNode?.source?.contentHash, "hash-host");
    assert.deepEqual(result?.selection, {
      slideId: "slide-1",
      nodeId: "stale-node",
    });
    assert.equal(result?.statusMessage, undefined);
  });

  test("refreshSourceReviewItem records skip reasons and marks source state unknown", () => {
    const deck = buildDeck([
      buildSlide("content", [
        sourceNode("text-linked-to-table", {
          documentId: "doc-1",
          blockId: "block-table",
          blockKind: "table",
          contentHash: "hash-old",
        }),
      ]),
    ]);
    const result = refreshSourceReviewItem({
      deck,
      sourceBlockIndex: index(),
      slideId: deck.slides[0].id,
      nodeId: "text-linked-to-table",
      now: NOW,
    });

    assert.equal(
      result.statusMessage,
      "Skipped source refresh: Table source can refresh only table nodes.",
    );
    const node = sourceNodeById(result.deck ?? deck, "text-linked-to-table");
    assert.equal(node?.source?.refresh?.state, "unknown");
  });

  test("relinkSourceReviewItem returns selection and status for success, and status-only for skip", () => {
    const success = relinkSourceReviewItem({
      deck: deckWithSourceIssues(),
      slideId: "slide-1",
      nodeId: "orphan-node",
      block: index().blocks[0],
      now: NOW,
    });
    assert.equal(success.statusMessage, "Relinked node to Fresh block.");
    assert.deepEqual(success.selection, {
      slideId: "slide-1",
      nodeId: "orphan-node",
    });
    assert.equal(
      sourceNodeById(success.deck ?? deckWithSourceIssues(), "orphan-node")
        ?.source?.blockId,
      "block-fresh",
    );

    const skipDeck = buildDeck([
      buildSlide("content", [
        sourceNode("text-node", {
          documentId: "doc-1",
          blockId: "block-fresh",
          blockKind: "text",
          contentHash: "hash-fresh",
        }),
      ]),
    ]);
    const skip = relinkSourceReviewItem({
      deck: skipDeck,
      slideId: skipDeck.slides[0].id,
      nodeId: "text-node",
      block: index().blocks[2],
      now: NOW,
    });
    assert.equal(
      skip.statusMessage,
      "Skipped relink: Table source can refresh only table nodes.",
    );
    assert.equal(skip.deck, undefined);
    assert.equal(skip.selection, undefined);
  });

  test("unlinkSourceReviewItem and dismissSourceReviewItem keep orchestration metadata aligned", () => {
    const unlinked = unlinkSourceReviewItem({
      deck: deckWithSourceIssues(),
      slideId: "slide-1",
      nodeId: "stale-node",
      now: NOW,
    });
    assert.equal(unlinked.statusMessage, "Marked source link as unlinked.");
    assert.equal(
      sourceNodeById(unlinked.deck ?? deckWithSourceIssues(), "stale-node")
        ?.source?.unlinked,
      true,
    );

    const dismissed = dismissSourceReviewItem({
      deck: deckWithSourceIssues(),
      sourceBlockIndex: index(),
      slideId: "slide-1",
      nodeId: "stale-node",
      now: NOW,
    });
    assert.equal(dismissed.statusMessage, "Dismissed source review item.");
    const classifications = classifyDeckSourceLinks(
      dismissed.deck ?? deckWithSourceIssues(),
      index(),
    );
    assert.equal(
      sourceReviewItems(
        dismissed.deck ?? deckWithSourceIssues(),
        classifications,
      ).some((item) => item.nodeId === "stale-node"),
      false,
    );
  });

  test("refreshAllSourceReviewItems builds status summaries with skip details", () => {
    const result = refreshAllSourceReviewItems({
      deck: deckWithSourceIssues(),
      sourceBlockIndex: index(),
      now: NOW,
    });

    assert.equal(
      result.statusMessage,
      "Refreshed 1 source links; skipped 2. Skipped: orphan-node — Source block is missing from the current document.; remote-node — Source belongs to a different document and requires explicit remote resolution.",
    );
    assert.equal(result.announcement, result.statusMessage);
  });
});
