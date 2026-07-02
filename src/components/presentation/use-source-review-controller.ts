import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { DocumentBlock } from "@/lib/content/document-blocks";
import {
  buildSourceBlockIndex,
  type SourceBlockIndex,
  type SourceBlockIndexEntry,
} from "@/lib/presentation/block-index";
import {
  documentSourceInsertBlocks,
  type DocumentSourceInsertBlock,
} from "@/lib/presentation/document-source-commands";
import type { InspectorPanelId } from "@/lib/presentation/inspector-panel-ui";
import type {
  Deck,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation/schema";
import {
  deriveSourceReviewDerivations,
  type SourceLinkClassification,
  type SourceReviewDerivations,
  type SourceReviewItem,
} from "@/lib/presentation/source-links";
import {
  dismissSourceReviewItem,
  refreshAllSourceReviewItems,
  refreshSelectedSourceLink,
  refreshSourceReviewItem,
  relinkSourceReviewItem,
  unlinkSourceReviewItem,
  type SourceLinkHostRefreshArgs,
  type SourceLinkHostRefreshResult,
  type SourceLinkOrchestrationResult,
} from "@/lib/presentation/source-link-orchestration";

import {
  setSelection as setSelectedNodeIds,
  type SelectionState,
} from "./selection-model";

export function sourceStatusLabelForReview(
  documentSourceIndex: SourceBlockIndex | undefined,
  reviewItemCount: number,
): string {
  if (documentSourceIndex === undefined) {
    return "No live document source";
  }
  if (reviewItemCount > 0) {
    return `${reviewItemCount} source issue${reviewItemCount === 1 ? "" : "s"}`;
  }
  return "Up to date";
}

export interface UseSourceReviewControllerArgs {
  documentId: string;
  documentBlocks: readonly DocumentBlock[];
  sourceBlockIndex?: SourceBlockIndex;
  deck: Deck;
  activeSlide: SlideNode | undefined;
  selectedNode: SlideChildNode | undefined;
  onRefreshSource?: (
    args: SourceLinkHostRefreshArgs,
  ) => Promise<SourceLinkHostRefreshResult | undefined>;
  onDeckChange: (deck: Deck) => void;
  setActiveSlideIndex: (index: number) => void;
  setSelection: Dispatch<SetStateAction<SelectionState>>;
  focusSelectedNodeSoon: (nodeId: string | undefined) => void;
  openInspectorPanel: (panel: InspectorPanelId) => void;
  setSourceMenuOpen: (open: boolean) => void;
  setStageAnnouncement: (announcement: string) => void;
}

export interface SourceReviewController {
  documentSourceIndex: SourceBlockIndex | undefined;
  sourceDerivations: SourceReviewDerivations;
  sourceClassifications: readonly SourceLinkClassification[];
  selectedSourceClassification: SourceLinkClassification | undefined;
  sourceReview: readonly SourceReviewItem[];
  documentInsertBlocks: readonly DocumentSourceInsertBlock[];
  sourceStatusLabel: string;
  sourceReviewStatus: string;
  handleRefreshSelectedSource: () => Promise<void>;
  handleSelectSourceItem: (slideId: string, nodeId: string) => void;
  handleRefreshSourceAt: (slideId: string, nodeId: string) => void;
  handleUnlinkSourceAt: (slideId: string, nodeId: string) => void;
  handleRelinkSourceAt: (
    slideId: string,
    nodeId: string,
    block: SourceBlockIndexEntry,
  ) => void;
  handleNavigateSourceBlock: (documentId: string, blockId: string) => void;
  handleDismissSourceAt: (slideId: string, nodeId: string) => void;
  handleRefreshAllSources: () => void;
  handleSyncFromDocument: () => void;
  handleReviewSourceLinks: () => void;
}

export function useSourceReviewController({
  documentId,
  documentBlocks,
  sourceBlockIndex,
  deck,
  activeSlide,
  selectedNode,
  onRefreshSource,
  onDeckChange,
  setActiveSlideIndex,
  setSelection,
  focusSelectedNodeSoon,
  openInspectorPanel,
  setSourceMenuOpen,
  setStageAnnouncement,
}: UseSourceReviewControllerArgs): SourceReviewController {
  const documentSourceIndex = useMemo(() => {
    if (sourceBlockIndex) return sourceBlockIndex;
    if (documentBlocks.length === 0) return undefined;
    return buildSourceBlockIndex(documentId, documentBlocks);
  }, [documentBlocks, documentId, sourceBlockIndex]);

  const sourceDerivations = useMemo(
    () => deriveSourceReviewDerivations(deck, documentSourceIndex),
    [deck, documentSourceIndex],
  );
  const sourceClassifications = sourceDerivations.classifications;
  const sourceReview = sourceDerivations.reviewItems;
  const documentInsertBlocks = useMemo(
    () => documentSourceInsertBlocks(documentSourceIndex),
    [documentSourceIndex],
  );
  const sourceStatusLabel = sourceStatusLabelForReview(
    documentSourceIndex,
    sourceReview.length,
  );
  const selectedSourceClassification =
    activeSlide && selectedNode
      ? sourceClassifications.find(
          (item) =>
            item.slideId === activeSlide.id && item.nodeId === selectedNode.id,
        )
      : undefined;
  const [sourceReviewStatus, setSourceReviewStatus] = useState("");

  function handleSelectSourceItem(slideId: string, nodeId: string) {
    const slideIndex = deck.slides.findIndex((slide) => slide.id === slideId);
    if (slideIndex === -1) return;
    setActiveSlideIndex(slideIndex);
    setSelection((s) => setSelectedNodeIds(s, [nodeId]));
    focusSelectedNodeSoon(nodeId);
  }

  function applySourceLinkOrchestration(
    result: SourceLinkOrchestrationResult,
  ): void {
    if (result.deck) {
      onDeckChange(result.deck);
    }
    if (result.selection) {
      handleSelectSourceItem(result.selection.slideId, result.selection.nodeId);
    }
    if (result.statusMessage) {
      setSourceReviewStatus(result.statusMessage);
    }
    if (result.announcement) {
      setStageAnnouncement(result.announcement);
    }
  }

  async function handleRefreshSelectedSource() {
    if (!activeSlide || !selectedNode?.source) return;
    const result = await refreshSelectedSourceLink({
      deck,
      slide: activeSlide,
      node: selectedNode,
      now: new Date().toISOString(),
      sourceBlockIndex: documentSourceIndex,
      onRefreshSource,
    });
    if (!result) return;
    applySourceLinkOrchestration(result);
  }

  function handleRefreshSourceAt(slideId: string, nodeId: string) {
    if (!documentSourceIndex) return;
    applySourceLinkOrchestration(
      refreshSourceReviewItem({
        deck,
        sourceBlockIndex: documentSourceIndex,
        slideId,
        nodeId,
        now: new Date().toISOString(),
      }),
    );
  }

  function handleUnlinkSourceAt(slideId: string, nodeId: string) {
    applySourceLinkOrchestration(
      unlinkSourceReviewItem({
        deck,
        slideId,
        nodeId,
        now: new Date().toISOString(),
      }),
    );
  }

  function handleRelinkSourceAt(
    slideId: string,
    nodeId: string,
    block: SourceBlockIndexEntry,
  ) {
    applySourceLinkOrchestration(
      relinkSourceReviewItem({
        deck,
        slideId,
        nodeId,
        block,
        now: new Date().toISOString(),
      }),
    );
  }

  function handleNavigateSourceBlock(documentId: string, blockId: string) {
    const params = new URLSearchParams({ sourceBlock: blockId });
    window.open(
      `/app/documents/${encodeURIComponent(documentId)}?${params.toString()}`,
      "_blank",
    );
    setStageAnnouncement("Opened the source document block.");
  }

  function handleDismissSourceAt(slideId: string, nodeId: string) {
    if (!documentSourceIndex) return;
    applySourceLinkOrchestration(
      dismissSourceReviewItem({
        deck,
        sourceBlockIndex: documentSourceIndex,
        slideId,
        nodeId,
        now: new Date().toISOString(),
      }),
    );
  }

  function handleRefreshAllSources() {
    if (!documentSourceIndex) return;
    applySourceLinkOrchestration(
      refreshAllSourceReviewItems({
        deck,
        sourceBlockIndex: documentSourceIndex,
        now: new Date().toISOString(),
      }),
    );
  }

  function handleSyncFromDocument() {
    handleRefreshAllSources();
    setSourceMenuOpen(false);
  }

  function handleReviewSourceLinks() {
    const [first] = sourceReview;
    if (!first) return;
    handleSelectSourceItem(first.slideId, first.nodeId);
    openInspectorPanel("source");
    setSourceMenuOpen(false);
  }

  return {
    documentSourceIndex,
    sourceDerivations,
    sourceClassifications,
    selectedSourceClassification,
    sourceReview,
    documentInsertBlocks,
    sourceStatusLabel,
    sourceReviewStatus,
    handleRefreshSelectedSource,
    handleSelectSourceItem,
    handleRefreshSourceAt,
    handleUnlinkSourceAt,
    handleRelinkSourceAt,
    handleNavigateSourceBlock,
    handleDismissSourceAt,
    handleRefreshAllSources,
    handleSyncFromDocument,
    handleReviewSourceLinks,
  };
}
