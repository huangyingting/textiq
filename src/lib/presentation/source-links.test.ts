import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildDeck,
  buildImageNode,
  buildSlide,
  buildTableNode,
  buildTextContent,
  buildTextNode,
  buildVisualNode,
} from "@/test/builders/presentation-deck";
import type { SourceBlockIndex } from "./block-index";
import type { Deck, SlideChildNode } from "./schema";
import {
  classifyDeckSourceLinks,
  deriveSourceReviewDerivations,
  dismissNodeSourceIssue,
  refreshAllSafeSourceLinks,
  refreshNodeSource,
  relinkNodeSource,
  sourceLinkDiagnostics,
  sourceReviewItems,
  unlinkNodeSource,
} from "./source-links";

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

function groupNode(node: unknown): SlideChildNode {
  return node as unknown as SlideChildNode;
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
          runs: [{ text: "Updated block", bold: true }],
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
          caption: "Metrics",
        },
      },
    ],
  };
}

function deckWithSources(): Deck {
  return buildDeck([
    buildSlide(
      "content",
      [
        sourceNode("fresh-node", {
          documentId: "doc-1",
          blockId: "block-fresh",
          blockKind: "text",
          contentHash: "hash-fresh",
        }),
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
        sourceNode("unlinked-node", {
          documentId: "doc-1",
          blockId: "block-stale",
          blockKind: "text",
          contentHash: "hash-old",
          unlinked: true,
        }),
      ],
      { id: "slide-1", name: "Overview" },
    ),
  ]);
}

describe("presentation source link classification", () => {
  test("classifies fresh, stale, orphan, unknown, and unlinked states", () => {
    const classifications = classifyDeckSourceLinks(deckWithSources(), index());

    assert.deepEqual(
      classifications.map((item) => [item.nodeId, item.state]),
      [
        ["fresh-node", "fresh"],
        ["stale-node", "stale"],
        ["orphan-node", "orphan"],
        ["remote-node", "unknown"],
        ["unlinked-node", "unlinked"],
      ],
    );
    assert.match(
      classifications.find((item) => item.nodeId === "remote-node")?.reason ??
        "",
      /different document/,
    );
  });

  test("classifies nested group sources and incomplete metadata", () => {
    const nested = sourceNode("nested-stale", {
      documentId: "doc-1",
      blockId: "block-stale",
      blockKind: "text",
      contentHash: "hash-old",
    });
    const incomplete = sourceNode("incomplete-source", {
      documentId: "doc-1",
      blockKind: "text",
    } as NonNullable<SlideChildNode["source"]>);
    const group = groupNode({
      id: "group-1",
      type: "group",
      component: "custom",
      layout: { frame: { x: 0, y: 0, w: 50, h: 50 }, zIndex: 1 },
      style: { ref: "surface.card" },
      children: [nested, incomplete],
    });
    const deck = buildDeck([
      buildSlide("content", [group], { id: "slide-group" }),
    ]);

    const classifications = classifyDeckSourceLinks(deck, index());

    assert.deepEqual(
      classifications.map((item) => [item.nodeId, item.state]),
      [
        ["nested-stale", "stale"],
        ["incomplete-source", "unknown"],
      ],
    );
    assert.match(classifications[1]?.reason ?? "", /missing a document id/);
  });

  test("emits source diagnostics only for non-fresh links", () => {
    const diagnostics = sourceLinkDiagnostics(
      classifyDeckSourceLinks(deckWithSources(), index()),
    );

    assert.deepEqual(
      diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.nodeId]),
      [
        ["stale-source", "stale-node"],
        ["orphaned-source", "orphan-node"],
        ["source-refresh-failed", "remote-node"],
      ],
    );
    assert.deepEqual(
      diagnostics.map((diagnostic) => [
        diagnostic.category,
        diagnostic.target.scope,
        diagnostic.action?.type,
      ]),
      [
        ["source", "source", "refresh-source"],
        ["source", "source", "relink-source"],
        ["source", "source", "open-source-review"],
      ],
    );
    const staleAction = diagnostics[0]?.action;
    assert.equal(staleAction?.type, "refresh-source");
    assert.deepEqual(
      staleAction && "payload" in staleAction ? staleAction.payload : undefined,
      {
        documentId: "doc-1",
        blockId: "block-stale",
      },
    );
    assert.equal(
      diagnostics.some((diagnostic) => diagnostic.nodeId === "fresh-node"),
      false,
    );
  });

  test("groups deck review rows by slide identity and source state", () => {
    const items = sourceReviewItems(
      deckWithSources(),
      classifyDeckSourceLinks(deckWithSources(), index()),
    );

    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((item) => [item.slideLabel, item.nodeId, item.state]),
      [
        ["Overview", "stale-node", "stale"],
        ["Overview", "orphan-node", "orphan"],
        ["Overview", "remote-node", "unknown"],
      ],
    );
  });

  test("memoizes source review derivations by deck and index identity", () => {
    const deck = deckWithSources();
    const sourceIndex = index();
    const first = deriveSourceReviewDerivations(deck, sourceIndex);
    const second = deriveSourceReviewDerivations(deck, sourceIndex);

    assert.equal(first, second);
    assert.deepEqual(
      first.reviewItems,
      sourceReviewItems(deck, classifyDeckSourceLinks(deck, sourceIndex)),
    );
    assert.deepEqual(
      first.diagnostics,
      sourceLinkDiagnostics(first.classifications),
    );
  });

  test("falls back to slide and source metadata when building review rows", () => {
    const classifications = classifyDeckSourceLinks(
      buildDeck([
        buildSlide(
          "content",
          [
            sourceNode("missing-label", {
              documentId: "doc-1",
              blockId: "missing-source",
              blockKind: "text",
              contentHash: "missing-hash",
            }),
          ],
          { id: "slide-without-name", name: undefined },
        ),
      ]),
      index(),
    );

    const [item] = sourceReviewItems(
      buildDeck([buildSlide("content", [], { id: "different-slide" })]),
      classifications,
    );

    assert.equal(item?.slideLabel, "Slide 1");
    assert.equal(item?.sourceLabel, "missing-source");
  });

  test("source diagnostics use empty payloads for incomplete metadata", () => {
    const deck = buildDeck([
      buildSlide("content", [
        sourceNode("incomplete-source", {
          documentId: "doc-1",
          blockKind: "text",
        } as NonNullable<SlideChildNode["source"]>),
      ]),
    ]);
    const diagnostics = sourceLinkDiagnostics(
      classifyDeckSourceLinks(deck, index()),
    );
    const action = diagnostics[0]?.action;

    assert.equal(diagnostics[0]?.code, "source-refresh-failed");
    assert.deepEqual(
      action && "payload" in action ? action.payload : undefined,
      { documentId: "doc-1" },
    );
    assert.equal(diagnostics[0]?.details?.blockId, "");
  });
});

