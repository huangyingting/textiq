import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

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
  sourceRefreshPending: boolean;
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

interface SourceReviewRefreshOperation {
  documentId: string;
  deck: Deck;
}

interface SourceReviewRefreshBoundary {
  activate: () => void;
  deactivate: () => void;
  claim: (
    documentId: string,
    deck: Deck,
  ) => SourceReviewRefreshOperation | null;
  owns: (operation: SourceReviewRefreshOperation) => boolean;
  release: (operation: SourceReviewRefreshOperation) => boolean;
}

function createSourceReviewRefreshBoundary(): SourceReviewRefreshBoundary {
  let active = true;
  let currentOperation: SourceReviewRefreshOperation | null = null;
  return {
    activate() {
      active = true;
    },
    deactivate() {
      active = false;
      currentOperation = null;
    },
    claim(documentId, deck) {
      if (!active || currentOperation) return null;
      currentOperation = { documentId, deck };
      return currentOperation;
    },
    owns(operation) {
      return active && currentOperation === operation;
    },
    release(operation) {
      if (currentOperation !== operation) return false;
      currentOperation = null;
      return active;
    },
  };
}

export interface SourceReviewControllerDerivations {
  documentSourceIndex: SourceBlockIndex | undefined;
  sourceDerivations: SourceReviewDerivations;
  documentInsertBlocks: readonly DocumentSourceInsertBlock[];
}

export function deriveSourceReviewControllerInputs({
  documentId,
  documentBlocks,
  sourceBlockIndex,
  deck,
}: Pick<
  UseSourceReviewControllerArgs,
  "documentId" | "documentBlocks" | "sourceBlockIndex" | "deck"
>): SourceReviewControllerDerivations {
  const documentSourceIndex =
    sourceBlockIndex ??
    (documentBlocks.length === 0
      ? undefined
      : buildSourceBlockIndex(documentId, documentBlocks));
  const sourceDerivations = deriveSourceReviewDerivations(
    deck,
    documentSourceIndex,
  );
  return {
    documentSourceIndex,
    sourceDerivations,
    documentInsertBlocks: documentSourceInsertBlocks(documentSourceIndex),
  };
}

interface CreateSourceReviewControllerArgs
  extends UseSourceReviewControllerArgs, SourceReviewControllerDerivations {
  sourceReviewStatus: string;
  setSourceReviewStatus: Dispatch<SetStateAction<string>>;
  sourceRefreshPending?: boolean;
  sourceRefreshBoundary?: SourceReviewRefreshBoundary;
  setSourceRefreshOperation?: Dispatch<
    SetStateAction<SourceReviewRefreshOperation | null>
  >;
}

export function createSourceReviewController({
  documentId,
  deck,
  activeSlide,
  selectedNode,
  onRefreshSource,
  onDeckChange,
  setActiveSlideIndex,
  setSelection,
  focusSelectedNodeSoon,
  openInspectorPanel,
  setStageAnnouncement,
  documentSourceIndex,
  sourceDerivations,
  documentInsertBlocks,
  sourceReviewStatus,
  setSourceReviewStatus,
  sourceRefreshPending = false,
  sourceRefreshBoundary = createSourceReviewRefreshBoundary(),
  setSourceRefreshOperation = () => undefined,
}: CreateSourceReviewControllerArgs): SourceReviewController {
  const sourceClassifications = sourceDerivations.classifications;
  const sourceReview = sourceDerivations.reviewItems;
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
    const operation = sourceRefreshBoundary.claim(documentId, deck);
    if (!operation) return;
    setSourceRefreshOperation(operation);
    try {
      const result = await refreshSelectedSourceLink({
        deck,
        slide: activeSlide,
        node: selectedNode,
        now: new Date().toISOString(),
        sourceBlockIndex: documentSourceIndex,
        onRefreshSource,
      });
      if (!sourceRefreshBoundary.owns(operation) || !result) return;
      applySourceLinkOrchestration(result);
    } catch {
      if (!sourceRefreshBoundary.owns(operation)) return;
      const message = "Could not refresh this source. Please try again.";
      setSourceReviewStatus(message);
      setStageAnnouncement(message);
    } finally {
      if (sourceRefreshBoundary.release(operation)) {
        setSourceRefreshOperation((current) =>
          current === operation ? null : current,
        );
      }
    }
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
  }

  function handleReviewSourceLinks() {
    const [first] = sourceReview;
    if (!first) return;
    handleSelectSourceItem(first.slideId, first.nodeId);
    openInspectorPanel("source");
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
    sourceRefreshPending,
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
  setStageAnnouncement,
}: UseSourceReviewControllerArgs): SourceReviewController {
  const derivations = useMemo(
    () =>
      deriveSourceReviewControllerInputs({
        documentId,
        documentBlocks,
        sourceBlockIndex,
        deck,
      }),
    [deck, documentBlocks, documentId, sourceBlockIndex],
  );
  const [sourceReviewStatus, setSourceReviewStatus] = useState("");
  const [sourceRefreshBoundary] = useState(createSourceReviewRefreshBoundary);
  const [sourceRefreshOperation, setSourceRefreshOperation] =
    useState<SourceReviewRefreshOperation | null>(null);
  const sourceRefreshPending =
    sourceRefreshOperation?.documentId === documentId &&
    sourceRefreshOperation.deck === deck;

  useEffect(() => {
    sourceRefreshBoundary.activate();
    return sourceRefreshBoundary.deactivate;
  }, [deck, documentId, sourceRefreshBoundary]);

  return createSourceReviewController({
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
    setStageAnnouncement,
    ...derivations,
    sourceReviewStatus,
    setSourceReviewStatus,
    sourceRefreshPending,
    sourceRefreshBoundary,
    setSourceRefreshOperation,
  });
}
