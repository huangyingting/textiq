import type { Dispatch, SetStateAction } from "react";

import type {
  DeckChromeConfig,
  DeckChromeKind,
  DeckV7,
  LayoutBox,
  NodeSourceMetadata,
  SlideChildNode,
  SlideControls,
  SlideNode,
  SlideProps,
} from "@/lib/presentation-vnext/schema";
import type {
  PresentationDiagnostic,
  DiagnosticAction,
} from "@/lib/presentation-vnext/diagnostics";
import type {
  StyleBinding,
  StylePatch,
} from "@/lib/presentation-vnext/style-schema";
import type { ResolvedRenderNode } from "@/lib/presentation-vnext/render-tree";
import type { InspectorPanelId } from "@/lib/presentation-vnext/inspector-panel-ui";
import {
  detachDeckChrome,
  detachDecoration,
  reorderZIndex,
  resetLocalStyleOverride,
  resetSlideLocalStyle,
  updateDeckChrome,
  updateLocalStyle,
  updateNodeAttributes,
  updateNodeContent,
  updateNodeLayout,
  updateNodeLayouts,
  updateNodeSourceMetadata,
  updateNodeStyleBinding,
  updateSlideAttributes,
  updateSlideControls,
  updateSlideLocalStyle,
  updateSlideSourceMetadata,
} from "@/lib/presentation-vnext";
import {
  diagnosticTargetKey,
  getDiagnosticNodeId,
  getDiagnosticSlideId,
} from "@/lib/presentation-vnext/diagnostics";
import { applyDiagnosticRepairAction } from "@/lib/presentation-vnext/diagnostic-repairs";

import {
  buildAlignSelectionPatches,
  buildDistributeSelectionPatches,
  buildLayerReorderPatches,
  buildMatchSizeSelectionPatches,
  buildZOrderSelectionOperations,
  collectSelectedLayoutEntries,
} from "./arrangement-geometry";
import {
  clearSelection,
  setSelection as setSelectedNodeIds,
  type SelectionState,
} from "./selection-model";
import { findNodeById, parentGroupIdForNode } from "./selection-traversal";
import type {
  SelectionAlignMode,
  SelectionDistributeMode,
  SelectionMatchSizeMode,
} from "./toolbar/context-toolbar";
import { findSlideIndexForFocus } from "./use-stage-focus-controller";

const DECK_CHROME_KINDS: DeckChromeKind[] = [
  "logo",
  "footer",
  "pageNumber",
  "watermark",
  "border",
];

function clampFrame(frame: LayoutBox["frame"]): LayoutBox["frame"] {
  const x = Number.isFinite(frame.x) ? frame.x : 0;
  const y = Number.isFinite(frame.y) ? frame.y : 0;
  const w = Number.isFinite(frame.w) ? frame.w : 1;
  const h = Number.isFinite(frame.h) ? frame.h : 1;
  return {
    x: Math.max(-100, Math.min(200, x)),
    y: Math.max(-100, Math.min(200, y)),
    w: Math.max(0.1, Math.min(300, w)),
    h: Math.max(0.1, Math.min(300, h)),
  };
}

