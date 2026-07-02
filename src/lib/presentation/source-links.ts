import type { PresentationDiagnostic } from "./diagnostics";
import { makeDiagnostic } from "./diagnostics";
import type {
  Deck,
  NodeSourceMetadata,
  Paragraph,
  SlideChildNode,
  SlideNode,
  SourceRefreshState,
  TableContent,
} from "./schema";
import {
  type SourceBlockIndex,
  type SourceBlockIndexEntry,
} from "./block-index";
import {
  buildSourceReviewDismissalExtra,
  readSourceReviewDismissalFromExtra,
  withSourceReviewDismissalExtra,
  type SourceReviewDismissalExtra,
} from "./provenance-extra";

export type SourceLinkClassification = {
  slideId: string;
  slideIndex: number;
  nodeId: string;
  nodeType: SlideChildNode["type"];
  nodeName?: string;
  source: NodeSourceMetadata;
  state: SourceRefreshState;
  reason: string;
  block?: SourceBlockIndexEntry;
  sourceHash?: string;
  currentHash?: string;
  dismissed?: boolean;
};

export type SourceReviewItem = SourceLinkClassification & {
  slideLabel: string;
  sourceLabel: string;
};

export type SourceReviewDerivations = {
  classifications: readonly SourceLinkClassification[];
  diagnostics: readonly PresentationDiagnostic[];
  reviewItems: readonly SourceReviewItem[];
};

export type SourceRefreshResult =
  | { status: "refreshed"; deck: Deck; nodeId: string; slideId: string }
  | {
      status: "skipped";
      deck: Deck;
      nodeId: string;
      slideId: string;
      reason: string;
    };

export type SourceRefreshAllResult = {
  deck: Deck;
  refreshed: SourceLinkClassification[];
  skipped: { item: SourceLinkClassification; reason: string }[];
};

type SourceBlockResolution =
  | { status: "found"; block: SourceBlockIndexEntry }
  | { status: "missing" }
  | { status: "ambiguous"; matches: SourceBlockIndexEntry[] };

const EMPTY_SOURCE_REVIEW_DERIVATIONS: SourceReviewDerivations = {
  classifications: [],
  diagnostics: [],
  reviewItems: [],
};

const SOURCE_REVIEW_DERIVATIONS_CACHE = new WeakMap<
  Deck,
  WeakMap<SourceBlockIndex, SourceReviewDerivations>
>();

function mapSlides(deck: Deck, fn: (slide: SlideNode) => SlideNode): Deck {
  return { ...deck, slides: deck.slides.map(fn) };
}

function mapNodeById(
  node: SlideChildNode,
  nodeId: string,
  fn: (node: SlideChildNode) => SlideChildNode,
): SlideChildNode {
  if (node.id === nodeId) return fn(node);
  if (node.type === "group") {
    return {
      ...node,
      children: node.children.map((child) => mapNodeById(child, nodeId, fn)),
    };
  }
  return node;
}

function findNodeById(
  nodes: readonly SlideChildNode[],
  nodeId: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.type === "group") {
      const nested = findNodeById(node.children, nodeId);
      if (nested) return nested;
    }
  }
  return undefined;
}

function collectNodes(
  nodes: readonly SlideChildNode[],
  result: SlideChildNode[],
): void {
  for (const node of nodes) {
    result.push(node);
    if (node.type === "group") collectNodes(node.children, result);
  }
}

function sourceWithRefresh(
  source: NodeSourceMetadata,
  state: SourceRefreshState,
  checkedAt: string,
  reason: string,
  block?: SourceBlockIndexEntry,
): NodeSourceMetadata {
  return {
    ...source,
    ...(block
      ? {
          ...(state === "fresh"
            ? {
                blockKind: block.kind,
                contentHash: block.hash,
                ...(block.revision ? { blockRevision: block.revision } : {}),
              }
            : {}),
          display: {
            ...(source.display ?? {}),
            blockLabel: block.displayLabel,
          },
        }
      : {}),
    refresh: {
      state,
      checkedAt,
      ...(state === "fresh" ? { refreshedAt: checkedAt } : {}),
      ...(block ? { sourceHash: block.hash } : {}),
      reason,
    },
  };
}

