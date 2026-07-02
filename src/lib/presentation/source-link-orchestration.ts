import type { SourceBlockIndex, SourceBlockIndexEntry } from "./block-index";
import { updateNodeContent, updateNodeSourceMetadata } from "./editor-commands";
import type {
  Deck,
  NodeSourceMetadata,
  SlideChildNode,
  SlideNode,
} from "./schema";
import {
  dismissNodeSourceIssue,
  refreshAllSafeSourceLinks,
  refreshNodeSource,
  relinkNodeSource,
  unlinkNodeSource,
  updateNodeSourceState,
} from "./source-links";

export type SourceLinkSelectionIntent = {
  slideId: string;
  nodeId: string;
};

export type SourceLinkOrchestrationResult = {
  deck?: Deck;
  selection?: SourceLinkSelectionIntent;
  statusMessage?: string;
  announcement?: string;
};

export type SourceLinkHostRefreshResult = {
  contentPatch?: Record<string, unknown>;
  source?: NodeSourceMetadata;
};

export type SourceLinkHostRefreshArgs = {
  deck: Deck;
  slide: SlideNode;
  node: SlideChildNode;
  source: NodeSourceMetadata;
};

export async function refreshSelectedSourceLink(params: {
  deck: Deck;
  slide: SlideNode;
  node: SlideChildNode;
  now: string;
  sourceBlockIndex?: SourceBlockIndex;
  onRefreshSource?: (
    args: SourceLinkHostRefreshArgs,
  ) => Promise<SourceLinkHostRefreshResult | undefined>;
}): Promise<SourceLinkOrchestrationResult | undefined> {
  const { deck, slide, node, now, sourceBlockIndex, onRefreshSource } = params;
  if (!node.source) return undefined;
  if (sourceBlockIndex) {
    return refreshSourceReviewItem({
      deck,
      sourceBlockIndex,
      slideId: slide.id,
      nodeId: node.id,
      now,
    });
  }
  if (!onRefreshSource) return undefined;
  const refreshed = await onRefreshSource({
    deck,
    slide,
    node,
    source: node.source,
  });
  if (!refreshed) return undefined;
  let updated = deck;
  if (refreshed.contentPatch) {
    updated = updateNodeContent(
      updated,
      slide.id,
      node.id,
      refreshed.contentPatch,
    );
  }
  if (refreshed.source) {
    updated = updateNodeSourceMetadata(
      updated,
      slide.id,
      node.id,
      refreshed.source,
    );
  }
  return {
    deck: updated,
    selection: { slideId: slide.id, nodeId: node.id },
  };
}

export function refreshSourceReviewItem(params: {
  deck: Deck;
  sourceBlockIndex: SourceBlockIndex;
  slideId: string;
  nodeId: string;
  now: string;
}): SourceLinkOrchestrationResult {
  const { deck, sourceBlockIndex, slideId, nodeId, now } = params;
  const result = refreshNodeSource(
    deck,
    slideId,
    nodeId,
    sourceBlockIndex,
    now,
  );
  if (result.status === "refreshed") {
    return {
      deck: result.deck,
      selection: { slideId, nodeId },
      statusMessage: "Refreshed source-linked node.",
      announcement: "Refreshed source-linked node.",
    };
  }
  const checked = updateNodeSourceState(
    result.deck,
    slideId,
    nodeId,
    "unknown",
    now,
    result.reason,
  );
  const message = `Skipped source refresh: ${result.reason}`;
  return {
    deck: checked,
    selection: { slideId, nodeId },
    statusMessage: message,
    announcement: message,
  };
}

export function unlinkSourceReviewItem(params: {
  deck: Deck;
  slideId: string;
  nodeId: string;
  now: string;
}): SourceLinkOrchestrationResult {
  const { deck, slideId, nodeId, now } = params;
  return {
    deck: unlinkNodeSource(deck, slideId, nodeId, now),
    selection: { slideId, nodeId },
    statusMessage: "Marked source link as unlinked.",
    announcement: "Marked source link as unlinked.",
  };
}

export function relinkSourceReviewItem(params: {
  deck: Deck;
  slideId: string;
  nodeId: string;
  block: SourceBlockIndexEntry;
  now: string;
}): SourceLinkOrchestrationResult {
  const { deck, slideId, nodeId, block, now } = params;
  const result = relinkNodeSource(deck, slideId, nodeId, block, now, {
    allowDocumentChange: true,
  });
  if (result.status === "refreshed") {
    const message = `Relinked node to ${block.displayLabel}.`;
    return {
      deck: result.deck,
      selection: { slideId, nodeId },
      statusMessage: message,
      announcement: message,
    };
  }
  const message = `Skipped relink: ${result.reason}`;
  return { statusMessage: message, announcement: message };
}

export function dismissSourceReviewItem(params: {
  deck: Deck;
  sourceBlockIndex: SourceBlockIndex;
  slideId: string;
  nodeId: string;
  now: string;
}): SourceLinkOrchestrationResult {
  const { deck, sourceBlockIndex, slideId, nodeId, now } = params;
  return {
    deck: dismissNodeSourceIssue(deck, slideId, nodeId, sourceBlockIndex, now),
    selection: { slideId, nodeId },
    statusMessage: "Dismissed source review item.",
    announcement: "Dismissed source review item.",
  };
}

export function refreshAllSourceReviewItems(params: {
  deck: Deck;
  sourceBlockIndex: SourceBlockIndex;
  now: string;
}): SourceLinkOrchestrationResult {
  const { deck, sourceBlockIndex, now } = params;
  const result = refreshAllSafeSourceLinks(deck, sourceBlockIndex, now);
  const skippedDetails =
    result.skipped.length > 0
      ? ` Skipped: ${result.skipped
          .map(
            ({ item, reason }) => `${item.nodeName ?? item.nodeId} — ${reason}`,
          )
          .join("; ")}`
      : "";
  const message = `Refreshed ${result.refreshed.length} source links; skipped ${result.skipped.length}.${skippedDetails}`;
  return { deck: result.deck, statusMessage: message, announcement: message };
}