function normalizeRotationDegrees(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  const normalized = rotation % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function defaultStyleBindingForNode(node: SlideChildNode): StyleBinding {
  if (node.type === "text") {
    const role = node.role;
    let ref: StyleBinding["ref"] = "text.body";
    if (role === "title") ref = "text.title";
    else if (role === "subtitle") ref = "text.subtitle";
    else if (role === "kicker") ref = "text.kicker";
    else if (role === "caption") ref = "text.caption";
    else if (role === "quote") ref = "text.quote";
    else if (role === "metric") ref = "text.metric";
    return { ref };
  }
  if (node.type === "image") return { ref: "media.inline" };
  if (node.type === "visual") return { ref: "chart.primary" };
  if (node.type === "connector") return { ref: "connector.primary" };
  if (node.type === "table") return { ref: "surface.table" };
  return { ref: "surface.card" };
}

interface CreateInspectorCommandsArgs {
  deck: DeckV7;
  activeSlide: SlideNode | undefined;
  selectedResolvedNode: ResolvedRenderNode | undefined;
  firstSelectedId: string | undefined;
  selectedIds: readonly string[];
  onDeckChange: (nextDeck: DeckV7) => void;
  setSelection: Dispatch<SetStateAction<SelectionState>>;
  setFocusedNodeId: Dispatch<SetStateAction<string | null>>;
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
  setStageAnnouncement: Dispatch<SetStateAction<string>>;
  setActiveGroupId: Dispatch<SetStateAction<string | null>>;
  setActiveSlideIndex: Dispatch<SetStateAction<number>>;
  setDeckDiagnosticsReviewOpen: Dispatch<SetStateAction<boolean>>;
  setInspectorSheetOpen: Dispatch<SetStateAction<boolean>>;
  requestImageRepair: (nodeId: string) => void;
  exitInlineEdit: () => void;
  focusSelectedNodeSoon: (nodeId: string | undefined) => void;
  focusEditorRootSoon: () => void;
  requestInspectorPanel: (panel: InspectorPanelId) => void;
  replacementNodeAfterDelete: (
    deletedIds: readonly string[],
  ) => string | undefined;
  isMobileInspectorViewport: () => boolean;
  handleSelectSourceItem: (slideId: string, nodeId: string) => void;
  handleRefreshSourceAt: (slideId: string, nodeId: string) => void;
  handleUnlinkSourceAt: (slideId: string, nodeId: string) => void;
}

export function useInspectorCommands(args: CreateInspectorCommandsArgs) {
  const {
    deck,
    activeSlide,
    selectedResolvedNode,
    firstSelectedId,
    selectedIds,
    onDeckChange,
    setSelection,
    setFocusedNodeId,
    setHoveredNodeId,
    setStageAnnouncement,
    setActiveGroupId,
    setDeckDiagnosticsReviewOpen,
    setInspectorSheetOpen,
    setActiveSlideIndex,
    requestImageRepair,
    exitInlineEdit,
    focusSelectedNodeSoon,
    focusEditorRootSoon,
    requestInspectorPanel,
    replacementNodeAfterDelete,
    isMobileInspectorViewport,
    handleSelectSourceItem,
    handleRefreshSourceAt,
    handleUnlinkSourceAt,
  } = args;

  function focusDiagnosticTarget(
    focus: { slideId: string; nodeId?: string },
    sourceDeck: DeckV7 = deck,
  ) {
    const slideIndex = sourceDeck.slides.findIndex(
      (slide) => slide.id === focus.slideId,
    );
    if (slideIndex < 0) return;
    const targetSlide = sourceDeck.slides[slideIndex];
    const node =
      focus.nodeId && targetSlide
        ? findNodeById(targetSlide.children, focus.nodeId)
        : undefined;
    args.setActiveGroupId(null);
    args.setInspectorSheetOpen(args.isMobileInspectorViewport());
    args.setSelection((s) => clearSelection(s));
    args.setFocusedNodeId(null);
    args.setSelection((s) => s);
    args.setStageAnnouncement((current) => current);
    args.setSelection((s) => s);
    args.setFocusedNodeId(null);
    args.setSelection((s) => clearSelection(s));
    args.setFocusedNodeId(null);
    // Keep slide selection in the shell through the provided setter.
    // The command owner performs the target derivation and focus restoration.
    (
      args as CreateInspectorCommandsArgs & {
        setActiveSlideIndex?: Dispatch<SetStateAction<number>>;
      }
    ).setActiveSlideIndex?.(slideIndex);
    if (node) {
      setSelection((s) => setSelectedNodeIds(s, [node.id]));
      setFocusedNodeId(node.id);
      focusSelectedNodeSoon(node.id);
      return;
    }
    setSelection((s) => clearSelection(s));
    setFocusedNodeId(null);
  }

  function handleUpdateControls(patch: Partial<SlideControls>) {
    if (!activeSlide) return;
    onDeckChange(updateSlideControls(deck, activeSlide.id, patch));
  }

  function handleUpdateProps(patch: Partial<SlideProps>) {
    if (!activeSlide) return;
    const updated: DeckV7 = {
      ...deck,
      slides: deck.slides.map((s) => {
        if (s.id !== activeSlide.id) return s;
        const props = { ...s.props, ...patch };
        const detachedNodeIds = new Set<string>();
        if (Object.prototype.hasOwnProperty.call(patch, "deckChrome")) {
          const nextDeckChrome = patch.deckChrome;
          for (const kind of DECK_CHROME_KINDS) {
            const previousOverride = s.props?.deckChrome?.[kind];
            if (
              previousOverride?.mode !== "detached" ||
              !previousOverride.nodeId
            ) {
              continue;
            }
            const nextOverride = nextDeckChrome?.[kind];
            if (
              nextOverride?.mode !== "detached" ||
              nextOverride.nodeId !== previousOverride.nodeId
            ) {
              detachedNodeIds.add(previousOverride.nodeId);
            }
          }
        }
        for (const key of Object.keys(props) as (keyof SlideProps)[]) {
          if (props[key] === undefined) delete props[key];
        }
        return {
          ...s,
          props: Object.keys(props).length > 0 ? props : undefined,
          children:
            detachedNodeIds.size > 0
              ? s.children.filter((child) => !detachedNodeIds.has(child.id))
              : s.children,
        };
      }),
    };
    onDeckChange(updated);
  }

  function handleUpdateDeckChrome(patch: Partial<DeckChromeConfig>) {
    onDeckChange(updateDeckChrome(deck, patch));
  }

  function handleUpdateSlideAttributes(patch: {
    name?: string;
    notes?: string;
  }) {
    if (!activeSlide) return;
    onDeckChange(updateSlideAttributes(deck, activeSlide.id, patch));
  }

  function handleUpdateSlideLocalStyle(patch: StylePatch) {
    if (!activeSlide) return;
    onDeckChange(updateSlideLocalStyle(deck, activeSlide.id, patch));
  }

  function handleResetSlideLocalStyle() {
    if (!activeSlide) return;
    onDeckChange(resetSlideLocalStyle(deck, activeSlide.id));
  }

  function handleUpdateSlideSource(source: NodeSourceMetadata | undefined) {
    if (!activeSlide) return;
    onDeckChange(updateSlideSourceMetadata(deck, activeSlide.id, source));
  }

  function handleChangeStyleBinding(binding: StyleBinding) {
    if (!activeSlide || !firstSelectedId) return;
    onDeckChange(
      updateNodeStyleBinding(deck, activeSlide.id, firstSelectedId, binding),
    );
  }

  function handleUpdateSelectedLayout(patch: Partial<LayoutBox>) {
    if (!activeSlide || !firstSelectedId) return;
    const frame =
      patch.frame !== undefined ? clampFrame(patch.frame) : undefined;
    const rotation =
      patch.rotation !== undefined
        ? normalizeRotationDegrees(patch.rotation)
        : undefined;
    const zIndex =
      patch.zIndex !== undefined && Number.isFinite(patch.zIndex)
        ? Math.trunc(patch.zIndex)
        : undefined;
    onDeckChange(
      updateNodeLayout(deck, activeSlide.id, firstSelectedId, {
        ...patch,
        ...(frame !== undefined ? { frame } : {}),
        ...(rotation !== undefined ? { rotation } : {}),
        ...(zIndex !== undefined ? { zIndex } : {}),
      }),
    );
  }

  function handleUpdateSelectedAttributes(patch: {
    locked?: boolean;
    hidden?: boolean;
  }) {
    if (!activeSlide || !firstSelectedId) return;
    let updated = deck;
    for (const id of selectedIds.length > 0 ? selectedIds : [firstSelectedId]) {
      updated = updateNodeAttributes(updated, activeSlide.id, id, patch);
    }
    onDeckChange(updated);
    if (patch.locked !== undefined) {
      setStageAnnouncement(
        patch.locked ? "Selection locked" : "Selection unlocked",
      );
      focusSelectedNodeSoon(firstSelectedId);
    }
    if (patch.hidden === true) {
      const affectedIds =
        selectedIds.length > 0 ? selectedIds : [firstSelectedId];
      const replacementId = replacementNodeAfterDelete(affectedIds);
      if (replacementId) {
        setSelection((s) => setSelectedNodeIds(s, [replacementId]));
        focusSelectedNodeSoon(replacementId);
      } else {
        setSelection((s) => clearSelection(s));
        setFocusedNodeId(null);
        focusEditorRootSoon();
      }
    }
  }

  function handleUpdateSelectedContent(patch: Record<string, unknown>) {
    if (!activeSlide || !firstSelectedId) return;
    onDeckChange(
      updateNodeContent(deck, activeSlide.id, firstSelectedId, patch),
    );
  }

  function handleResetToTheme() {
    if (!activeSlide || !firstSelectedId) return;
    onDeckChange(
      resetLocalStyleOverride(deck, activeSlide.id, firstSelectedId),
    );
  }

  function handleUpdateSelectedLocalStyle(patch: StylePatch) {
    if (!activeSlide || !firstSelectedId) return;
    onDeckChange(
      updateLocalStyle(deck, activeSlide.id, firstSelectedId, patch),
    );
  }

  function handleUpdateSelectedSource(source: NodeSourceMetadata | undefined) {
    if (!activeSlide || !firstSelectedId) return;
    onDeckChange(
      updateNodeSourceMetadata(deck, activeSlide.id, firstSelectedId, source),
    );
  }

  function handleSelectLayer(nodeId: string) {
    setSelection((s) => setSelectedNodeIds(s, [nodeId]));
    if (activeSlide)
      setActiveGroupId(parentGroupIdForNode(activeSlide.children, nodeId));
    focusSelectedNodeSoon(nodeId);
  }

  function handleUpdateLayer(
    nodeId: string,
    patch: { name?: string; locked?: boolean; hidden?: boolean },
  ) {
    if (!activeSlide) return;
    onDeckChange(updateNodeAttributes(deck, activeSlide.id, nodeId, patch));
  }

  function handleReorderLayer(nodeId: string, targetIndex: number) {
    if (!activeSlide) return;
    const patches = buildLayerReorderPatches(
      activeSlide.children,
      nodeId,
      targetIndex,
    );
    if (patches.size === 0) return;
    onDeckChange(updateNodeLayouts(deck, activeSlide.id, patches));
  }

  function handleAlignSelection(mode: SelectionAlignMode) {
    if (!activeSlide) return;
    const patches = buildAlignSelectionPatches(
      collectSelectedLayoutEntries(activeSlide.children, selectedIds),
      mode,
    );
    if (patches.size === 0) return;
    onDeckChange(updateNodeLayouts(deck, activeSlide.id, patches));
  }

  function handleDistributeSelection(mode: SelectionDistributeMode) {
    if (!activeSlide) return;
    const patches = buildDistributeSelectionPatches(
      collectSelectedLayoutEntries(activeSlide.children, selectedIds),
      mode,
    );
    if (patches.size === 0) return;
    onDeckChange(updateNodeLayouts(deck, activeSlide.id, patches));
  }

  function handleMatchSize(mode: SelectionMatchSizeMode) {
    if (!activeSlide) return;
    const patches = buildMatchSizeSelectionPatches(
      collectSelectedLayoutEntries(activeSlide.children, selectedIds),
      mode,
    );
    if (patches.size === 0) return;
    onDeckChange(updateNodeLayouts(deck, activeSlide.id, patches));
  }

  function handleReorderSelection(
    kind: "forward" | "backward" | "front" | "back",
  ) {
    if (!activeSlide || selectedIds.length === 0) return;
    const operations = buildZOrderSelectionOperations(
      activeSlide.children,
      selectedIds,
      kind,
    );
    if (operations.length === 0) return;
    let updated = deck;
    operations.forEach((operation) => {
      updated = reorderZIndex(
        updated,
        activeSlide.id,
        operation.id,
        operation.zIndex,
      );
    });
    onDeckChange(updated);
  }

  function handleDiagnosticNavigate(diagnostic: PresentationDiagnostic) {
    const nodeId = getDiagnosticNodeId(diagnostic);
    const slideId = getDiagnosticSlideId(diagnostic);
    const slideIndex = slideId
      ? deck.slides.findIndex((slide) => slide.id === slideId)
      : nodeId
        ? findSlideIndexForFocus(deck, nodeId)
        : -1;
    if (slideIndex < 0) {
      setStageAnnouncement("Diagnostic target is no longer present.");
      return;
    }
    const targetSlide = deck.slides[slideIndex];
    const targetNode =
      nodeId && targetSlide
        ? findNodeById(targetSlide.children, nodeId)
        : undefined;
    setActiveSlideIndex(slideIndex);
    exitInlineEdit();
    setHoveredNodeId(null);
    if (targetNode) {
      setSelection((s) => setSelectedNodeIds(s, [targetNode.id]));
      setFocusedNodeId(targetNode.id);
      focusSelectedNodeSoon(targetNode.id);
    } else {
      setSelection((s) => clearSelection(s));
      setFocusedNodeId(null);
    }
    requestInspectorPanel("diagnostics");
    if (isMobileInspectorViewport()) setInspectorSheetOpen(true);
    setDeckDiagnosticsReviewOpen(false);
    setStageAnnouncement(
      targetNode
        ? "Moved to diagnostic target node."
        : "Moved to diagnostic target slide.",
    );
  }

  function handleDiagnosticAction(
    action: DiagnosticAction,
    diagnostic: PresentationDiagnostic,
  ) {
    if (
      action.type === "refresh-source" ||
      action.type === "unlink-source" ||
      action.type === "relink-source" ||
      action.type === "open-source-review"
    ) {
      const targetedDiagnostic = action.target
        ? { ...diagnostic, target: action.target }
        : diagnostic;
      const targetNodeId =
        getDiagnosticNodeId(targetedDiagnostic) ?? firstSelectedId;
      const targetSlideId =
        getDiagnosticSlideId(targetedDiagnostic) ?? activeSlide?.id;

      if (action.type === "open-source-review") {
        if (targetSlideId && targetNodeId) {
          handleSelectSourceItem(targetSlideId, targetNodeId);
          requestInspectorPanel("source");
          if (isMobileInspectorViewport()) setInspectorSheetOpen(true);
        }
        setDeckDiagnosticsReviewOpen(false);
        setStageAnnouncement("Opened Source Review.");
        return;
      }

      if (!targetSlideId || !targetNodeId) {
        setStageAnnouncement("Source diagnostic target is no longer present.");
        return;
      }

      if (action.type === "refresh-source") {
        handleRefreshSourceAt(targetSlideId, targetNodeId);
        setDeckDiagnosticsReviewOpen(false);
        return;
      }
      if (action.type === "unlink-source") {
        handleUnlinkSourceAt(targetSlideId, targetNodeId);
        setDeckDiagnosticsReviewOpen(false);
        return;
      }

      handleSelectSourceItem(targetSlideId, targetNodeId);
      requestInspectorPanel("source");
      if (isMobileInspectorViewport()) setInspectorSheetOpen(true);
      setDeckDiagnosticsReviewOpen(false);
      setStageAnnouncement("Choose a source block to relink this node.");
      return;
    }

    const result = applyDiagnosticRepairAction(deck, action, diagnostic, {
      activeSlideId: activeSlide?.id,
      selectedNodeId: firstSelectedId,
      defaultStyleBindingForNode,
    });

    if (result.status === "noop") {
      setStageAnnouncement(result.reason);
      return;
    }

    if (result.status === "applied") {
      onDeckChange(result.deck);
      focusDiagnosticTarget(result.focus, result.deck);
      setStageAnnouncement(result.announcement);
      return;
    }

    if (result.port === "asset-panel") {
      focusDiagnosticTarget(result.focus);
      const slide = deck.slides.find(
        (candidate) => candidate.id === result.focus.slideId,
      );
      const node =
        result.focus.nodeId && slide
          ? findNodeById(slide.children, result.focus.nodeId)
          : undefined;
      if (node?.type === "image") {
        requestImageRepair(node.id);
      } else {
        requestInspectorPanel("diagnostics");
        setStageAnnouncement(
          "Select the asset field in the inspector to repair this node.",
        );
      }
    }
  }

  function handleDetachDecoration() {
    if (!activeSlide || !selectedResolvedNode) return;
    if (
      selectedResolvedNode.source !== "themeDecoration" &&
      selectedResolvedNode.source !== "deckChrome"
    ) {
      return;
    }

    if (selectedResolvedNode.source === "deckChrome") {
      if (!selectedResolvedNode.chromeKind) return;
      onDeckChange(
        detachDeckChrome(
          deck,
          activeSlide.id,
          selectedResolvedNode.chromeKind,
          selectedResolvedNode,
        ),
      );
      return;
    }

    const { layout, style } = selectedResolvedNode;
    const { framePx: _framePx, ...persistedLayout } = layout;
    const decorationContent =
      selectedResolvedNode.content.type === "text" ||
      selectedResolvedNode.content.type === "image" ||
      selectedResolvedNode.content.type === "shape"
        ? selectedResolvedNode.content
        : undefined;
    onDeckChange(
      detachDecoration(
        deck,
        activeSlide.id,
        selectedResolvedNode.id,
        persistedLayout,
        style as StylePatch,
        decorationContent,
      ),
    );
  }

  return {
    handleUpdateControls,
    handleUpdateProps,
    handleUpdateDeckChrome,
    handleUpdateSlideAttributes,
    handleUpdateSlideLocalStyle,
    handleResetSlideLocalStyle,
    handleUpdateSlideSource,
    handleChangeStyleBinding,
    handleUpdateSelectedLayout,
    handleUpdateSelectedAttributes,
    handleUpdateSelectedContent,
    handleResetToTheme,
    handleUpdateSelectedLocalStyle,
    handleUpdateSelectedSource,
    handleSelectLayer,
    handleUpdateLayer,
    handleReorderLayer,
    handleAlignSelection,
    handleDistributeSelection,
    handleMatchSize,
    handleReorderSelection,
    handleDiagnosticNavigate,
    handleDiagnosticAction,
    handleDetachDecoration,
    diagnosticTargetKey,
  };
}

export const createInspectorCommandDescriptors = useInspectorCommands;