function matchingSourceBlocks(
  index: SourceBlockIndex,
  source: Pick<NodeSourceMetadata, "blockId" | "blockKind">,
): SourceBlockIndexEntry[] {
  if (!source.blockId) return [];
  return index.blocks.filter(
    (block) =>
      block.id === source.blockId &&
      (source.blockKind === undefined || block.kind === source.blockKind),
  );
}

function resolveSourceBlock(
  index: SourceBlockIndex,
  source: Pick<NodeSourceMetadata, "blockId" | "blockKind">,
): SourceBlockResolution {
  const matches = matchingSourceBlocks(index, source);
  if (matches.length === 0) return { status: "missing" };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "found", block: matches[0] };
}

function sourceReviewDismissal(
  source: NodeSourceMetadata,
): SourceReviewDismissalExtra | undefined {
  return readSourceReviewDismissalFromExtra(source.extra);
}

function dismissalMatchesSource(
  source: NodeSourceMetadata,
  block?: SourceBlockIndexEntry,
): boolean {
  const dismissal = sourceReviewDismissal(source);
  if (!dismissal) return false;
  if (
    dismissal.documentId &&
    source.documentId &&
    dismissal.documentId !== source.documentId
  ) {
    return false;
  }
  if (
    dismissal.blockId &&
    source.blockId &&
    dismissal.blockId !== source.blockId
  ) {
    return false;
  }
  const observedHash = block?.hash ?? source.contentHash;
  return !(
    dismissal.currentHash &&
    observedHash &&
    dismissal.currentHash !== observedHash
  );
}

function withDismissal(
  classification: SourceLinkClassification,
): SourceLinkClassification {
  if (classification.state === "fresh" || classification.state === "unlinked") {
    return classification;
  }
  if (!dismissalMatchesSource(classification.source, classification.block)) {
    return classification;
  }
  return {
    ...classification,
    dismissed: true,
    reason: `Source review item was dismissed. ${classification.reason}`,
  };
}

export function classifyNodeSource(
  slide: SlideNode,
  slideIndex: number,
  node: SlideChildNode,
  index: SourceBlockIndex,
): SourceLinkClassification | undefined {
  const source = node.source;
  if (!source) return undefined;
  const base = {
    slideId: slide.id,
    slideIndex,
    nodeId: node.id,
    nodeType: node.type,
    ...(node.name ? { nodeName: node.name } : {}),
    source,
  };

  if (source.unlinked === true) {
    return withDismissal({
      ...base,
      state: "unlinked",
      reason: "Source dependency was explicitly unlinked.",
    });
  }
  if (!source.documentId || !source.blockId || !source.contentHash) {
    return withDismissal({
      ...base,
      state: "unknown",
      reason:
        "Source metadata is missing a document id, block id, or content hash.",
    });
  }
  if (source.documentId !== index.documentId) {
    return withDismissal({
      ...base,
      state: "unknown",
      reason:
        "Source belongs to a different document and requires explicit remote resolution.",
    });
  }

  const resolution = resolveSourceBlock(index, source);
  if (resolution.status === "ambiguous") {
    return withDismissal({
      ...base,
      state: "unknown",
      reason:
        "Multiple source blocks match this metadata; choose one explicitly before relinking.",
    });
  }
  if (resolution.status === "missing") {
    return withDismissal({
      ...base,
      state: "orphan",
      reason: "Source block is missing from the current document.",
    });
  }
  const block = resolution.block;
  if (block.hash !== source.contentHash) {
    return withDismissal({
      ...base,
      state: "stale",
      reason: "Source block content changed.",
      block,
      sourceHash: source.contentHash,
      currentHash: block.hash,
    });
  }
  return withDismissal({
    ...base,
    state: "fresh",
    reason: "Source block is current.",
    block,
    sourceHash: source.contentHash,
    currentHash: block.hash,
  });
}

