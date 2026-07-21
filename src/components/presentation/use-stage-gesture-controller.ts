import type {
  Dispatch,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";

import type {
  ConnectorEndpoint,
  Deck,
  ImageCrop,
  LayoutBox,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation/schema";
import {
  duplicateNodes,
  insertNode,
  moveNodesBy,
  updateNodeContent,
  updateNodeLayout,
  updateNodeLayouts,
  updateNodeRotation,
} from "@/lib/presentation/editor-commands";
import {
  alignmentGuidesForFrames,
  snapFrameToStageGuides,
  type StageGuide,
  type StageGuideInput,
} from "@/lib/presentation/stage-guides";
import { nextLayeredZIndex } from "@/lib/presentation/layer-bands";
import {
  normalizeSelectionFrame,
  selectNodesInFrame,
} from "@/lib/presentation/selection-geometry";
import {
  connectorEndpointFromSlidePoint,
  connectorEndpointSlidePoint,
  connectorFrameFromSlidePoints,
} from "@/lib/presentation/connector-geometry";
import type { StageHitCandidate } from "@/lib/presentation/stage-hit-test";
import type { ResolvedSlideRenderTree } from "@/lib/presentation/render-tree";
/* node:coverage ignore next 6 */
import {
  announceRotation,
  applyKeyboardRotation,
  keyboardRotationDelta,
} from "@/lib/presentation/canvas-keyboard-rotate";

import { collectSelectedLayoutEntries } from "./arrangement-geometry";
import { clipboardShortcutActionFromKey } from "./clipboard-shortcuts";
import {
  multiSelectionBounds,
  rotateMultiSelectionFrames,
  scaleMultiSelectionFrames,
  type MultiSelectionTransformEntry,
} from "./multi-selection-transform";
import { startPointerDragLifecycle } from "./pointer-drag-lifecycle";
import { createSingleCommitGesture } from "./single-commit-gesture";
import type {
  ConnectorEndpointHandle,
  CropHandlePosition,
  ResizeHandlePosition,
} from "./slide-canvas";
import {
  buildKeyboardConnectorNodePresentation,
  connectorFrameForEndpointsPresentation,
  cycleConnectorEndpointAnchorPresentation,
  isKeyboardConnectableNode,
  nextKeyboardConnectorTargetIdPresentation,
  selectedKeyboardConnectablePair,
  startKeyboardConnectorModePresentation,
} from "./stage-keyboard-interactions";
import {
  createNodeMovePreview,
  nodeMoveGestureDrafts,
  nodeMovePreviewsEqual,
  type ConnectorGestureDraft,
  type CropGestureDraft,
  type NodeMovePreview,
  type ResizeGestureDraft,
  type RotationGestureDraft,
} from "./stage-gesture-feedback";
import {
  canvasElementFromTarget,
  canvasRectFromEvent,
  isEditableTarget,
  isStageEditingHandleTarget,
  isStageHandleTarget,
  pointPctFromEvent,
  pointerMovedBeyondThreshold,
  shouldEnterInlineNodeEditOnClick,
} from "./stage-pointer-interactions";
import {
  nextActiveGroupIdForStageTarget,
  resolveProgressiveGroupTarget,
  resolveStageNodeTarget,
  type StageNodeInteractionTarget,
} from "./stage-targeting";
import {
  nextUnlockedContextLayerId,
  overlapContextLayers,
  stageNodeMenuLabel,
} from "./stage-context-menu";
import {
  adjacentNodeId,
  childIdsForGroup,
  findNodeById,
  layoutFramesExcluding,
  parentGroupIdForNode,
} from "./selection-traversal";
import {
  clearSelection,
  getSelectableNodes,
  selectNode,
  selectedNodeIds,
  setSelection as setSelectedNodeIds,
  toggleNode,
  type SelectionState,
} from "./selection-model";
import { pairDuplicatesAfterOriginals } from "./stage-duplicate";
import {
  connectorEndpointsEqual,
  nearestConnectorAnchor,
} from "./stage-connector-interactions";
import type { InlineTextInitialCaret } from "./inline-text-editor";
import type {
  ActiveConnectorEndpoint,
  ActiveCropHandle,
  ActiveResizeHandle,
  NodeMoveGestureDraft,
} from "./use-stage-interaction-controller";
import { canvasAspectRatio } from "./slide-editor-stage-fit";
import {
  applyAspectLock,
  clientAngleDegrees,
  clientDeltaPct,
  clampFrame,
  cropForHandleDrag,
  cropsEqual,
  frameCenterClientPoint,
  framesEqual,
  resizeFrame,
  snapRotationDegrees,
} from "./stage-overlay-geometry";

const CLICK_MOVE_THRESHOLD_PX = 4;

function hasUsableCanvasArea(
  rect: Pick<DOMRect, "width" | "height"> | null | undefined,
): rect is DOMRect {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function formatGuidePosition(positionPct: number): string {
  return Number.isInteger(positionPct)
    ? String(positionPct)
    : positionPct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function snappedGuideAnnouncement(
  guides: readonly StageGuide[],
): string | null {
  if (guides.length === 0) return null;
  const labels = guides.map(
    (guide) =>
      `${guide.axis === "x" ? "vertical" : "horizontal"} ${formatGuidePosition(
        guide.positionPct,
      )}%`,
  );
  return `Snapped to ${labels.join(" and ")}`;
}

/* node:coverage ignore next 28 */
type SetSelection = Dispatch<SetStateAction<SelectionState>>;

type PointerLikeEvent = Pick<
  MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
  "clientX" | "clientY" | "target"
>;

export function topLevelSelectedNodeIds(
  nodes: readonly SlideChildNode[],
  selectedIds: ReadonlySet<string>,
  insideSelectedGroup = false,
  result: string[] = [],
): string[] {
  for (const node of nodes) {
    const selected = selectedIds.has(node.id);
    if (selected && !insideSelectedGroup) result.push(node.id);
    if (node.type === "group") {
      topLevelSelectedNodeIds(
        node.children,
        selectedIds,
        insideSelectedGroup || selected,
        result,
      );
    }
  }
  return result;
}

export function nextAltClickOverlapNodeId(
  hits: readonly StageHitCandidate[],
  selectedIds: readonly string[],
): string | null {
  const candidates = overlapContextLayers(hits.map((hit) => hit.node));
  if (candidates.length === 0) return null;
  const selected = candidates.find((candidate) =>
    selectedIds.includes(candidate.id),
  );
  const currentNodeId = selected?.id ?? candidates[0]?.id;
  return currentNodeId
    ? nextUnlockedContextLayerId(candidates, currentNodeId)
    : null;
}

function collectTransformEntriesForNodeTree(
  node: SlideChildNode,
): MultiSelectionTransformEntry[] {
  const entries: MultiSelectionTransformEntry[] = node.layout
    ? [
        {
          id: node.id,
          frame: node.layout.frame,
          rotation: node.layout.rotation,
        },
      ]
    : [];
  if (node.type === "group") {
    for (const child of node.children) {
      entries.push(...collectTransformEntriesForNodeTree(child));
    }
  }
  return entries;
}

export function collectMovePreviewFrames(
  nodes: readonly SlideChildNode[],
  nodeIds: readonly string[],
): Map<string, LayoutBox["frame"]> {
  const frames = new Map<string, LayoutBox["frame"]>();
  for (const id of nodeIds) {
    const node = findNodeById(nodes, id);
    if (!node || node.locked) continue;
    for (const entry of collectTransformEntriesForNodeTree(node)) {
      frames.set(entry.id, entry.frame);
    }
  }
  return frames;
}

interface ConnectorEndpointDragValue {
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  frame: LayoutBox["frame"];
}

function connectorEndpointDragValuesEqual(
  left: ConnectorEndpointDragValue,
  right: ConnectorEndpointDragValue,
): boolean {
  return (
    connectorEndpointsEqual(left.from, right.from) &&
    connectorEndpointsEqual(left.to, right.to) &&
    framesEqual(left.frame, right.frame)
  );
}

export function normalizeConnectorEndpointDragValue({
  nodes,
  connectorFrame,
  from,
  to,
  fromPoint: fromPointOverride,
  toPoint: toPointOverride,
}: {
  nodes: readonly SlideChildNode[];
  connectorFrame: LayoutBox["frame"];
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
}): ConnectorEndpointDragValue {
  const resolveNodeFrame = (nodeId: string) =>
    findNodeById(nodes, nodeId)?.layout?.frame;
  const fromPoint =
    fromPointOverride ??
    connectorEndpointSlidePoint(from, connectorFrame, resolveNodeFrame);
  const toPoint =
    toPointOverride ??
    connectorEndpointSlidePoint(to, connectorFrame, resolveNodeFrame);
  const frame = connectorFrameFromSlidePoints(fromPoint, toPoint);
  return {
    frame,
    from:
      fromPointOverride || from.kind === "point"
        ? connectorEndpointFromSlidePoint(fromPoint, frame)
        : from,
    to:
      toPointOverride || to.kind === "point"
        ? connectorEndpointFromSlidePoint(toPoint, frame)
        : to,
  };
}

/* node:coverage ignore next 1462 */
export interface StageGestureControllerArgs {
  activeSlide: SlideNode | undefined;
  activeSlideTree: ResolvedSlideRenderTree | null;
  activeGroupId: string | null;
  deck: Deck;
  firstSelectedId: string | undefined;
  focusedNodeId: string | null;
  inlineEditNodeId: string | null;
  keyboardConnectorMode: { sourceId: string; targetId: string | null } | null;
  marqueeFrame: unknown | null;
  selectedIds: string[];
  selectedNode: SlideChildNode | undefined;
  selection: SelectionState;
  snapToGuides: boolean;
  customGuides: readonly StageGuideInput[];
  stageInteractionsBlocked: boolean;
  tableEditingNodeId: string | null;
  draggingStage: boolean;
  activeResizeHandle: unknown | null;
  activeCropHandle: unknown | null;
  activeRotationNodeId: string | null;
  activeConnectorEndpoint: unknown | null;
  enterInlineEdit: (
    nodeId: string,
    initialCaret?: InlineTextInitialCaret,
  ) => void;
  requestInlineEditCommit: () => void;
  clearTableEditing: () => void;
  focusSelectedNodeSoon: (nodeId: string) => void;
  focusStageNodeSoon: (nodeId: string) => void;
  handleCopyNodes: () => void;
  handleCutNodes: () => void;
  handleDeleteSelection: () => void;
  handleEnterTableEdit: (nodeId?: string) => void;
  handleGroupSelection: () => void;
  handlePasteNodes: () => void;
  handleUngroupSelection: () => void;
  isInlineEditableNode: (
    node: SlideChildNode,
  ) => node is Extract<SlideChildNode, { type: "text" }>;
  initialCaretFromNodeClick: (
    node: Extract<SlideChildNode, { type: "text" }>,
    event: Pick<MouseEvent | ReactPointerEvent, "clientX" | "clientY">,
  ) => InlineTextInitialCaret;
  onDeckChange: (deck: Deck) => void;
  onRedo?: () => void;
  onUndo?: () => void;
  setActiveGroupId: Dispatch<SetStateAction<string | null>>;
  setActiveConnectorEndpoint: Dispatch<
    SetStateAction<ActiveConnectorEndpoint | null>
  >;
  setActiveCropHandle: Dispatch<SetStateAction<ActiveCropHandle | null>>;
  setActiveResizeHandle: Dispatch<SetStateAction<ActiveResizeHandle | null>>;
  setActiveRotationNodeId: Dispatch<SetStateAction<string | null>>;
  setConnectorGestureDraft: Dispatch<
    SetStateAction<ConnectorGestureDraft | null>
  >;
  setCropGestureDraft: Dispatch<SetStateAction<CropGestureDraft | null>>;
  setDraggingStage: Dispatch<SetStateAction<boolean>>;
  setFocusedNodeId: Dispatch<SetStateAction<string | null>>;
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
  setKeyboardConnectorMode: Dispatch<
    SetStateAction<{ sourceId: string; targetId: string | null } | null>
  >;
  setMarqueeFrame: Dispatch<
    SetStateAction<{ x: number; y: number; w: number; h: number } | null>
  >;
  setMoveGestureDraft: Dispatch<SetStateAction<NodeMoveGestureDraft | null>>;
  setResizeGestureDraft: Dispatch<SetStateAction<ResizeGestureDraft | null>>;
  setRotationGestureDraft: Dispatch<
    SetStateAction<RotationGestureDraft | null>
  >;
  setSelection: SetSelection;
  onToggleShortcutHelp: () => void;
  setSlideHovered: Dispatch<SetStateAction<boolean>>;
  setStageAnnouncement: Dispatch<SetStateAction<string>>;
  setStageGuides: Dispatch<SetStateAction<StageGuide[]>>;
  suppressNextStageClick: () => void;
  semanticHitsFromEvent: (
    event: PointerLikeEvent,
    options?: {
      includeLocked?: boolean;
      order?: "semantic" | "visual";
      selectedNodeBonus?: boolean;
    },
  ) => StageHitCandidate[];
  semanticTargetFromHits: (
    hits: readonly StageHitCandidate[],
  ) => StageNodeInteractionTarget | null;
}

export interface StageGestureController {
  handleConnectorEndpointPointerDown: (
    nodeId: string,
    endpoint: ConnectorEndpointHandle,
    event: ReactPointerEvent,
  ) => void;
  handleCropHandlePointerDown: (
    nodeId: string,
    handle: CropHandlePosition,
    event: ReactPointerEvent,
  ) => void;
  handleEditorKeyDown: (event: StageKeyboardEvent) => void;
  handleMultiResizeHandlePointerDown: (
    handle: ResizeHandlePosition,
    event: ReactPointerEvent,
  ) => void;
  handleMultiRotationHandlePointerDown: (event: ReactPointerEvent) => void;
  handleNodePointerDown: (nodeId: string, event: ReactPointerEvent) => void;
  handleResizeHandlePointerDown: (
    nodeId: string,
    handle: ResizeHandlePosition,
    event: ReactPointerEvent,
  ) => void;
  handleRotationHandlePointerDown: (
    nodeId: string,
    event: ReactPointerEvent,
  ) => void;
  handleStagePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleStagePointerLeave: () => void;
  handleStagePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

type StageKeyboardEvent = {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  preventDefault: () => void;
  shiftKey: boolean;
  target: EventTarget | null;
};

export function useStageGestureController(
  args: StageGestureControllerArgs,
): StageGestureController {
  const {
    activeSlide,
    activeSlideTree,
    activeGroupId,
    deck,
    firstSelectedId,
    focusedNodeId,
    inlineEditNodeId,
    keyboardConnectorMode,
    marqueeFrame,
    selectedIds,
    selectedNode,
    selection,
    snapToGuides,
    customGuides,
    stageInteractionsBlocked,
    tableEditingNodeId,
    draggingStage,
    activeResizeHandle,
    activeCropHandle,
    activeRotationNodeId,
    activeConnectorEndpoint,
    enterInlineEdit,
    requestInlineEditCommit,
    clearTableEditing,
    focusSelectedNodeSoon,
    focusStageNodeSoon,
    handleCopyNodes,
    handleCutNodes,
    handleDeleteSelection,
    handleEnterTableEdit,
    handleGroupSelection,
    handlePasteNodes,
    handleUngroupSelection,
    isInlineEditableNode,
    initialCaretFromNodeClick,
    onDeckChange,
    onRedo,
    onUndo,
    setActiveGroupId,
    setActiveConnectorEndpoint,
    setActiveCropHandle,
    setActiveResizeHandle,
    setActiveRotationNodeId,
    setConnectorGestureDraft,
    setCropGestureDraft,
    setDraggingStage,
    setFocusedNodeId,
    setHoveredNodeId,
    setKeyboardConnectorMode,
    setMarqueeFrame,
    setMoveGestureDraft,
    setResizeGestureDraft,
    setRotationGestureDraft,
    setSelection,
    onToggleShortcutHelp,
    setSlideHovered,
    setStageAnnouncement,
    setStageGuides,
    suppressNextStageClick,
    semanticHitsFromEvent,
    semanticTargetFromHits,
  } = args;

  function applyStageTargetContext(target: StageNodeInteractionTarget) {
    const nextActiveGroupId = nextActiveGroupIdForStageTarget({
      currentActiveGroupId: activeGroupId,
      target,
    });
    if (nextActiveGroupId !== activeGroupId) {
      setActiveGroupId(nextActiveGroupId);
    }
  }

  function selectTopFromHits(hits: readonly StageHitCandidate[]) {
    const target = semanticTargetFromHits(hits);
    if (target) {
      setSelection((s) => setSelectedNodeIds(s, [target.nodeId]));
      setFocusedNodeId(target.nodeId);
      focusSelectedNodeSoon(target.nodeId);
      applyStageTargetContext(target);
      const node = activeSlide
        ? findNodeById(activeSlide.children, target.nodeId)
        : undefined;
      if (node) {
        setStageAnnouncement(`${stageNodeMenuLabel(node)} selected`);
      }
    }
  }

  function selectNodeFromHits(
    nodeId: string,
    hits: readonly StageHitCandidate[],
  ) {
    const node = activeSlide
      ? findNodeById(activeSlide.children, nodeId)
      : null;
    setSelection((s) => setSelectedNodeIds(s, [nodeId]));
    setFocusedNodeId(nodeId);
    focusSelectedNodeSoon(nodeId);
    if (node && activeSlide) {
      applyStageTargetContext({
        node,
        nodeId,
        candidateIds: hits.map((hit) => hit.node.id),
        parentGroupId: parentGroupIdForNode(activeSlide.children, nodeId),
      });
    }
    if (node) {
      setStageAnnouncement(`${stageNodeMenuLabel(node)} selected`);
    }
  }

  function insertKeyboardConnector(
    from: SlideChildNode & { layout: LayoutBox },
    to: SlideChildNode & { layout: LayoutBox },
  ) {
    if (!activeSlide) return;
    const result = insertNode(
      deck,
      activeSlide.id,
      buildKeyboardConnectorNodePresentation({
        from,
        to,
        zIndex: nextLayeredZIndex(activeSlide, "connector"),
      }),
    );
    onDeckChange(result.deck);
    setKeyboardConnectorMode(null);
    setSelection((s) => setSelectedNodeIds(s, [result.nodeId]));
    setActiveGroupId(null);
    focusSelectedNodeSoon(result.nodeId);
    setStageAnnouncement(
      `Connected ${stageNodeMenuLabel(from)} to ${stageNodeMenuLabel(to)}`,
    );
  }

  function handleKeyboardConnectorModeKey(event: StageKeyboardEvent): boolean {
    if (!activeSlide || !keyboardConnectorMode) return false;
    const source = findNodeById(
      activeSlide.children,
      keyboardConnectorMode.sourceId,
    );
    if (!source || !isKeyboardConnectableNode(source)) {
      setKeyboardConnectorMode(null);
      return false;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setKeyboardConnectorMode(null);
      setSelection((s) => setSelectedNodeIds(s, [source.id]));
      focusSelectedNodeSoon(source.id);
      setStageAnnouncement("Connector mode canceled");
      return true;
    }
    if (event.key === "Enter") {
      const target = keyboardConnectorMode.targetId
        ? findNodeById(activeSlide.children, keyboardConnectorMode.targetId)
        : undefined;
      if (target && isKeyboardConnectableNode(target)) {
        event.preventDefault();
        insertKeyboardConnector(source, target);
        return true;
      }
      return false;
    }
    const direction =
      event.key === "Tab"
        ? event.shiftKey
          ? -1
          : 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 1
            : null;
    if (direction === null) return false;
    event.preventDefault();
    const targetId = nextKeyboardConnectorTargetIdPresentation(
      activeSlide.children,
      source.id,
      keyboardConnectorMode.targetId,
      direction,
    );
    if (!targetId) return true;
    setKeyboardConnectorMode({ sourceId: source.id, targetId });
    setSelection((s) => setSelectedNodeIds(s, [targetId, source.id]));
    setFocusedNodeId(targetId);
    focusSelectedNodeSoon(targetId);
    const target = findNodeById(activeSlide.children, targetId);
    setStageAnnouncement(
      target
        ? `Connector target ${stageNodeMenuLabel(target)}. Press Enter to connect.`
        : "Connector mode target selected",
    );
    return true;
  }

  function handleKeyboardConnectorShortcut(event: StageKeyboardEvent) {
    if (!activeSlide) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key.toLowerCase() !== "c") return false;
    const selectedConnector =
      selectedIds.length <= 1 && selectedNode?.type === "connector"
        ? selectedNode
        : undefined;
    if (selectedConnector?.layout) {
      const endpointKey = event.shiftKey ? "from" : "to";
      const nextEndpoint = cycleConnectorEndpointAnchorPresentation(
        selectedConnector.content[endpointKey],
      );
      if (nextEndpoint !== selectedConnector.content[endpointKey]) {
        event.preventDefault();
        const nextFrame = connectorFrameForEndpointsPresentation(
          activeSlide.children,
          selectedConnector.layout.frame,
          endpointKey === "from"
            ? nextEndpoint
            : selectedConnector.content.from,
          endpointKey === "to" ? nextEndpoint : selectedConnector.content.to,
        );
        const updatedContent = updateNodeContent(
          deck,
          activeSlide.id,
          selectedConnector.id,
          { [endpointKey]: nextEndpoint },
        );
        onDeckChange(
          updateNodeLayout(
            updatedContent,
            activeSlide.id,
            selectedConnector.id,
            {
              frame: nextFrame,
            },
          ),
        );
        focusSelectedNodeSoon(selectedConnector.id);
        setStageAnnouncement(
          nextEndpoint.kind === "node"
            ? `Reattached connector ${endpointKey} endpoint to ${nextEndpoint.anchor}`
            : `Connector ${endpointKey} endpoint unchanged`,
        );
      }
      return true;
    }

    const pair = selectedKeyboardConnectablePair(
      activeSlide.children,
      selectedIds,
    );
    if (pair) {
      event.preventDefault();
      insertKeyboardConnector(pair[0], pair[1]);
      return true;
    }

    const connectorSource =
      selectedIds.length <= 1 &&
      selectedNode &&
      isKeyboardConnectableNode(selectedNode)
        ? selectedNode
        : null;
    if (connectorSource) {
      event.preventDefault();
      const mode = startKeyboardConnectorModePresentation(
        activeSlide.children,
        connectorSource.id,
      );
      if (!mode?.targetId) {
        setStageAnnouncement("No connector targets available");
        return true;
      }
      setKeyboardConnectorMode(mode);
      setSelection((s) =>
        setSelectedNodeIds(s, [mode.targetId!, connectorSource.id]),
      );
      setFocusedNodeId(mode.targetId);
      focusSelectedNodeSoon(mode.targetId);
      const target = findNodeById(activeSlide.children, mode.targetId);
      setStageAnnouncement(
        target
          ? `Connector target ${stageNodeMenuLabel(target)}. Press Enter to connect.`
          : "Connector mode started",
      );
      return true;
    }
    return false;
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !activeSlide ||
      stageInteractionsBlocked ||
      event.button !== 0 ||
      isEditableTarget(event.target)
    ) {
      return;
    }
    if (isStageHandleTarget(event.target)) return;
    const canvasElement = canvasElementFromTarget(event.target);
    if (!canvasElement) return;
    const rect = canvasElement.getBoundingClientRect();
    if (!hasUsableCanvasArea(rect)) return;

    if (inlineEditNodeId) requestInlineEditCommit();

    event.preventDefault();
    const start = pointPctFromEvent(event, rect);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const baseSelection = new Set(selectedIds);
    setMarqueeFrame({ ...start, w: 0, h: 0 });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        const frame = normalizeSelectionFrame(
          start,
          pointPctFromEvent(moveEvent, rect),
        );
        setMarqueeFrame(frame);
        const ids = selectNodesInFrame(activeSlide.children, frame);
        setSelection((selectionState) =>
          setSelectedNodeIds(
            selectionState,
            additive ? [...baseSelection, ...ids] : ids,
          ),
        );
      },
      onEnd: (_endEvent, reason) => {
        setMarqueeFrame((frame) => {
          const moved = frame && (frame.w > 0.5 || frame.h > 0.5);
          if (reason === "up" && (moved || additive)) {
            suppressNextStageClick();
          }
          return null;
        });
      },
    });
  }

  function handleStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !activeSlide ||
      marqueeFrame ||
      draggingStage ||
      activeResizeHandle ||
      activeCropHandle ||
      activeRotationNodeId ||
      activeConnectorEndpoint ||
      stageInteractionsBlocked ||
      isEditableTarget(event.target) ||
      isStageEditingHandleTarget(event.target)
    ) {
      setHoveredNodeId((current) => (current === null ? current : null));
      setSlideHovered((current) => (current === false ? current : false));
      return;
    }
    const hits = semanticHitsFromEvent(event, {
      order: "visual",
      selectedNodeBonus: false,
    });
    const hoverTarget = semanticTargetFromHits(hits);
    const hoveredId = hoverTarget?.nodeId;
    setHoveredNodeId((current) =>
      current === (hoveredId ?? null) ? current : (hoveredId ?? null),
    );
    const hoveringSlide = hoveredId === undefined && hits.length === 0;
    setSlideHovered((current) =>
      current === hoveringSlide ? current : hoveringSlide,
    );
  }

  function handleStagePointerLeave() {
    setHoveredNodeId((current) => (current === null ? current : null));
    setSlideHovered((current) => (current === false ? current : false));
  }

  function handleCropHandlePointerDown(
    nodeId: string,
    handle: CropHandlePosition,
    event: ReactPointerEvent,
  ) {
    if (!activeSlide || event.button !== 0) return;
    const node = findNodeById(activeSlide.children, nodeId);
    if (!node || node.type !== "image" || node.locked) return;
    const rect = canvasRectFromEvent(event);
    const frame = node.layout?.frame;
    if (!rect || !frame || frame.w <= 0 || frame.h <= 0) return;
    const start = pointPctFromEvent(event, rect);
    const startCrop: ImageCrop = {
      top: node.content.crop?.top ?? 0,
      right: node.content.crop?.right ?? 0,
      bottom: node.content.crop?.bottom ?? 0,
      left: node.content.crop?.left ?? 0,
    };

    event.preventDefault();
    event.stopPropagation();
    setActiveCropHandle({ nodeId, handle });
    setSelection((s) => setSelectedNodeIds(s, [nodeId]));
    const gesture = createSingleCommitGesture<ImageCrop>({
      initialValue: startCrop,
      equals: cropsEqual,
      onPreview: (crop) => setCropGestureDraft(crop ? { nodeId, crop } : null),
      onCommit: (crop) =>
        onDeckChange(updateNodeContent(deck, activeSlide.id, nodeId, { crop })),
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        const nextCrop = cropForHandleDrag({
          handle,
          startCrop,
          startPoint: start,
          nextPoint: pointPctFromEvent(moveEvent, rect),
          frame,
        });
        gesture.update(nextCrop);
        setStageAnnouncement(`Cropping image ${handle}`);
      },
      onEnd: () => {
        gesture.finish();
        setActiveCropHandle(null);
      },
    });
  }

  function handleAltNodePointerDown(
    nodeId: string,
    event: ReactPointerEvent,
    hits: readonly StageHitCandidate[],
  ) {
    if (!activeSlide) return;
    event.preventDefault();
    event.stopPropagation();

    const target = resolveStageNodeTarget({
      hits,
      nodes: activeSlide.children,
      fallbackNodeId: nodeId,
    });
    const rect = canvasRectFromEvent(event);
    if (!target || !hasUsableCanvasArea(rect)) {
      selectTopFromHits(hits);
      return;
    }

    const targetNodeId = target.nodeId;
    const dragIds = selectedIds.includes(targetNodeId)
      ? topLevelSelectedNodeIds(activeSlide.children, new Set(selectedIds))
      : [targetNodeId];
    const originalFrames = new Map<string, LayoutBox["frame"]>();
    for (const id of dragIds) {
      const node = findNodeById(activeSlide.children, id);
      if (!node?.layout || node.locked) continue;
      originalFrames.set(id, node.layout.frame);
    }
    if (originalFrames.size === 0) {
      selectTopFromHits(hits);
      return;
    }
    const alignmentGuides = [
      ...alignmentGuidesForFrames(
        layoutFramesExcluding(activeSlide.children, new Set(dragIds)),
      ),
      ...customGuides,
    ];

    const startX = event.clientX;
    const startY = event.clientY;
    let dragThresholdPassed = false;
    let moved = false;
    let latestPreview: NodeMovePreview | null = null;
    const gesture = createSingleCommitGesture<NodeMovePreview>({
      initialValue: {
        patches: new Map<string, Partial<LayoutBox>>(),
        guides: [],
      },
      equals: nodeMovePreviewsEqual,
      onPreview: (preview) => {
        setMoveGestureDraft(nodeMoveGestureDrafts(preview));
        setStageGuides(preview?.guides ?? []);
      },
      onCommit: () => undefined,
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        const preview = createNodeMovePreview({
          startClientX: startX,
          startClientY: startY,
          nextClientX: moveEvent.clientX,
          nextClientY: moveEvent.clientY,
          rectWidth: rect.width,
          rectHeight: rect.height,
          originalFrames,
          alignmentGuides,
          snapToGuides,
          lockAxis: moveEvent.shiftKey,
        });
        if (!preview) return;
        moved = true;
        latestPreview = preview;
        if (!dragThresholdPassed) {
          dragThresholdPassed = true;
          setDraggingStage(true);
        }
        gesture.update(preview);
      },
      onEnd: (_endEvent, reason) => {
        gesture.finish();
        setDraggingStage(false);
        if (reason !== "up") return;
        if (moved && latestPreview) {
          const snapAnnouncement = snappedGuideAnnouncement(
            latestPreview.guides,
          );
          if (snapAnnouncement) setStageAnnouncement(snapAnnouncement);
          suppressNextStageClick();
          const duplication = duplicateNodes(deck, activeSlide.id, dragIds);
          if (duplication.duplicatedIds.length === 0) return;
          const nextChildren =
            duplication.deck.slides.find(
              (candidate) => candidate.id === activeSlide.id,
            )?.children ?? [];
          const pairs = pairDuplicatesAfterOriginals(
            nextChildren,
            new Set(dragIds),
            new Set(duplication.duplicatedIds),
          );
          const framePatches = new Map<string, Partial<LayoutBox>>();
          for (const [originalId, duplicateId] of pairs) {
            const frame = latestPreview.patches.get(originalId)?.frame;
            if (frame) framePatches.set(duplicateId, { frame });
          }
          const positioned =
            framePatches.size > 0
              ? updateNodeLayouts(
                  duplication.deck,
                  activeSlide.id,
                  framePatches,
                )
              : duplication.deck;
          onDeckChange(positioned);
          const duplicateIds = [...pairs.values()];
          if (duplicateIds.length > 0) {
            setSelection((s) => setSelectedNodeIds(s, duplicateIds));
            setActiveGroupId(null);
            focusSelectedNodeSoon(duplicateIds[0]);
          }
          setStageAnnouncement(
            `Duplicated ${duplicateIds.length} ${
              duplicateIds.length === 1 ? "node" : "nodes"
            }`,
          );
        } else {
          const nextOverlapNodeId = nextAltClickOverlapNodeId(
            hits,
            selectedIds,
          );
          if (nextOverlapNodeId) {
            selectNodeFromHits(nextOverlapNodeId, hits);
          } else {
            selectTopFromHits(hits);
          }
        }
      },
    });
  }

  function handleNodePointerDown(nodeId: string, event: ReactPointerEvent) {
    if (!activeSlide || event.button !== 0 || isEditableTarget(event.target)) {
      return;
    }
    const hits = semanticHitsFromEvent(event, {
      order: "visual",
      selectedNodeBonus: false,
    });
    if (event.altKey) {
      handleAltNodePointerDown(nodeId, event, hits);
      return;
    }

    const resolvedTarget = resolveStageNodeTarget({
      hits,
      nodes: activeSlide.children,
      fallbackNodeId: nodeId,
    });
    const target = resolvedTarget
      ? resolveProgressiveGroupTarget({
          target: resolvedTarget,
          nodes: activeSlide.children,
          selectedNodeIds: selectedIds,
          activeGroupId,
        })
      : null;
    if (!target) return;
    const targetNodeId = target.nodeId;
    if (inlineEditNodeId && inlineEditNodeId !== targetNodeId) {
      requestInlineEditCommit();
    }
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const wasOnlySelectedNode =
      selectedIds.length === 1 && selectedIds[0] === targetNodeId;
    const targetNode = target.node;
    const selectedCountAtStart = selectedIds.length;
    const clickEditNode =
      targetNode && isInlineEditableNode(targetNode) ? targetNode : null;
    const nextSelection = selectedIds.includes(targetNodeId)
      ? selection
      : selectNode(selection, targetNodeId, additive);
    const dragIds = topLevelSelectedNodeIds(
      activeSlide.children,
      new Set(selectedNodeIds(nextSelection)),
    );
    setSelection(nextSelection);
    setFocusedNodeId(targetNodeId);
    applyStageTargetContext(target);

    event.preventDefault();
    event.stopPropagation();

    const rect = canvasRectFromEvent(event);
    if (!hasUsableCanvasArea(rect)) return;

    const originalFrames = collectMovePreviewFrames(
      activeSlide.children,
      dragIds,
    );
    if (originalFrames.size === 0) return;
    const alignmentGuides = [
      ...alignmentGuidesForFrames(
        layoutFramesExcluding(
          activeSlide.children,
          new Set(originalFrames.keys()),
        ),
      ),
      ...customGuides,
    ];

    const startX = event.clientX;
    const startY = event.clientY;
    let dragThresholdPassed = false;
    let pointerMovedPastClickThreshold = false;
    let latestPreview: NodeMovePreview | null = null;
    const gesture = createSingleCommitGesture<NodeMovePreview>({
      initialValue: {
        patches: new Map<string, Partial<LayoutBox>>(),
        guides: [],
      },
      equals: nodeMovePreviewsEqual,
      onPreview: (preview) => {
        setMoveGestureDraft(nodeMoveGestureDrafts(preview));
        setStageGuides(preview?.guides ?? []);
      },
      onCommit: (preview) =>
        onDeckChange(updateNodeLayouts(deck, activeSlide.id, preview.patches)),
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        if (
          !pointerMovedPastClickThreshold &&
          pointerMovedBeyondThreshold({
            startX,
            startY,
            nextX: moveEvent.clientX,
            nextY: moveEvent.clientY,
            thresholdPx: CLICK_MOVE_THRESHOLD_PX,
          })
        ) {
          pointerMovedPastClickThreshold = true;
        }
        const preview = createNodeMovePreview({
          startClientX: startX,
          startClientY: startY,
          nextClientX: moveEvent.clientX,
          nextClientY: moveEvent.clientY,
          rectWidth: rect.width,
          rectHeight: rect.height,
          originalFrames,
          alignmentGuides,
          snapToGuides: snapToGuides && !moveEvent.altKey,
          lockAxis: moveEvent.shiftKey,
        });
        if (!preview) return;
        latestPreview = preview;
        if (!dragThresholdPassed) {
          dragThresholdPassed = true;
          setHoveredNodeId(null);
          setDraggingStage(true);
        }
        gesture.update(preview);
      },
      onEnd: (endEvent, reason) => {
        gesture.finish();
        const endedPastClickThreshold = pointerMovedBeyondThreshold({
          startX,
          startY,
          nextX: endEvent.clientX,
          nextY: endEvent.clientY,
          thresholdPx: CLICK_MOVE_THRESHOLD_PX,
        });
        const moved = pointerMovedPastClickThreshold || endedPastClickThreshold;
        if (reason === "up" && moved) {
          const snapAnnouncement = snappedGuideAnnouncement(
            latestPreview?.guides ?? [],
          );
          if (snapAnnouncement) setStageAnnouncement(snapAnnouncement);
          suppressNextStageClick();
        }
        if (
          reason === "up" &&
          clickEditNode &&
          shouldEnterInlineNodeEditOnClick({
            mode: "move",
            moved,
            wasPrimarySelected: wasOnlySelectedNode,
            selectedCount: selectedCountAtStart,
            isInlineEditable: true,
            locked: clickEditNode.locked,
          })
        ) {
          enterInlineEdit(
            targetNodeId,
            initialCaretFromNodeClick(clickEditNode, {
              clientX: startX,
              clientY: startY,
            }),
          );
        }
        setHoveredNodeId(null);
        setDraggingStage(false);
      },
    });
  }

  function handleResizeHandlePointerDown(
    nodeId: string,
    handle: ResizeHandlePosition,
    event: ReactPointerEvent,
  ) {
    if (!activeSlide || event.button !== 0) return;
    const node = findNodeById(activeSlide.children, nodeId);
    if (!node?.layout || node.locked) return;
    const rect = canvasRectFromEvent(event);
    if (!hasUsableCanvasArea(rect)) return;

    event.preventDefault();
    event.stopPropagation();
    setActiveResizeHandle({ nodeId, handle });
    const startX = event.clientX;
    const startY = event.clientY;
    const originalFrame = node.layout.frame;
    let lastSnappedGuides: StageGuide[] = [];
    const alignmentGuides = [
      ...alignmentGuidesForFrames(
        layoutFramesExcluding(activeSlide.children, new Set([nodeId])),
      ),
      ...customGuides,
    ];

    if (node.type === "group") {
      const entries = collectTransformEntriesForNodeTree(node);
      const excludedIds = new Set(entries.map((entry) => entry.id));
      const groupAlignmentGuides = [
        ...alignmentGuidesForFrames(
          layoutFramesExcluding(activeSlide.children, excludedIds),
        ),
        ...customGuides,
      ];
      const gesture = createSingleCommitGesture<NodeMovePreview>({
        initialValue: { patches: new Map(), guides: [] },
        equals: nodeMovePreviewsEqual,
        onPreview: (preview) => {
          setMoveGestureDraft(nodeMoveGestureDrafts(preview));
          setStageGuides(preview?.guides ?? []);
        },
        onCommit: (preview) => {
          const groupPatch = preview.patches.get(nodeId);
          if (!groupPatch) return;
          onDeckChange(
            updateNodeLayouts(
              deck,
              activeSlide.id,
              new Map([[nodeId, groupPatch]]),
            ),
          );
        },
      });

      startPointerDragLifecycle(event, {
        onMove: (moveEvent) => {
          const delta = clientDeltaPct({
            startClientX: startX,
            startClientY: startY,
            nextClientX: moveEvent.clientX,
            nextClientY: moveEvent.clientY,
            rectWidth: rect.width,
            rectHeight: rect.height,
          });
          const constrainAspect =
            node.layout?.constraints?.preserveAspectRatio === true ||
            moveEvent.shiftKey;
          const resized = resizeFrame(originalFrame, handle, delta.x, delta.y);
          const nextFrame = constrainAspect
            ? applyAspectLock(originalFrame, resized)
            : resized;
          const snapped =
            snapToGuides && !moveEvent.altKey
              ? snapFrameToStageGuides(nextFrame, 0.75, groupAlignmentGuides)
              : { frame: nextFrame, guides: [] as StageGuide[] };
          lastSnappedGuides = snapped.guides;
          gesture.update({
            patches: scaleMultiSelectionFrames(
              entries,
              originalFrame,
              snapped.frame,
            ),
            guides: snapped.guides,
          });
        },
        onEnd: () => {
          gesture.finish();
          const snapAnnouncement = snappedGuideAnnouncement(lastSnappedGuides);
          if (snapAnnouncement) setStageAnnouncement(snapAnnouncement);
          setMoveGestureDraft(null);
          setActiveResizeHandle(null);
          setStageGuides([]);
        },
      });
      return;
    }

    const gesture = createSingleCommitGesture<LayoutBox["frame"]>({
      initialValue: originalFrame,
      equals: framesEqual,
      onPreview: (frame) =>
        setResizeGestureDraft(frame ? { nodeId, frame } : null),
      onCommit: (frame) =>
        onDeckChange(updateNodeLayout(deck, activeSlide.id, nodeId, { frame })),
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        const delta = clientDeltaPct({
          startClientX: startX,
          startClientY: startY,
          nextClientX: moveEvent.clientX,
          nextClientY: moveEvent.clientY,
          rectWidth: rect.width,
          rectHeight: rect.height,
        });
        const constrainAspect =
          node.layout?.constraints?.preserveAspectRatio === true ||
          moveEvent.shiftKey;
        const resized = resizeFrame(originalFrame, handle, delta.x, delta.y);
        const nextFrame = constrainAspect
          ? applyAspectLock(originalFrame, resized)
          : resized;
        const snapped =
          snapToGuides && !moveEvent.altKey
            ? snapFrameToStageGuides(nextFrame, 0.75, alignmentGuides)
            : { frame: nextFrame, guides: [] as StageGuide[] };
        lastSnappedGuides = snapped.guides;
        setStageGuides(snapped.guides);
        gesture.update(snapped.frame);
      },
      onEnd: () => {
        gesture.finish();
        const snapAnnouncement = snappedGuideAnnouncement(lastSnappedGuides);
        if (snapAnnouncement) setStageAnnouncement(snapAnnouncement);
        setActiveResizeHandle(null);
        setStageGuides([]);
      },
    });
  }

  function selectedTransformEntries(): MultiSelectionTransformEntry[] {
    if (!activeSlide) return [];
    const selected = topLevelSelectedNodeIds(
      activeSlide.children,
      new Set(selectedIds),
    );
    return selected.flatMap((nodeId) => {
      const node = findNodeById(activeSlide.children, nodeId);
      if (!node?.layout || node.locked) return [];
      return [
        {
          id: node.id,
          frame: node.layout.frame,
          rotation: node.layout.rotation,
        },
      ];
    });
  }

  function handleMultiResizeHandlePointerDown(
    handle: ResizeHandlePosition,
    event: ReactPointerEvent,
  ) {
    if (!activeSlide || event.button !== 0) return;
    const entries = selectedTransformEntries();
    if (entries.length < 2) return;
    const startBounds = multiSelectionBounds(entries);
    const rect = canvasRectFromEvent(event);
    if (!startBounds || !hasUsableCanvasArea(rect)) return;

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let latestPreview: NodeMovePreview | null = null;
    const selectedSet = new Set(entries.map((entry) => entry.id));
    const alignmentGuides = [
      ...alignmentGuidesForFrames(
        layoutFramesExcluding(activeSlide.children, selectedSet),
      ),
      ...customGuides,
    ];
    const gesture = createSingleCommitGesture<NodeMovePreview>({
      initialValue: { patches: new Map(), guides: [] },
      equals: nodeMovePreviewsEqual,
      onPreview: (preview) => {
        setMoveGestureDraft(nodeMoveGestureDrafts(preview));
        setStageGuides(preview?.guides ?? []);
      },
      onCommit: (preview) =>
        onDeckChange(updateNodeLayouts(deck, activeSlide.id, preview.patches)),
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        if (
          !dragging &&
          pointerMovedBeyondThreshold({
            startX,
            startY,
            nextX: moveEvent.clientX,
            nextY: moveEvent.clientY,
            thresholdPx: CLICK_MOVE_THRESHOLD_PX,
          })
        ) {
          dragging = true;
          setHoveredNodeId(null);
          setDraggingStage(true);
        }
        if (!dragging) return;
        const delta = clientDeltaPct({
          startClientX: startX,
          startClientY: startY,
          nextClientX: moveEvent.clientX,
          nextClientY: moveEvent.clientY,
          rectWidth: rect.width,
          rectHeight: rect.height,
        });
        const rawBounds = resizeFrame(startBounds, handle, delta.x, delta.y);
        const nextBounds = moveEvent.shiftKey
          ? applyAspectLock(startBounds, rawBounds)
          : rawBounds;
        const snapped =
          snapToGuides && !moveEvent.altKey
            ? snapFrameToStageGuides(nextBounds, 0.75, alignmentGuides)
            : { frame: nextBounds, guides: [] as StageGuide[] };
        latestPreview = {
          patches: scaleMultiSelectionFrames(
            entries,
            startBounds,
            snapped.frame,
          ),
          guides: snapped.guides,
        };
        gesture.update(latestPreview);
      },
      onEnd: () => {
        gesture.finish();
        const snapAnnouncement = snappedGuideAnnouncement(
          latestPreview?.guides ?? [],
        );
        if (snapAnnouncement) setStageAnnouncement(snapAnnouncement);
        setMoveGestureDraft(null);
        setStageGuides([]);
        setDraggingStage(false);
      },
    });
  }

  function handleMultiRotationHandlePointerDown(event: ReactPointerEvent) {
    if (!activeSlide || event.button !== 0) return;
    const entries = selectedTransformEntries();
    if (entries.length < 2) return;
    const startBounds = multiSelectionBounds(entries);
    const rect = canvasRectFromEvent(event);
    if (!startBounds || !hasUsableCanvasArea(rect)) return;
    const centerPct = {
      x: startBounds.x + startBounds.w / 2,
      y: startBounds.y + startBounds.h / 2,
    };
    const center = frameCenterClientPoint(startBounds, rect);
    const startAngle = clientAngleDegrees(
      { x: event.clientX, y: event.clientY },
      center,
    );
    let dragging = false;

    event.preventDefault();
    event.stopPropagation();
    const gesture = createSingleCommitGesture<NodeMovePreview>({
      initialValue: { patches: new Map(), guides: [] },
      equals: nodeMovePreviewsEqual,
      onPreview: (preview) =>
        setMoveGestureDraft(nodeMoveGestureDrafts(preview)),
      onCommit: (preview) =>
        onDeckChange(updateNodeLayouts(deck, activeSlide.id, preview.patches)),
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        if (
          !dragging &&
          pointerMovedBeyondThreshold({
            startX: event.clientX,
            startY: event.clientY,
            nextX: moveEvent.clientX,
            nextY: moveEvent.clientY,
            thresholdPx: CLICK_MOVE_THRESHOLD_PX,
          })
        ) {
          dragging = true;
          setHoveredNodeId(null);
          setDraggingStage(true);
        }
        if (!dragging) return;
        const angle = clientAngleDegrees(
          { x: moveEvent.clientX, y: moveEvent.clientY },
          center,
        );
        const delta = snapRotationDegrees(
          angle - startAngle,
          !moveEvent.altKey,
        );
        gesture.update({
          patches: rotateMultiSelectionFrames(
            entries,
            centerPct.x,
            centerPct.y,
            delta,
            canvasAspectRatio(deck),
          ),
          guides: [],
        });
        setStageAnnouncement(`Rotated selection ${Math.round(delta)} degrees`);
      },
      onEnd: () => {
        gesture.finish();
        setMoveGestureDraft(null);
        setDraggingStage(false);
      },
    });
  }

  function handleRotationHandlePointerDown(
    nodeId: string,
    event: ReactPointerEvent,
  ) {
    if (!activeSlide || event.button !== 0) return;
    const node = findNodeById(activeSlide.children, nodeId);
    if (!node?.layout || node.locked || node.type === "connector") return;
    const rect = canvasRectFromEvent(event);
    if (!hasUsableCanvasArea(rect)) return;
    const center = frameCenterClientPoint(node.layout.frame, rect);
    const startAngle = clientAngleDegrees(
      { x: event.clientX, y: event.clientY },
      center,
    );
    const startRotation = node.layout.rotation ?? 0;

    if (node.type === "group") {
      const entries = collectTransformEntriesForNodeTree(node);
      const centerPct = {
        x: node.layout.frame.x + node.layout.frame.w / 2,
        y: node.layout.frame.y + node.layout.frame.h / 2,
      };
      event.preventDefault();
      event.stopPropagation();
      setActiveRotationNodeId(nodeId);
      setSelection((s) => setSelectedNodeIds(s, [nodeId]));
      const gesture = createSingleCommitGesture<NodeMovePreview>({
        initialValue: { patches: new Map(), guides: [] },
        equals: nodeMovePreviewsEqual,
        onPreview: (preview) =>
          setMoveGestureDraft(nodeMoveGestureDrafts(preview)),
        onCommit: (preview) => {
          const groupPatch = preview.patches.get(nodeId);
          if (!groupPatch) return;
          onDeckChange(
            updateNodeLayouts(
              deck,
              activeSlide.id,
              new Map([[nodeId, groupPatch]]),
            ),
          );
        },
      });

      startPointerDragLifecycle(event, {
        onMove: (moveEvent) => {
          const angle = clientAngleDegrees(
            { x: moveEvent.clientX, y: moveEvent.clientY },
            center,
          );
          const delta = snapRotationDegrees(
            angle - startAngle,
            !moveEvent.altKey,
          );
          gesture.update({
            patches: rotateMultiSelectionFrames(
              entries,
              centerPct.x,
              centerPct.y,
              delta,
              canvasAspectRatio(deck),
            ),
            guides: [],
          });
          setStageAnnouncement(`Rotated group ${Math.round(delta)} degrees`);
        },
        onEnd: () => {
          gesture.finish();
          setMoveGestureDraft(null);
          setActiveRotationNodeId(null);
        },
      });
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setActiveRotationNodeId(nodeId);
    setSelection((s) => setSelectedNodeIds(s, [nodeId]));
    const gesture = createSingleCommitGesture<number>({
      initialValue: startRotation,
      onPreview: (rotation) =>
        setRotationGestureDraft(
          rotation === null ? null : { nodeId, rotation },
        ),
      onCommit: (rotation) =>
        onDeckChange(
          updateNodeRotation(deck, activeSlide.id, nodeId, rotation),
        ),
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        const angle = clientAngleDegrees(
          { x: moveEvent.clientX, y: moveEvent.clientY },
          center,
        );
        const rotation = snapRotationDegrees(
          startRotation + angle - startAngle,
          !moveEvent.altKey,
        );
        gesture.update(rotation);
        setStageAnnouncement(`Rotated to ${Math.round(rotation)} degrees`);
      },
      onEnd: () => {
        gesture.finish();
        setActiveRotationNodeId(null);
      },
    });
  }

  function handleConnectorEndpointPointerDown(
    nodeId: string,
    endpoint: ConnectorEndpointHandle,
    event: ReactPointerEvent,
  ) {
    if (!activeSlide || event.button !== 0) return;
    const node = findNodeById(activeSlide.children, nodeId);
    if (!node?.layout || node.type !== "connector" || node.locked) return;
    const rect = canvasRectFromEvent(event);
    if (!hasUsableCanvasArea(rect)) return;

    event.preventDefault();
    event.stopPropagation();
    setActiveConnectorEndpoint({ nodeId, endpoint });
    setSelection((s) => setSelectedNodeIds(s, [nodeId]));
    const connectorFrame = node.layout.frame;
    const startValue: ConnectorEndpointDragValue = {
      from: node.content.from,
      to: node.content.to,
      frame: connectorFrame,
    };
    const gesture = createSingleCommitGesture<ConnectorEndpointDragValue>({
      initialValue: startValue,
      equals: connectorEndpointDragValuesEqual,
      onPreview: (value) =>
        setConnectorGestureDraft(
          value
            ? {
                nodeId,
                endpoint,
                value: value[endpoint],
                frame: value.frame,
                endpoints: { from: value.from, to: value.to },
              }
            : null,
        ),
      onCommit: (value) => {
        const withContent = updateNodeContent(deck, activeSlide.id, nodeId, {
          from: value.from,
          to: value.to,
        });
        onDeckChange(
          updateNodeLayout(withContent, activeSlide.id, nodeId, {
            frame: value.frame,
          }),
        );
      },
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        const slidePoint = pointPctFromEvent(moveEvent, rect);
        const snapped = nearestConnectorAnchor(
          activeSlide.children,
          slidePoint,
          nodeId,
        );
        gesture.update(
          normalizeConnectorEndpointDragValue({
            nodes: activeSlide.children,
            connectorFrame,
            from:
              endpoint === "from"
                ? (snapped ?? node.content.from)
                : node.content.from,
            to:
              endpoint === "to"
                ? (snapped ?? node.content.to)
                : node.content.to,
            fromPoint: !snapped && endpoint === "from" ? slidePoint : undefined,
            toPoint: !snapped && endpoint === "to" ? slidePoint : undefined,
          }),
        );
        setStageAnnouncement(
          snapped?.kind === "node"
            ? `Connector ${endpoint} bound to ${snapped.anchor} anchor`
            : `Connector ${endpoint} moved`,
        );
      },
      onEnd: () => {
        gesture.finish();
        setActiveConnectorEndpoint(null);
      },
    });
  }

  function handleEditorKeyDown(event: StageKeyboardEvent) {
    if (inlineEditNodeId) return;
    if (isEditableTarget(event.target)) return;
    if (!activeSlide) return;
    if (keyboardConnectorMode && handleKeyboardConnectorModeKey(event)) return;
    if (event.key === " ") {
      const targetNodeId = focusedNodeId ?? firstSelectedId;
      if (targetNodeId && findNodeById(activeSlide.children, targetNodeId)) {
        event.preventDefault();
        setFocusedNodeId(targetNodeId);
        setSelection((state) =>
          event.shiftKey
            ? toggleNode(state, targetNodeId)
            : setSelectedNodeIds(state, [targetNodeId]),
        );
      }
      return;
    }
    if (event.key === "Tab") {
      const nextId = adjacentNodeId(
        activeSlide.children,
        firstSelectedId,
        event.shiftKey ? -1 : 1,
      );
      if (nextId) {
        setSelection((s) => setSelectedNodeIds(s, [nextId]));
        setFocusedNodeId(nextId);
        focusStageNodeSoon(nextId);
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Escape") {
      if (tableEditingNodeId) {
        const tableId = tableEditingNodeId;
        clearTableEditing();
        focusSelectedNodeSoon(tableId);
        event.preventDefault();
        return;
      }
      if (activeGroupId) {
        const groupId = activeGroupId;
        setActiveGroupId(null);
        setSelection((s) => setSelectedNodeIds(s, [groupId]));
        focusSelectedNodeSoon(groupId);
        setStageAnnouncement("Selected parent group");
        event.preventDefault();
        return;
      }
      if (selectedIds.length > 0) {
        setSelection((s) => clearSelection(s));
        event.preventDefault();
      }
      return;
    }

    if (handleKeyboardConnectorShortcut(event)) return;
    if (event.key === "Enter" && selectedIds.length === 1 && selectedNode) {
      if (selectedNode.locked) {
        event.preventDefault();
        return;
      }
      if (selectedNode.type === "group") {
        const firstChildId = childIdsForGroup(
          activeSlide.children,
          selectedNode.id,
        )[0];
        if (firstChildId) {
          setSelection((s) => setSelectedNodeIds(s, [firstChildId]));
          setActiveGroupId(selectedNode.id);
          focusSelectedNodeSoon(firstChildId);
        }
        setStageAnnouncement("Selected group child");
        event.preventDefault();
        return;
      }
      if (selectedNode.type === "table") {
        handleEnterTableEdit(selectedNode.id);
        event.preventDefault();
        return;
      }
      if (selectedNode.type === "text") {
        enterInlineEdit(selectedNode.id);
        event.preventDefault();
        return;
      }
    }

    const clipboardAction = clipboardShortcutActionFromKey(event);
    if (clipboardAction === "paste") {
      handlePasteNodes();
      event.preventDefault();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      if (event.shiftKey) onRedo?.();
      else onUndo?.();
      event.preventDefault();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      onRedo?.();
      event.preventDefault();
      return;
    }

    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "a"
    ) {
      const selectableIds = activeSlideTree
        ? getSelectableNodes(activeSlideTree, selection.mode).map(
            (node) => node.id,
          )
        : [];
      if (selectableIds.length > 0) {
        event.preventDefault();
        const primaryId = selectableIds[selectableIds.length - 1];
        const orderedSelection = [
          primaryId,
          ...selectableIds.filter((id) => id !== primaryId),
        ];
        setSelection((s) => setSelectedNodeIds(s, orderedSelection));
        setFocusedNodeId(primaryId);
        focusStageNodeSoon(primaryId);
      }
      return;
    }

    if (event.key === "?") {
      onToggleShortcutHelp();
      event.preventDefault();
      return;
    }

    if (selectedIds.length === 0) return;

    if (clipboardAction === "copy") {
      handleCopyNodes();
      event.preventDefault();
      return;
    }

    if (clipboardAction === "cut") {
      handleCutNodes();
      event.preventDefault();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
      if (event.shiftKey) handleUngroupSelection();
      else handleGroupSelection();
      event.preventDefault();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      handleDeleteSelection();
      event.preventDefault();
      return;
    }

    const nudge = event.shiftKey ? 5 : 1;
    const deltaByKey: Record<string, { x: number; y: number } | undefined> = {
      ArrowLeft: { x: -nudge, y: 0 },
      ArrowRight: { x: nudge, y: 0 },
      ArrowUp: { x: 0, y: -nudge },
      ArrowDown: { x: 0, y: nudge },
    };
    const delta = deltaByKey[event.key];
    if (delta) {
      if (event.altKey) {
        const patches = new Map<string, Partial<LayoutBox>>();
        for (const entry of collectSelectedLayoutEntries(
          activeSlide.children,
          selectedIds,
        )) {
          const resized = clampFrame({
            ...entry.frame,
            w: entry.frame.w + delta.x,
            h: entry.frame.h + delta.y,
          });
          patches.set(entry.id, {
            frame: entry.node.layout?.constraints?.preserveAspectRatio
              ? applyAspectLock(entry.frame, resized)
              : resized,
          });
        }
        if (patches.size > 0) {
          onDeckChange(updateNodeLayouts(deck, activeSlide.id, patches));
          setStageAnnouncement(
            `Resized ${patches.size} ${patches.size === 1 ? "node" : "nodes"}`,
          );
        }
        event.preventDefault();
        return;
      }
      onDeckChange(moveNodesBy(deck, activeSlide.id, selectedIds, delta));
      const direction =
        delta.x < 0
          ? "left"
          : delta.x > 0
            ? "right"
            : delta.y < 0
              ? "up"
              : "down";
      setStageAnnouncement(
        `Moved ${selectedIds.length} ${selectedIds.length === 1 ? "node" : "nodes"} ${direction}`,
      );
      event.preventDefault();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      const result = duplicateNodes(deck, activeSlide.id, selectedIds);
      onDeckChange(result.deck);
      if (result.duplicatedIds.length > 0) {
        setSelection((s) => setSelectedNodeIds(s, result.duplicatedIds));
        focusSelectedNodeSoon(result.duplicatedIds[0]);
      }
      event.preventDefault();
      return;
    }

    const rotationDelta = keyboardRotationDelta(event);
    if (rotationDelta !== null) {
      const patches = new Map<string, Partial<LayoutBox>>();
      let rotationAnnouncement: string | null = null;
      for (const entry of collectSelectedLayoutEntries(
        activeSlide.children,
        selectedIds,
      )) {
        if (entry.node.locked || entry.node.type === "connector") continue;
        const nextRotation = applyKeyboardRotation(
          entry.node.layout?.rotation,
          rotationDelta,
        );
        patches.set(entry.id, { rotation: nextRotation.rotation });
        if (!rotationAnnouncement) {
          rotationAnnouncement = announceRotation(
            entry.node.name ?? entry.node.type,
            nextRotation.angle,
          );
        }
      }
      if (patches.size > 0) {
        onDeckChange(updateNodeLayouts(deck, activeSlide.id, patches));
        setStageAnnouncement(
          patches.size === 1 && rotationAnnouncement
            ? rotationAnnouncement
            : `Rotated ${patches.size} ${patches.size === 1 ? "node" : "nodes"} by ${Math.abs(rotationDelta)}°`,
        );
      }
      event.preventDefault();
    }
  }

  return {
    handleConnectorEndpointPointerDown,
    handleCropHandlePointerDown,
    handleEditorKeyDown,
    handleMultiResizeHandlePointerDown,
    handleMultiRotationHandlePointerDown,
    handleNodePointerDown,
    handleResizeHandlePointerDown,
    handleRotationHandlePointerDown,
    handleStagePointerDown,
    handleStagePointerLeave,
    handleStagePointerMove,
  };
}