describe("presentation source link commands", () => {
  test("refreshes a stale selected node from the matching block", () => {
    const result = refreshNodeSource(
      deckWithSources(),
      "slide-1",
      "stale-node",
      index(),
      NOW,
    );

    assert.equal(result.status, "refreshed");
    if (result.status !== "refreshed") return;
    const node = result.deck.slides[0].children.find(
      (candidate) => candidate.id === "stale-node",
    );
    assert.equal(node?.type, "text");
    if (node?.type === "text") {
      assert.equal(node.content.paragraphs[0].text, "Updated block");
      assert.equal(node.content.paragraphs[0].runs?.[0].bold, true);
      assert.equal(node.source?.contentHash, "hash-new");
      assert.equal(node.source?.refresh?.state, "fresh");
    }
  });

  test("refreshes compatible text, table, visual, and image source payloads", () => {
    const richIndex: SourceBlockIndex = {
      documentId: "doc-1",
      blocks: [
        {
          documentId: "doc-1",
          id: "text-block",
          kind: "text",
          hash: "text-hash",
          revision: "rev-1",
          displayLabel: "Callout text",
          refresh: { kind: "text", text: "Updated callout" },
        },
        {
          documentId: "doc-1",
          id: "table-block",
          kind: "table",
          hash: "table-hash",
          displayLabel: "Metrics",
          refresh: {
            kind: "table",
            columns: [{ id: "metric", label: "Metric" }],
            rows: [{ id: "row", cells: [{ text: "ARR" }] }],
            caption: "Updated metrics",
          },
        },
        {
          documentId: "doc-1",
          id: "visual-block",
          kind: "visual",
          hash: "visual-hash",
          displayLabel: "Chart",
          refresh: { kind: "visual", visualId: "visual-new", alt: "Chart alt" },
        },
        {
          documentId: "doc-1",
          id: "image-block",
          kind: "image",
          hash: "image-hash",
          displayLabel: "Hero",
          refresh: { kind: "image", assetId: "asset-new", alt: "Hero alt" },
        },
      ],
    };
    const text = buildTextNode({
      id: "text-node",
      content: buildTextContent(["Old callout"]),
      source: {
        documentId: "doc-1",
        blockId: "text-block",
        blockKind: "text",
        contentHash: "old-text",
      },
    });
    const table = buildTableNode({
      id: "table-node",
      source: {
        documentId: "doc-1",
        blockId: "table-block",
        blockKind: "table",
        contentHash: "old-table",
      },
    });
    const visual = buildVisualNode({
      id: "visual-node",
      source: {
        documentId: "doc-1",
        blockId: "visual-block",
        blockKind: "visual",
        contentHash: "old-visual",
      },
    });
    const image = buildImageNode("asset-old", {
      id: "image-node",
      source: {
        documentId: "doc-1",
        blockId: "image-block",
        blockKind: "image",
        contentHash: "old-image",
      },
    });
    let deck = buildDeck([
      buildSlide("content", [text, table, visual, image], {
        id: "slide-rich",
      }),
    ]);

    for (const nodeId of [
      "text-node",
      "table-node",
      "visual-node",
      "image-node",
    ]) {
      const result = refreshNodeSource(
        deck,
        "slide-rich",
        nodeId,
        richIndex,
        NOW,
      );
      assert.equal(result.status, "refreshed");
      if (result.status === "refreshed") deck = result.deck;
    }

    const byId = Object.fromEntries(
      deck.slides[0].children.map((node) => [node.id, node]),
    );
    const refreshedText = byId["text-node"];
    assert.equal(
      refreshedText?.type === "text"
        ? refreshedText.content.paragraphs[0]?.text
        : "",
      "Updated callout",
    );
    assert.equal(refreshedText?.source?.blockRevision, "rev-1");
    const refreshedTable = byId["table-node"];
    assert.equal(
      refreshedTable?.type === "table"
        ? refreshedTable.content.caption
        : undefined,
      "Updated metrics",
    );
    const refreshedVisual = byId["visual-node"];
    assert.equal(
      refreshedVisual?.type === "visual"
        ? refreshedVisual.content.visualId
        : "",
      "visual-new",
    );
    assert.equal(
      refreshedVisual?.type === "visual" ? refreshedVisual.content.alt : "",
      "Chart alt",
    );
    const refreshedImage = byId["image-node"];
    assert.equal(
      refreshedImage?.type === "image" ? refreshedImage.content.assetId : "",
      "asset-new",
    );
    assert.equal(
      refreshedImage?.type === "image" ? refreshedImage.content.alt : "",
      "Hero alt",
    );
  });

  test("refreshNodeSource updates matching nodes nested inside groups", () => {
    const nested = sourceNode("nested-stale", {
      documentId: "doc-1",
      blockId: "block-stale",
      blockKind: "text",
      contentHash: "hash-old",
    });
    const group = groupNode({
      id: "group-1",
      type: "group",
      component: "custom",
      layout: { frame: { x: 0, y: 0, w: 50, h: 50 }, zIndex: 1 },
      style: { ref: "surface.card" },
      children: [nested],
    });
    const deck = buildDeck([
      buildSlide("content", [group], { id: "slide-group" }),
    ]);

    const result = refreshNodeSource(
      deck,
      "slide-group",
      "nested-stale",
      index(),
      NOW,
    );

    assert.equal(result.status, "refreshed");
    if (result.status !== "refreshed") return;
    const updatedGroup = result.deck.slides[0].children[0];
    assert.equal(updatedGroup.type, "group");
    if (updatedGroup.type !== "group") return;
    const updatedNode = updatedGroup.children[0];
    assert.equal(
      updatedNode?.type === "text"
        ? updatedNode.content.paragraphs[0]?.text
        : "",
      "Updated block",
    );
  });

  test("refreshNodeSource explains missing, unlinked, remote, and absent sources", () => {
    const deck = deckWithSources();
    const plainDeck = buildDeck([
      buildSlide("content", [buildTextNode({ id: "plain-node" })], {
        id: "plain-slide",
      }),
    ]);

    const cases = [
      refreshNodeSource(plainDeck, "plain-slide", "plain-node", index(), NOW),
      refreshNodeSource(deck, "slide-1", "unlinked-node", index(), NOW),
      refreshNodeSource(deck, "slide-1", "remote-node", index(), NOW),
      refreshNodeSource(deck, "slide-1", "orphan-node", index(), NOW),
    ];

    assert.deepEqual(
      cases.map((result) =>
        result.status === "skipped" ? result.reason : "refreshed",
      ),
      [
        "Node has no source metadata.",
        "Node is explicitly unlinked.",
        "Cross-document source requires explicit remote resolution.",
        "Source block is missing.",
      ],
    );
  });

  test("marks a node unlinked without deleting content", () => {
    const updated = unlinkNodeSource(
      deckWithSources(),
      "slide-1",
      "stale-node",
      NOW,
    );
    const node = updated.slides[0].children.find(
      (candidate) => candidate.id === "stale-node",
    );

    assert.equal(node?.source?.unlinked, true);
    assert.equal(node?.source?.refresh?.state, "unlinked");
    assert.equal(
      node?.type === "text" ? node.content.paragraphs[0].text : "",
      "stale-node",
    );
  });

  test("relinks only to an explicit reviewed block", () => {
    const target = index().blocks[0];
    const result = relinkNodeSource(
      deckWithSources(),
      "slide-1",
      "orphan-node",
      target,
      NOW,
    );

    assert.equal(result.status, "refreshed");
    if (result.status !== "refreshed") return;
    const node = result.deck.slides[0].children.find(
      (candidate) => candidate.id === "orphan-node",
    );
    assert.equal(node?.source?.blockId, "block-fresh");
    assert.equal(node?.source?.contentHash, "hash-fresh");
  });

  test("refresh all updates safe stale links and skips risky items", () => {
    const result = refreshAllSafeSourceLinks(deckWithSources(), index(), NOW);

    assert.deepEqual(
      result.refreshed.map((item) => item.nodeId),
      ["stale-node"],
    );
    assert.deepEqual(
      result.skipped.map(({ item }) => item.nodeId),
      ["orphan-node", "remote-node"],
    );
    const refreshed = result.deck.slides[0].children.find(
      (candidate) => candidate.id === "stale-node",
    );
    assert.equal(refreshed?.source?.refresh?.state, "fresh");
  });

  test("safe refresh skips incompatible source payloads without marking them fresh", () => {
    const deck = buildDeck([
      buildSlide("content", [
        sourceNode("text-linked-to-table", {
          documentId: "doc-1",
          blockId: "block-table",
          blockKind: "table",
          contentHash: "old-table-hash",
        }),
      ]),
    ]);

    const result = refreshNodeSource(
      deck,
      deck.slides[0].id,
      "text-linked-to-table",
      index(),
      NOW,
    );

    assert.equal(result.status, "skipped");
    const node = result.deck.slides[0].children[0];
    assert.equal(node.source?.contentHash, "old-table-hash");
    assert.equal(node.source?.refresh?.state, "unknown");
  });

  test("safe refresh all skips ambiguous matching blocks with a visible reason", () => {
    const ambiguousIndex: SourceBlockIndex = {
      documentId: "doc-1",
      blocks: [
        ...index().blocks,
        {
          documentId: "doc-1",
          id: "block-stale",
          kind: "text",
          hash: "hash-other",
          displayLabel: "Duplicate block",
          refresh: { kind: "text", text: "Duplicate block" },
        },
      ],
    };

    const result = refreshAllSafeSourceLinks(
      deckWithSources(),
      ambiguousIndex,
      NOW,
    );

    assert.deepEqual(
      result.refreshed.map((item) => item.nodeId),
      [],
    );
    assert.ok(
      result.skipped.some(
        ({ item, reason }) =>
          item.nodeId === "stale-node" && /Multiple source blocks/.test(reason),
      ),
    );
    const stale = result.deck.slides[0].children.find(
      (candidate) => candidate.id === "stale-node",
    );
    assert.equal(stale?.source?.contentHash, "hash-old");
  });

  test("dismisses one source review item without changing content", () => {
    const dismissed = dismissNodeSourceIssue(
      deckWithSources(),
      "slide-1",
      "stale-node",
      index(),
      NOW,
    );
    const classifications = classifyDeckSourceLinks(dismissed, index());
    const stale = classifications.find((item) => item.nodeId === "stale-node");

    assert.equal(stale?.dismissed, true);
    assert.deepEqual(
      sourceReviewItems(dismissed, classifications).map((item) => item.nodeId),
      ["orphan-node", "remote-node"],
    );
    assert.equal(
      sourceLinkDiagnostics(classifications).some(
        (diagnostic) => diagnostic.nodeId === "stale-node",
      ),
      false,
    );
    const node = dismissed.slides[0].children.find(
      (candidate) => candidate.id === "stale-node",
    );
    assert.equal(
      node?.type === "text" ? node.content.paragraphs[0].text : "",
      "stale-node",
    );
    const bulk = refreshAllSafeSourceLinks(dismissed, index(), NOW);
    assert.deepEqual(
      bulk.refreshed.map((item) => item.nodeId),
      [],
    );
  });

  test("requires an explicit reviewed document change for cross-document relink", () => {
    const target = index().blocks[0];
    const rejected = relinkNodeSource(
      deckWithSources(),
      "slide-1",
      "remote-node",
      target,
      NOW,
    );
    assert.equal(rejected.status, "skipped");
    assert.match(
      rejected.status === "skipped" ? rejected.reason : "",
      /Cross-document relink/,
    );

    const accepted = relinkNodeSource(
      deckWithSources(),
      "slide-1",
      "remote-node",
      target,
      NOW,
      { allowDocumentChange: true },
    );

    assert.equal(accepted.status, "refreshed");
    if (accepted.status !== "refreshed") return;
    const node = accepted.deck.slides[0].children.find(
      (candidate) => candidate.id === "remote-node",
    );
    assert.equal(node?.source?.documentId, "doc-1");
    assert.equal(node?.source?.blockId, "block-fresh");
  });
});