export function classifyDeckSourceLinks(
  deck: Deck,
  index: SourceBlockIndex,
): SourceLinkClassification[] {
  const result: SourceLinkClassification[] = [];
  deck.slides.forEach((slide, slideIndex) => {
    const nodes: SlideChildNode[] = [];
    collectNodes(slide.children, nodes);
    for (const node of nodes) {
      const classification = classifyNodeSource(slide, slideIndex, node, index);
      if (classification) result.push(classification);
    }
  });
  return result;
}

export function sourceReviewItems(
  deck: Deck,
  classifications: readonly SourceLinkClassification[],
): SourceReviewItem[] {
  return classifications
    .filter(
      (item) =>
        item.state !== "fresh" &&
        item.state !== "unlinked" &&
        item.dismissed !== true,
    )
    .map((item) => {
      const slide = deck.slides.find(
        (candidate) => candidate.id === item.slideId,
      );
      return {
        ...item,
        slideLabel: slide?.name ?? `Slide ${item.slideIndex + 1}`,
        sourceLabel:
          item.block?.displayLabel ??
          item.source.display?.blockLabel ??
          item.source.blockId ??
          "Unknown source",
      };
    });
}

export function sourceLinkDiagnostics(
  classifications: readonly SourceLinkClassification[],
): PresentationDiagnostic[] {
  return classifications.flatMap((item): PresentationDiagnostic[] => {
    const details = {
      status: item.state,
      documentId: item.source.documentId ?? "",
      blockId: item.source.blockId ?? "",
      sourceBlockKind: item.source.blockKind ?? "",
      reason: item.reason,
    };
    const actionPayload = {
      ...(item.source.documentId ? { documentId: item.source.documentId } : {}),
      ...(item.source.blockId ? { blockId: item.source.blockId } : {}),
    };
    if (item.dismissed === true || item.state === "unlinked") {
      return [];
    }
    if (item.state === "stale") {
      return [
        makeDiagnostic(
          "stale-source",
          "warning",
          `Source link for node "${item.nodeName ?? item.nodeId}" is stale.`,
          {
            slideId: item.slideId,
            nodeId: item.nodeId,
            action: {
              type: "refresh-source",
              payload: actionPayload,
            },
            details,
          },
        ),
      ];
    }
    if (item.state === "orphan") {
      return [
        makeDiagnostic(
          "orphaned-source",
          "warning",
          `Source block "${item.source.blockId ?? "unknown"}" is missing.`,
          {
            slideId: item.slideId,
            nodeId: item.nodeId,
            action: {
              type: "relink-source",
              payload: actionPayload,
            },
            details,
          },
        ),
      ];
    }
    if (item.state === "unknown") {
      return [
        makeDiagnostic(
          "source-refresh-failed",
          "info",
          `Source link for node "${item.nodeName ?? item.nodeId}" needs review.`,
          {
            slideId: item.slideId,
            nodeId: item.nodeId,
            action: {
              type: "open-source-review",
              payload: actionPayload,
            },
            details,
          },
        ),
      ];
    }
    return [];
  });
}

export function deriveSourceReviewDerivations(
  deck: Deck,
  index: SourceBlockIndex | null | undefined,
): SourceReviewDerivations {
  if (!index) return EMPTY_SOURCE_REVIEW_DERIVATIONS;
  let deckCache = SOURCE_REVIEW_DERIVATIONS_CACHE.get(deck);
  if (!deckCache) {
    deckCache = new WeakMap<SourceBlockIndex, SourceReviewDerivations>();
    SOURCE_REVIEW_DERIVATIONS_CACHE.set(deck, deckCache);
  }
  const cached = deckCache.get(index);
  if (cached) return cached;

  const classifications = classifyDeckSourceLinks(deck, index);
  const derivations: SourceReviewDerivations = {
    classifications,
    diagnostics: sourceLinkDiagnostics(classifications),
    reviewItems: sourceReviewItems(deck, classifications),
  };
  deckCache.set(index, derivations);
  return derivations;
}

function paragraphFromEntry(
  nodeId: string,
  entry: SourceBlockIndexEntry,
): Paragraph | undefined {
  if (entry.refresh.kind !== "text") return undefined;
  return {
    id: `${nodeId}-source-p-1`,
    text: entry.refresh.text,
    ...(entry.refresh.runs && entry.refresh.runs.length > 0
      ? { runs: entry.refresh.runs }
      : {}),
  };
}

export function buildFreshNodeSourceMetadata(
  entry: SourceBlockIndexEntry,
  now: string,
  existing?: NodeSourceMetadata,
): NodeSourceMetadata {
  return {
    ...(existing ?? {}),
    documentId: entry.documentId,
    blockId: entry.id,
    blockKind: entry.kind,
    contentHash: entry.hash,
    ...(entry.revision ? { blockRevision: entry.revision } : {}),
    linkedAt: now,
    display: {
      ...(existing?.display ?? {}),
      blockLabel: entry.displayLabel,
    },
    refresh: {
      state: "fresh",
      checkedAt: now,
      refreshedAt: now,
      sourceHash: entry.hash,
      reason: "Source content refreshed from the current block index.",
    },
    unlinked: false,
  };
}

function refreshNodeFromEntry(
  node: SlideChildNode,
  entry: SourceBlockIndexEntry,
  now: string,
): { node: SlideChildNode; reason?: string } {
  if (entry.refresh.kind === "text") {
    const paragraph = paragraphFromEntry(node.id, entry);
    if (!paragraph)
      return { node, reason: "Text source payload is unavailable." };
    if (node.type === "text") {
      return {
        node: {
          ...node,
          content: { ...node.content, paragraphs: [paragraph] },
          source: buildFreshNodeSourceMetadata(entry, now, node.source),
        },
      };
    }
    return {
      node,
      reason: "Text source can refresh only text nodes.",
    };
  }

  if (entry.refresh.kind === "table") {
    if (node.type !== "table") {
      return { node, reason: "Table source can refresh only table nodes." };
    }
    const content: TableContent = {
      columns: entry.refresh.columns,
      rows: entry.refresh.rows,
      header: node.content.header ?? true,
      ...(entry.refresh.caption ? { caption: entry.refresh.caption } : {}),
    };
    return {
      node: {
        ...node,
        content,
        source: buildFreshNodeSourceMetadata(entry, now, node.source),
      },
    };
  }

  if (entry.refresh.kind === "visual") {
    if (node.type !== "visual") {
      return { node, reason: "Visual source can refresh only visual nodes." };
    }
    return {
      node: {
        ...node,
        content: {
          ...node.content,
          visualId: entry.refresh.visualId,
          ...(entry.refresh.alt ? { alt: entry.refresh.alt } : {}),
        },
        source: buildFreshNodeSourceMetadata(entry, now, node.source),
      },
    };
  }

  if (node.type !== "image") {
    return { node, reason: "Image source can refresh only image nodes." };
  }
  return {
    node: {
      ...node,
      content: {
        ...node.content,
        ...(entry.refresh.assetId ? { assetId: entry.refresh.assetId } : {}),
        ...(entry.refresh.alt ? { alt: entry.refresh.alt } : {}),
      },
      source: buildFreshNodeSourceMetadata(entry, now, node.source),
    },
  };
}

export function refreshNodeSource(
  deck: Deck,
  slideId: string,
  nodeId: string,
  index: SourceBlockIndex,
  now: string,
): SourceRefreshResult {
  const slide = deck.slides.find((candidate) => candidate.id === slideId);
  const node = slide ? findNodeById(slide.children, nodeId) : undefined;
  const source = node?.source;
  if (!slide || !node || !source) {
    return {
      status: "skipped",
      deck,
      slideId,
      nodeId,
      reason: "Node has no source metadata.",
    };
  }
  if (source.unlinked === true) {
    return {
      status: "skipped",
      deck,
      slideId,
      nodeId,
      reason: "Node is explicitly unlinked.",
    };
  }
  if (source.documentId !== index.documentId) {
    return {
      status: "skipped",
      deck,
      slideId,
      nodeId,
      reason: "Cross-document source requires explicit remote resolution.",
    };
  }
  const resolution = resolveSourceBlock(index, source);
  if (resolution.status === "ambiguous") {
    return {
      status: "skipped",
      deck,
      slideId,
      nodeId,
      reason:
        "Multiple source blocks match this metadata; choose one explicitly before relinking.",
    };
  }
  if (resolution.status === "missing") {
    return {
      status: "skipped",
      deck,
      slideId,
      nodeId,
      reason: "Source block is missing.",
    };
  }
  const block = resolution.block;

  let skippedReason: string | undefined;
  const nextDeck = mapSlides(deck, (candidate) => {
    if (candidate.id !== slideId) return candidate;
    return {
      ...candidate,
      children: candidate.children.map((child) =>
        mapNodeById(child, nodeId, (target) => {
          const refreshed = refreshNodeFromEntry(target, block, now);
          skippedReason = refreshed.reason;
          return refreshed.node;
        }),
      ),
    };
  });
  if (skippedReason) {
    const checked = updateNodeSourceState(
      deck,
      slideId,
      nodeId,
      "unknown",
      now,
      skippedReason,
      block,
    );
    return {
      status: "skipped",
      deck: checked,
      slideId,
      nodeId,
      reason: skippedReason,
    };
  }
  return { status: "refreshed", deck: nextDeck, nodeId, slideId };
}

export function unlinkNodeSource(
  deck: Deck,
  slideId: string,
  nodeId: string,
  now: string,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return {
      ...slide,
      children: slide.children.map((child) =>
        mapNodeById(child, nodeId, (node) => {
          if (!node.source) return node;
          return {
            ...node,
            source: {
              ...node.source,
              unlinked: true,
              refresh: {
                state: "unlinked",
                checkedAt: now,
                reason: "Source dependency was explicitly unlinked.",
              },
            },
          } as SlideChildNode;
        }),
      ),
    };
  });
}

export function relinkNodeSource(
  deck: Deck,
  slideId: string,
  nodeId: string,
  entry: SourceBlockIndexEntry,
  now: string,
  options?: { allowDocumentChange?: boolean },
): SourceRefreshResult {
  const slide = deck.slides.find((candidate) => candidate.id === slideId);
  const node = slide ? findNodeById(slide.children, nodeId) : undefined;
  if (!slide || !node) {
    return {
      status: "skipped",
      deck,
      slideId,
      nodeId,
      reason: "Node was not found.",
    };
  }
  if (
    node.source?.documentId &&
    node.source.documentId !== entry.documentId &&
    options?.allowDocumentChange !== true
  ) {
    return {
      status: "skipped",
      deck,
      slideId,
      nodeId,
      reason:
        "Cross-document relink requires an explicit reviewed document change.",
    };
  }
  let skippedReason: string | undefined;
  const nextDeck = mapSlides(deck, (candidate) => {
    if (candidate.id !== slideId) return candidate;
    return {
      ...candidate,
      children: candidate.children.map((child) =>
        mapNodeById(child, nodeId, (target) => {
          const refreshed = refreshNodeFromEntry(target, entry, now);
          skippedReason = refreshed.reason;
          return skippedReason
            ? target
            : {
                ...refreshed.node,
                source: buildFreshNodeSourceMetadata(entry, now, target.source),
              };
        }),
      ),
    };
  });
  if (skippedReason) {
    return { status: "skipped", deck, slideId, nodeId, reason: skippedReason };
  }
  return { status: "refreshed", deck: nextDeck, slideId, nodeId };
}

export function updateNodeSourceState(
  deck: Deck,
  slideId: string,
  nodeId: string,
  state: SourceRefreshState,
  now: string,
  reason: string,
  block?: SourceBlockIndexEntry,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return {
      ...slide,
      children: slide.children.map((child) =>
        mapNodeById(child, nodeId, (node) => {
          if (!node.source) return node;
          return {
            ...node,
            source: sourceWithRefresh(node.source, state, now, reason, block),
          } as SlideChildNode;
        }),
      ),
    };
  });
}

export function dismissNodeSourceIssue(
  deck: Deck,
  slideId: string,
  nodeId: string,
  index: SourceBlockIndex,
  now: string,
): Deck {
  const slide = deck.slides.find((candidate) => candidate.id === slideId);
  const node = slide ? findNodeById(slide.children, nodeId) : undefined;
  if (!slide || !node?.source) return deck;
  const classification = classifyNodeSource(
    slide,
    deck.slides.findIndex((candidate) => candidate.id === slideId),
    node,
    index,
  );
  const source = node.source;
  const currentHash = classification?.block?.hash ?? source.contentHash;
  return mapSlides(deck, (candidate) => {
    if (candidate.id !== slideId) return candidate;
    return {
      ...candidate,
      children: candidate.children.map((child) =>
        mapNodeById(child, nodeId, (target) => {
          if (!target.source) return target;
          return {
            ...target,
            source: {
              ...target.source,
              refresh: {
                state:
                  classification?.state ??
                  target.source.refresh?.state ??
                  "unknown",
                checkedAt: now,
                ...(classification?.block
                  ? { sourceHash: classification.block.hash }
                  : {}),
                reason: "Source review item was dismissed by the user.",
              },
              extra: withSourceReviewDismissalExtra(
                target.source.extra,
                buildSourceReviewDismissalExtra({
                  ...(target.source.documentId
                    ? { documentId: target.source.documentId }
                    : {}),
                  ...(target.source.blockId
                    ? { blockId: target.source.blockId }
                    : {}),
                  ...(currentHash ? { currentHash } : {}),
                  state:
                    classification?.state ??
                    target.source.refresh?.state ??
                    "unknown",
                  dismissedAt: now,
                  reason:
                    classification?.reason ?? "Source review item dismissed.",
                }),
              ),
            },
          } as SlideChildNode;
        }),
      ),
    };
  });
}

export function refreshAllSafeSourceLinks(
  deck: Deck,
  index: SourceBlockIndex,
  now: string,
): SourceRefreshAllResult {
  const classifications = classifyDeckSourceLinks(deck, index);
  let nextDeck = deck;
  const refreshed: SourceLinkClassification[] = [];
  const skipped: { item: SourceLinkClassification; reason: string }[] = [];
  for (const item of classifications) {
    if (item.dismissed === true || item.state === "unlinked") {
      continue;
    }
    if (item.state !== "stale") {
      if (item.state !== "fresh") {
        skipped.push({ item, reason: item.reason });
      }
      continue;
    }
    const result = refreshNodeSource(
      nextDeck,
      item.slideId,
      item.nodeId,
      index,
      now,
    );
    if (result.status === "refreshed") {
      nextDeck = result.deck;
      refreshed.push(item);
    } else {
      nextDeck = updateNodeSourceState(
        result.deck,
        item.slideId,
        item.nodeId,
        "unknown",
        now,
        result.reason,
        item.block,
      );
      skipped.push({ item, reason: result.reason });
    }
  }
  return { deck: nextDeck, refreshed, skipped };
}
