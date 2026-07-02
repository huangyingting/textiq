"use client";

/**
 * vNext slide editor surface.
 *
 * A standalone editing surface for `DeckV7` decks that renders through the
 * `resolveDeckRenderTree` / `SlideCanvasVNext` path. It wires together:
 *
 *   - Slide rail (thumbnail navigation)
 *   - Main stage (`SlideCanvasVNext`)
 *   - Inspector: `SlideControlsPanel`, `StyleBindingPanel`,
 *     `LocalOverrideBadge`, `DiagnosticsPanel`
 *   - Node selection model (normal / layers mode)
 *   - vNext editor commands: `updateSlideControls`, `updateNodeStyleBinding`,
 *     `resetLocalStyleOverride`, `detachDecoration`, `updateNodeLayout`
 *
 * Decoration rendering rules:
 *   - Decorations are rendered behind user nodes and are not selectable in
 *     normal mode.
 *   - In "layers" mode, decorations become selectable and can be detached via
 *     the `detachDecoration` editor command.
 *
 * The component never mutates the deck prop. All changes are reported via
 * `onDeckChange`.
 *
 * Close / present / share / export: pass `onClose` for close, `onPresent` /
 * `onShare` for public roundtrip routes, and `onExportPptx` for PPTX export.
 * Toolbar action errors are caught and surfaced inline.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Edit3,
  FileDown,
  Grid3x3,
  Keyboard,
  LayoutPanelLeft,
  MoreHorizontal,
  MonitorPlay,
  Redo2,
  RefreshCw,
  Share2,
  StickyNote,
  Undo2,
  X,
} from "lucide-react";

import type { ActionResult } from "@/lib/action-result";
import type { DocumentBlock } from "@/lib/content/document-blocks";
import type { SaveStatus } from "@/lib/presentation-shared/save-status";
import type {
  ConnectorEndpoint,
  DeckV7,
  DeckChromeConfig,
  DeckChromeKind,
  ImageCrop,
  LayoutBox,
  NodeSourceMetadata,
  SemanticTemplateKind,
  SlideNode,
  SlideChildNode,
} from "@/lib/presentation-vnext/schema";
import type { ThemePackageV1 } from "@/lib/presentation-vnext/theme-package-schema";
import type {
  StyleBinding,
  StylePatch,
} from "@/lib/presentation-vnext/style-schema";
import type {
  SlideControls,
  SlideProps,
} from "@/lib/presentation-vnext/schema";
import type {
  PresentationDiagnostic,
  DiagnosticAction,
} from "@/lib/presentation-vnext/diagnostics";
import type { SourceBlockIndex } from "@/lib/presentation-vnext/block-index";
import {
  diagnosticTargetKey,
  getDiagnosticNodeId,
  getDiagnosticSlideId,
} from "@/lib/presentation-vnext/diagnostics";
import { applyDiagnosticRepairAction } from "@/lib/presentation-vnext/diagnostic-repairs";
import type {
  SourceLinkHostRefreshArgs,
  SourceLinkHostRefreshResult,
} from "@/lib/presentation-vnext/source-link-orchestration";
import {
  createDocumentSourceNode,
  sourceBlockKindLabel,
} from "@/lib/presentation-vnext/document-source-commands";
import type { InspectorPanelId } from "@/lib/presentation-vnext/inspector-panel-ui";
import type { ResolvedRenderNode } from "@/lib/presentation-vnext/render-tree";
import {
  MIN_DECK_SLIDES_MESSAGE,
  emptySlideSpecFromLayout,
  slideSpecFromSlide,
  updateSlideControls,
  updateSlideAttributes,
  updateSlideLocalStyle,
  resetSlideLocalStyle,
  updateSlideSourceMetadata,
  setThemePackage,
  updateDeckChrome,
  insertTemplateSlide,
  duplicateSlide,
  deleteSlide,
  moveSlide,
  insertNode,
  pasteNodes,
  cutNodes,
  updateNodeContent,
  resetImageCrop,
  updateNodeStyleBinding,
  updateLocalStyle,
  resetLocalStyleOverride,
  detachDecoration,
  detachDeckChrome,
  updateNodeLayout,
  updateNodeRotation,
  updateNodeLayouts,
  updateNodeAttributes,
  updateNodeSourceMetadata,
  moveNodesBy,
  deleteNodes,
  duplicateNodes,
  groupNodes,
  ungroupNodes,
  reorderZIndex,
  applyTemplate,
} from "@/lib/presentation-vnext";

import { NEUTRAL_THEME_PACKAGE } from "@/lib/presentation-vnext/neutral-theme-package";
import { createDefaultTemplateRegistry } from "@/lib/presentation-vnext/theme-packages";
import { listThemePackagesV7 } from "@/lib/presentation-vnext/theme-package-registry";
import { resolveNodeFontCss } from "@/lib/presentation-vnext/node-font-css";
import { resolveDeckAssetSource } from "@/lib/presentation-vnext/deck-asset-source";
import {
  alignmentGuidesForFrames,
  snapFrameToStageGuides,
  type StageGuide,
} from "@/lib/presentation-vnext/stage-guides";
import { STAGE_CHROME_Z_INDEX } from "@/lib/presentation-vnext/stage-chrome";
import {
  fitCanvasToViewport,
  type CanvasStageFit,
  type StageFitSize,
} from "@/lib/presentation-vnext/stage-fit";
import {
  normalizeSelectionFrame,
  selectNodesInFrame,
} from "@/lib/presentation-vnext/selection-geometry";
import { connectorEndpointFromSlidePoint } from "@/lib/presentation-vnext/connector-geometry";
import {
  hitTestSlideNodes,
  type StageHitCandidate,
} from "@/lib/presentation-vnext/stage-hit-test";
import {
  assetFactoryId,
  deckWithPickedVisualAsset,
  deckWithUploadedImageAsset as createDeckWithUploadedImageAsset,
  defaultConnectorNode,
  defaultImageNode,
  defaultShapeNode,
  defaultTableNode,
  defaultTextNode,
  defaultVisualNode,
  nodeFactoryId,
  textNodeAtPoint,
  visualContentPatchFromPick,
  type V7ImageUploadResult,
  type V7VisualPickResult,
} from "@/lib/presentation-vnext/node-asset-factories";
import { nextLayeredZIndex } from "@/lib/presentation-vnext/layer-bands";
import {
  buildAlignSelectionPatches,
  buildDistributeSelectionPatches,
  buildLayerReorderPatches,
  buildMatchSizeSelectionPatches,
  buildZOrderSelectionOperations,
  collectSelectedLayoutEntries,
} from "./arrangement-geometry";

import {
  SlideCanvasVNext,
  type ConnectorEndpointHandle,
  type CropHandlePosition,
  type ResizeHandlePosition,
} from "./slide-canvas";
import {
  createFocusGeometryRegistry,
  focusGeometryTargets,
  type FocusGeometryRegistry,
} from "./focus-geometry-registry";
import { startPointerDragLifecycle } from "./pointer-drag-lifecycle";
import { createSingleCommitGesture } from "./single-commit-gesture";
import {
  createSelectionState,
  getSelectableNodes,
  selectNode,
  toggleNode,
  clearSelection,
  setSelection as setSelectedNodeIds,
  setSelectionMode,
  selectedNodeIds,
  type SelectionState,
} from "./selection-model";
import {
  adjacentInlineEditableNodeId,
  adjacentNodeId,
  childIdsForGroup,
  findNodeById,
  flattenEditorNodes,
  layoutFramesExcluding,
  nodesInReadingOrder,
  parentGroupIdForNode,
} from "./selection-traversal";
import { DeckChromePanel, InspectorShell } from "./inspector";
import {
  ContextToolbar,
  type SelectionAlignMode,
  type SelectionDistributeMode,
  type SelectionMatchSizeMode,
} from "./toolbar/context-toolbar";
import {
  DeckToolbar,
  DeckToolbarButton,
  DeckToolbarDivider,
  DeckToolbarGroup,
  DeckToolbarIconButton,
  DeckToolbarRow,
} from "./toolbar/deck-toolbar";
import { Filmstrip } from "./filmstrip/filmstrip";
import {
  readFilmstripCollapsed,
  writeFilmstripCollapsed,
} from "./filmstrip/filmstrip-collapse-storage";
import {
  nextActiveGroupIdForStageTarget,
  resolveStageNodeTarget,
  stageCandidateNodeIds,
  type StageNodeInteractionTarget,
} from "./stage-targeting";
import { StageNodeContextMenu, stageNodeMenuLabel } from "./stage-context-menu";
import {
  buildKeyboardConnectorNodeVNext,
  connectorFrameForEndpointsVNext,
  cycleConnectorEndpointAnchorVNext,
  detachConnectorEndpointVNext,
  isKeyboardConnectableNode,
  nextKeyboardConnectorTargetIdVNext,
  selectedKeyboardConnectablePair,
  startKeyboardConnectorModeVNext,
} from "./stage-keyboard-interactions";
import {
  buildStageGestureBadge,
  buildStageNodeGestureDrafts,
  createNodeMovePreview,
  nodeMoveGestureDrafts,
  nodeMovePreviewsEqual,
  renderStageGestureBadge,
  type NodeMovePreview,
} from "./stage-gesture-feedback";
import {
  canvasElementFromTarget,
  canvasRectFromEvent,
  isEditableTarget,
  isStageEditingHandleTarget,
  isStageHandleTarget,
  nextSemanticSelectUnderNodeId,
  pointPctFromEvent,
  pointerMovedBeyondThreshold,
  shouldEnterInlineNodeEditOnClick,
} from "./stage-pointer-interactions";
import { useStageInteractionController } from "./use-stage-interaction-controller";
import { pairDuplicatesAfterOriginals } from "./stage-duplicate";
import {
  connectorEndpointsEqual,
  nearestConnectorAnchor,
} from "./stage-connector-interactions";
import {
  AddSlideTemplatePicker,
  type AddSlideTemplateChoice,
} from "./add-slide-template-picker";
import {
  InlineTextEditorVNext,
  type InlineTextInitialCaret,
} from "./inline-text-editor";
import { applyInlineTextCommit } from "./inline-text-commit";
import { useDeckV7RenderTree } from "./use-deck-v7-render-tree";
import { useExportDiagnostics } from "./use-export-diagnostics";
import {
  SlideEditorCloseConfirmDialog,
  useSlideEditorShellController,
} from "./use-slide-editor-shell-controller";
import { useSourceReviewController } from "./use-source-review-controller";
import { useTableCellEditing } from "./use-table-cell-editing";
import { SourceReviewPanel } from "./source-review-panel";
import { DeckDiagnosticsReview } from "./deck-diagnostics-review";
import { clipboardShortcutActionFromKey } from "./clipboard-shortcuts";
import {
  runVisualPickerMutation,
  VISUAL_PICKER_FAILURE_MESSAGE,
} from "./visual-picker-recovery";
import { KeyboardShortcutHelpDialog } from "@/components/presentation-shared/keyboard-shortcut-help-dialog";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import { useFocusTrap } from "@/lib/a11y/use-focus-trap";
import {
  focusFirstMenuCommand,
  isMenuCommandNavigationKey,
  moveMenuCommandFocus,
} from "@/lib/a11y/menu-command-semantics";
import {
  presencePeerLabel,
  useSlidePresence,
  type SlidePresenceAwareness,
  type SlidePresencePeer,
} from "@/lib/presentation-shared/use-slide-presence";
import { canvasArrangeShortcutKind } from "@/lib/shortcuts/canvas-runtime";
import {
  announceRotation,
  applyKeyboardRotation,
  keyboardRotationDelta,
} from "@/lib/presentation-shared/canvas-keyboard-rotate";

export {
  handleCloseConfirmAction,
  routeCloseRequest,
  setupBeforeUnloadGuard,
  SlideEditorCloseConfirmDialog,
} from "./use-slide-editor-shell-controller";

const DECK_CHROME_KINDS: DeckChromeKind[] = [
  "logo",
  "footer",
  "pageNumber",
  "watermark",
  "border",
  "safeArea",
];

const TEMPLATE_REGISTRY = createDefaultTemplateRegistry();
const TEMPLATE_OPTIONS = TEMPLATE_REGISTRY.all();
const ZOOM_PERCENT_PRESETS = [200, 150, 125, 100, 75, 50, 25] as const;
const DESKTOP_INSPECTOR_MEDIA_QUERY = "(min-width: 1024px)";

function isDesktopInspectorViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(DESKTOP_INSPECTOR_MEDIA_QUERY).matches
  );
}

function isMobileInspectorViewport(): boolean {
  return !isDesktopInspectorViewport();
}

function scheduleEffectStateUpdate(callback: () => void): () => void {
  let canceled = false;
  const timeoutId = globalThis.setTimeout(() => {
    if (!canceled) callback();
  }, 0);
  return () => {
    canceled = true;
    globalThis.clearTimeout(timeoutId);
  };
}

function useDesktopInspectorViewport(): boolean {
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(DESKTOP_INSPECTOR_MEDIA_QUERY);
    const syncViewport = () => {
      setIsDesktopViewport(mediaQuery.matches);
    };
    syncViewport();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }
    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  return isDesktopViewport;
}

function FocusTrapped({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref);
  return <div ref={ref}>{children}</div>;
}

interface SlideEditorInspectorRegionProps {
  isDesktopInspectorViewport: boolean;
  activeSlide: SlideNode | undefined;
  inspectorSheetOpen: boolean;
  onOpenMobileInspector: () => void;
  onCloseMobileInspector: () => void;
  renderInspectorShell: () => JSX.Element;
}

export function SlideEditorInspectorRegion({
  isDesktopInspectorViewport,
  activeSlide,
  inspectorSheetOpen,
  onOpenMobileInspector,
  onCloseMobileInspector,
  renderInspectorShell,
}: SlideEditorInspectorRegionProps): JSX.Element {
  const showMobileInspector =
    !isDesktopInspectorViewport && Boolean(activeSlide);

  return (
    <>
      {isDesktopInspectorViewport ? (
        <div className="absolute bottom-4 right-4 top-4 z-panel hidden w-80 overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface-overlay shadow-ds-overlay lg:flex">
          {renderInspectorShell()}
        </div>
      ) : null}

      {showMobileInspector ? (
        <div className="lg:hidden">
          <button
            type="button"
            data-floating-panel="true"
            aria-label="Edit slide"
            aria-haspopup="dialog"
            aria-expanded={inspectorSheetOpen}
            onClick={onOpenMobileInspector}
            className={cx(
              "tiq-safe-fab fixed z-modal flex h-12 w-12 items-center justify-center rounded-full bg-ds-accent text-ds-text-on-accent shadow-ds-overlay transition-colors hover:bg-ds-accent-hover",
              FOCUS_RING,
            )}
          >
            <Edit3 aria-hidden="true" className="h-5 w-5" />
          </button>

          {inspectorSheetOpen ? (
            <>
              <div
                data-floating-panel="true"
                aria-hidden="true"
                onClick={onCloseMobileInspector}
                className="fixed inset-0 z-modal bg-ds-backdrop"
              />
              <FocusTrapped>
                <div
                  data-floating-panel="true"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Slide inspector"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      onCloseMobileInspector();
                    }
                  }}
                  className="tiq-mobile-sheet fixed inset-x-0 bottom-0 z-modal flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border-t border-ds-border-subtle bg-ds-surface-base shadow-ds-popover"
                >
                  <div className="relative flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-ds-border-subtle"
                    />
                    <p className="text-xs font-semibold uppercase tracking-wide text-ds-text-muted">
                      Edit slide
                    </p>
                    <button
                      type="button"
                      aria-label="Close slide inspector"
                      onClick={onCloseMobileInspector}
                      className={cx(
                        "tiq-touch-target flex h-7 w-7 items-center justify-center rounded-full text-ds-text-muted transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                        FOCUS_RING,
                      )}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {renderInspectorShell()}
                  </div>
                </div>
              </FocusTrapped>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export type SlideEditorVNextImageUploadResult = V7ImageUploadResult;

export type SlideEditorVNextVisualPickResult = V7VisualPickResult;

export type SlideEditorVNextSourceRefreshResult = SourceLinkHostRefreshResult;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SlideEditorVNextProps {
  documentId: string;
  /** The v7 deck to edit. */
  deck: DeckV7;
  /** Theme package to use for rendering. Falls back to the neutral package. */
  themePackage?: ThemePackageV1 | null;
  /** Boundary diagnostics, e.g. validation or theme fallback notices. */
  diagnostics?: readonly PresentationDiagnostic[];
  saveStatus?: SaveStatus;
  saveStatusLabel?: string;
  saveErrorMessage?: string;
  hasUnsavedWork?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /**
   * Focus target emitted after a committed undo/redo. When the `token` changes,
   * the editor restores selection and DOM focus to `nodeId` (a node, or a slide
   * id when the affected node was removed) so attention follows the change.
   */
  undoRedoFocus?: { nodeId: string; token: number } | null;
  onUploadImage?: (file: File) => Promise<SlideEditorVNextImageUploadResult>;
  onPickVisual?: () => Promise<SlideEditorVNextVisualPickResult | undefined>;
  documentBlocks?: readonly DocumentBlock[];
  sourceBlockIndex?: SourceBlockIndex;
  onRefreshSource?: (
    args: SourceLinkHostRefreshArgs,
  ) => Promise<SlideEditorVNextSourceRefreshResult | undefined>;
  /**
   * Called on every structural change. Receives the updated deck with the
   * command result applied. The parent is responsible for persistence.
   */
  onDeckChange: (deck: DeckV7) => void;
  /**
   * Optional explicit save callback. Called when the user requests an
   * immediate save (e.g. Save button). When omitted, the parent's
   * `onDeckChange` handler is solely responsible for persistence timing.
   *
   * Extension point for v7-specific autosave/commit infrastructure —
   * see `handleSaveV7` in `use-slide-editor-open.ts`.
   */
  onSave?: (deck: DeckV7) => Promise<ActionResult>;
  /**
   * Called when the user requests a deterministic whole-deck rebuild from the
   * owning document content. The parent owns source loading, replacement, and
   * persistence.
   */
  onRegenerate?: () => Promise<ActionResult>;
  /**
   * Called when the user closes the editor. When provided, a close button
   * is rendered in the top toolbar.
   */
  onClose?: () => void;
  /**
   * Called when the user requests a PPTX export. The callback is responsible
   * for invoking `exportDeckV7AsPPTX` and triggering the browser download.
   * When provided, an "Export PPTX" button is rendered in the top toolbar.
   * Thrown errors are caught and displayed inline.
   */
  onExportPptx?: () => Promise<void>;
  /**
   * Called when the user requests the public presentation route from the
   * editor chrome. The callback should route to/open the present target.
   */
  onPresent?: () => Promise<ActionResult>;
  /**
   * Called when the user requests the public share route from the editor
   * chrome. The callback should route to/open/copy the share target.
   */
  onShare?: () => Promise<ActionResult>;
  presenceAwareness?: SlidePresenceAwareness | null;
  presenceUserId?: string;
  presenceUserName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function topLevelSelectedNodeIds(
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
function defaultStyleBindingForNode(node: SlideChildNode): StyleBinding {
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

const STAGE_VIEWPORT_FALLBACK: StageFitSize = { width: 1120, height: 630 };
const DESKTOP_INSPECTOR_OVERLAY_WIDTH = 352;
const CLICK_MOVE_THRESHOLD_PX = 4;

function canvasAspectRatio(deck: DeckV7): number {
  const width = deck.canvas.width > 0 ? deck.canvas.width : 16;
  const height = deck.canvas.height > 0 ? deck.canvas.height : 9;
  return width / height;
}

function canvasStageFit(
  deck: DeckV7,
  zoomPercent: number,
  viewport: StageFitSize | null,
  isDesktopInspectorViewport: boolean,
): CanvasStageFit {
  const safeViewport = viewport ?? STAGE_VIEWPORT_FALLBACK;
  const rightOverlayWidth = isDesktopInspectorViewport
    ? DESKTOP_INSPECTOR_OVERLAY_WIDTH
    : 0;
  return fitCanvasToViewport({
    viewport: safeViewport,
    aspectRatio: canvasAspectRatio(deck),
    zoomPercent,
    rightOverlayWidth,
  });
}

function canvasFrameStyle(stageFit: CanvasStageFit): CSSProperties {
  return {
    position: "absolute",
    left: stageFit.frame.left,
    top: stageFit.frame.top,
    width: stageFit.frame.width,
    height: stageFit.frame.height,
  };
}

function stageScrollContentStyle(stageFit: CanvasStageFit): CSSProperties {
  return {
    position: "relative",
    width: stageFit.scrollContentSize.width,
    height: stageFit.scrollContentSize.height,
  };
}

function focusStageNode(
  focusGeometryRegistry: FocusGeometryRegistry,
  nodeId: string,
): void {
  focusGeometryRegistry.focus(focusGeometryTargets.stageNode(nodeId));
}

/**
 * Finds the slide index that owns a node id (searching nested group children),
 * or, failing that, the index of a slide whose own id matches. Returns -1 when
 * the id is no longer present in the deck.
 */
function findSlideIndexForFocus(deck: DeckV7, targetId: string): number {
  const containsNode = (nodes: readonly SlideChildNode[]): boolean =>
    nodes.some(
      (node) =>
        node.id === targetId ||
        (node.type === "group" && containsNode(node.children)),
    );
  const byNode = deck.slides.findIndex((slide) => containsNode(slide.children));
  if (byNode !== -1) return byNode;
  return deck.slides.findIndex((slide) => slide.id === targetId);
}

function slideDisplayName(slide: SlideNode | undefined, index: number): string {
  return slide?.name ?? `Slide ${index + 1}`;
}

function selectedSummary(count: number): string {
  if (count === 0) return "No selection";
  if (count === 1) return "1 node selected";
  return `${count} nodes selected`;
}

function diagnosticsSummary(count: number): string {
  if (count === 0) return "No diagnostics";
  if (count === 1) return "1 diagnostic";
  return `${count} diagnostics`;
}

function presencePeerSummary(
  peer: SlidePresencePeer,
  deck: DeckV7,
  activeSlideId: string | undefined,
): string {
  const label = presencePeerLabel(peer);
  if (!peer.selectedSlideId) return `${label}: in deck`;
  if (peer.selectedSlideId === activeSlideId) {
    if (peer.selectedNodeIds.length === 1) return `${label}: selecting 1 node`;
    if (peer.selectedNodeIds.length > 1) {
      return `${label}: selecting ${peer.selectedNodeIds.length} nodes`;
    }
    return `${label}: viewing this slide`;
  }
  const slideIndex = deck.slides.findIndex(
    (slide) => slide.id === peer.selectedSlideId,
  );
  return slideIndex >= 0
    ? `${label}: on ${slideDisplayName(deck.slides[slideIndex], slideIndex)}`
    : `${label}: in deck`;
}

function dedupeDiagnostics(
  diagnostics: readonly PresentationDiagnostic[],
): PresentationDiagnostic[] {
  const seen = new Set<string>();
  const result: PresentationDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnosticTargetKey(diagnostic.target)}:${diagnostic.path ?? ""}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
  }
  return result;
}

function clampFrame(frame: LayoutBox["frame"]): LayoutBox["frame"] {
  const w = Math.max(
    0.5,
    Math.min(100, Number.isFinite(frame.w) ? frame.w : 0.5),
  );
  const h = Math.max(
    0.5,
    Math.min(100, Number.isFinite(frame.h) ? frame.h : 0.5),
  );
  return {
    x: Math.max(0, Math.min(100 - w, Number.isFinite(frame.x) ? frame.x : 0)),
    y: Math.max(0, Math.min(100 - h, Number.isFinite(frame.y) ? frame.y : 0)),
    w,
    h,
  };
}

function framesEqual(
  left: LayoutBox["frame"],
  right: LayoutBox["frame"],
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.w === right.w &&
    left.h === right.h
  );
}

function clampCrop(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(95, Math.round(value * 10) / 10));
}

function cropsEqual(a: ImageCrop, b: ImageCrop): boolean {
  return (
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.left === b.left
  );
}

function normalizeRotationDegrees(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  const normalized = ((rotation % 360) + 360) % 360;
  return Math.round(normalized * 10) / 10;
}

function snapRotationDegrees(rotation: number, snap: boolean): number {
  return normalizeRotationDegrees(
    snap ? Math.round(rotation / 15) * 15 : rotation,
  );
}

function resizeFrame(
  frame: LayoutBox["frame"],
  handle: ResizeHandlePosition,
  deltaX: number,
  deltaY: number,
): LayoutBox["frame"] {
  let { x, y, w, h } = frame;
  if (handle.includes("w")) {
    x += deltaX;
    w -= deltaX;
  }
  if (handle.includes("e")) {
    w += deltaX;
  }
  if (handle.includes("n")) {
    y += deltaY;
    h -= deltaY;
  }
  if (handle.includes("s")) {
    h += deltaY;
  }
  if (w < 0.5 && handle.includes("w")) x -= 0.5 - w;
  if (h < 0.5 && handle.includes("n")) y -= 0.5 - h;
  return clampFrame({ x, y, w, h });
}

function applyAspectLock(
  original: LayoutBox["frame"],
  next: LayoutBox["frame"],
): LayoutBox["frame"] {
  const aspect = original.w / original.h;
  if (!Number.isFinite(aspect) || aspect <= 0) return next;
  const widthDelta = Math.abs(next.w - original.w);
  const heightDelta = Math.abs(next.h - original.h);
  return widthDelta >= heightDelta
    ? clampFrame({ ...next, h: next.w / aspect })
    : clampFrame({ ...next, w: next.h * aspect });
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (src) {
        resolve(src);
      } else {
        reject(new Error("empty image data"));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("image read failed"));
    };
    reader.readAsDataURL(file);
  });
}

export function deleteActiveSlideFromToolbar(
  deck: DeckV7,
  activeSlideId: string | undefined,
): {
  deleted: boolean;
  nextDeck: DeckV7;
  nextIndex: number;
  statusMessage?: string;
} {
  if (!activeSlideId) {
    return { deleted: false, nextDeck: deck, nextIndex: 0 };
  }
  if (deck.slides.length <= 1) {
    return {
      deleted: false,
      nextDeck: deck,
      nextIndex: 0,
      statusMessage: MIN_DECK_SLIDES_MESSAGE,
    };
  }
  const result = deleteSlide(deck, activeSlideId);
  return {
    deleted: result.deck !== deck,
    nextDeck: result.deck,
    nextIndex: result.index,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlideEditorVNext({
  documentId,
  deck,
  themePackage,
  diagnostics: boundaryDiagnostics = [],
  saveStatus = "saved",
  saveStatusLabel = "All changes saved",
  saveErrorMessage,
  hasUnsavedWork = false,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  undoRedoFocus = null,
  onUploadImage,
  onPickVisual,
  documentBlocks = [],
  sourceBlockIndex,
  onRefreshSource,
  onDeckChange,
  onSave,
  onRegenerate,
  onClose,
  onExportPptx,
  onPresent,
  onShare,
  presenceAwareness = null,
  presenceUserId = "",
  presenceUserName = "Anonymous",
}: SlideEditorVNextProps): JSX.Element {
  const pkg = themePackage ?? NEUTRAL_THEME_PACKAGE;
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const focusGeometryRegistry = useMemo(
    () => createFocusGeometryRegistry(),
    [],
  );
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(
    null,
  );
  const handleCanvasRef = useCallback((el: HTMLDivElement | null) => {
    setCanvasElement(el);
  }, []);
  const suppressStageClickRef = useRef(false);
  function suppressNextStageClick() {
    suppressStageClickRef.current = true;
    window.setTimeout(() => {
      suppressStageClickRef.current = false;
    }, 0);
  }
  const lastUndoRedoFocusTokenRef = useRef<number | null>(null);
  const themePackages = useMemo(() => listThemePackagesV7(), []);
  const isMac = useMemo(() => {
    if (typeof navigator === "undefined") {
      return false;
    }
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent;
    return /mac|iphone|ipad|ipod/i.test(platform);
  }, []);
  const documentVisualsById = useMemo(() => {
    const visuals = new Map<
      string,
      Extract<DocumentBlock, { kind: "visual" }>["visual"]
    >();
    for (const block of documentBlocks) {
      if (block.kind === "visual") {
        visuals.set(block.visualId, block.visual);
      }
    }
    return visuals;
  }, [documentBlocks]);
  const resolveDocumentVisual = useCallback(
    (visualId: string) => documentVisualsById.get(visualId),
    [documentVisualsById],
  );

  const [addSlidePickerOpen, setAddSlidePickerOpen] = useState(false);
  const replaceImageFileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceSlideBackgroundFileInputRef = useRef<HTMLInputElement | null>(
    null,
  );
  const replaceImageTargetIdRef = useRef<string | null>(null);
  const insertImagePendingRef = useRef(false);

  // Inline text editing state
  const [inlineEditNodeId, setInlineEditNodeId] = useState<string | null>(null);
  const [inlineEditInitialCaret, setInlineEditInitialCaret] =
    useState<InlineTextInitialCaret | null>(null);

  function enterInlineEdit(
    nodeId: string,
    initialCaret: InlineTextInitialCaret | null = null,
  ) {
    setInlineEditInitialCaret(initialCaret);
    setInlineEditNodeId(nodeId);
  }

  function exitInlineEdit() {
    setInlineEditInitialCaret(null);
    setInlineEditNodeId(null);
  }

  function handleThemePackageChange(packageId: string) {
    const nextPackage = themePackages.find(
      (candidate) => candidate.id === packageId,
    );
    onDeckChange(setThemePackage(deck, packageId, nextPackage?.version));
  }

  function handleCanvasRatioChange(format: "16:9" | "4:3" | "square") {
    const dimensions =
      format === "4:3"
        ? { width: 4, height: 3 }
        : format === "square"
          ? { width: 1, height: 1 }
          : { width: 16, height: 9 };
    onDeckChange({
      ...deck,
      canvas: { ...deck.canvas, format, ...dimensions, unit: "percent" },
    });
  }

  function handleReapplyTemplate(
    kind: SemanticTemplateKind,
    layoutId?: string,
  ) {
    if (!activeSlide) return;
    const template = TEMPLATE_REGISTRY.get(kind);
    if (!template) return;
    const spec = slideSpecFromSlide(
      activeSlide,
      kind,
      layoutId,
      TEMPLATE_REGISTRY,
    );
    onDeckChange(applyTemplate(deck, activeSlide.id, spec, template));
    setSelection(createSelectionState(selection.mode));
  }

  useEffect(() => {
    editorRootRef.current?.focus();
  }, []);

  // ---------------------------------------------------------------------------
  // Slide navigation
  // ---------------------------------------------------------------------------

  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const activeSlide: SlideNode | undefined = deck.slides[activeSlideIndex];

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const [selection, setSelection] = useState<SelectionState>(() =>
    createSelectionState("normal"),
  );
  const [snapToGuides, setSnapToGuides] = useState(true);
  const [clipboardNodes, setClipboardNodes] = useState<SlideChildNode[]>([]);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [stageZoomPercent, setStageZoomPercent] = useState(100);
  const [stageViewportSize, setStageViewportSize] =
    useState<StageFitSize | null>(null);
  const [filmstripCollapsed, setFilmstripCollapsed] = useState(() =>
    readFilmstripCollapsed(documentId),
  );
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [footerStatusMenuOpen, setFooterStatusMenuOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [compactToolbarMenuOpen, setCompactToolbarMenuOpen] = useState(false);
  const zoomMenuId = useId();
  const zoomMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const zoomMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const footerStatusMenuId = useId();
  const footerStatusMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const footerStatusMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const sourceMenuId = useId();
  const sourceMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sourceMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const compactToolbarMenuId = useId();
  const compactToolbarMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const compactToolbarMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const [deckChromeToolbarOpen, setDeckChromeToolbarOpen] = useState(false);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);
  const [deckDiagnosticsReviewOpen, setDeckDiagnosticsReviewOpen] =
    useState(false);
  const [inspectorPanelRequest, setInspectorPanelRequest] = useState<{
    panel: InspectorPanelId;
    nonce: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
    candidateIds: string[];
  } | null>(null);
  const semanticCandidateStackRef = useRef<readonly string[]>([]);
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const {
    stageGuides,
    setStageGuides,
    marqueeFrame,
    setMarqueeFrame,
    stageAnnouncement,
    setStageAnnouncement,
    keyboardConnectorMode,
    setKeyboardConnectorMode,
    hoveredNodeId,
    setHoveredNodeId,
    slideHovered,
    setSlideHovered,
    focusedNodeId,
    setFocusedNodeId,
    draggingStage,
    setDraggingStage,
    moveGestureDraft,
    setMoveGestureDraft,
    activeResizeHandle,
    setActiveResizeHandle,
    resizeGestureDraft,
    setResizeGestureDraft,
    activeCropHandle,
    setActiveCropHandle,
    cropGestureDraft,
    setCropGestureDraft,
    activeRotationNodeId,
    setActiveRotationNodeId,
    rotationGestureDraft,
    setRotationGestureDraft,
    activeConnectorEndpoint,
    setActiveConnectorEndpoint,
    connectorGestureDraft,
    setConnectorGestureDraft,
    clearGestureDrafts,
  } = useStageInteractionController();
  const {
    toolbarError,
    setToolbarError,
    closeConfirmOpen,
    handleExportPptx,
    handleRegenerate,
    handleRoundtripAction,
    handleCloseRequest,
    handleCloseConfirmCancel,
    handleCloseConfirmDiscard,
  } = useSlideEditorShellController({
    deck,
    hasUnsavedWork,
    onClose,
    onExportPptx,
    onRegenerate,
    onSave,
    setStageAnnouncement,
  });
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const isDesktopInspectorViewport = useDesktopInspectorViewport();
  const deckChromeToolbarPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!deckChromeToolbarOpen) return;
    const panel = deckChromeToolbarPanelRef.current;
    if (!panel) return;
    const focusTarget = panel.querySelector<HTMLElement>(
      "input, select, button, textarea, [tabindex]:not([tabindex='-1'])",
    );
    focusTarget?.focus();
  }, [deckChromeToolbarOpen]);

  useEffect(() => {
    if (!zoomMenuOpen) return;
    focusFirstMenuCommand(zoomMenuPanelRef.current);
  }, [zoomMenuOpen]);

  useEffect(() => {
    if (!footerStatusMenuOpen) return;
    focusFirstMenuCommand(footerStatusMenuPanelRef.current);
  }, [footerStatusMenuOpen]);

  useEffect(() => {
    if (!sourceMenuOpen) return;
    focusFirstMenuCommand(sourceMenuPanelRef.current);
  }, [sourceMenuOpen]);

  useEffect(() => {
    if (!compactToolbarMenuOpen) return;
    focusFirstMenuCommand(compactToolbarMenuPanelRef.current);
  }, [compactToolbarMenuOpen]);

  const effectiveInspectorSheetOpen =
    inspectorSheetOpen && !isDesktopInspectorViewport;

  useEffect(() => {
    return scheduleEffectStateUpdate(() => {
      clearGestureDrafts();
    });
  }, [activeSlide?.id, clearGestureDrafts]);

  useEffect(() => {
    if (!undoRedoFocus) return;
    if (lastUndoRedoFocusTokenRef.current === undoRedoFocus.token) return;
    lastUndoRedoFocusTokenRef.current = undoRedoFocus.token;
    const nextSlideIndex = findSlideIndexForFocus(deck, undoRedoFocus.nodeId);
    const targetSlide = deck.slides[nextSlideIndex];
    const targetNode = targetSlide
      ? findNodeById(targetSlide.children, undoRedoFocus.nodeId)
      : undefined;
    return scheduleEffectStateUpdate(() => {
      if (nextSlideIndex < 0) {
        setSelection((s) => clearSelection(s));
        setFocusedNodeId(null);
        exitInlineEdit();
        window.setTimeout(() => editorRootRef.current?.focus(), 0);
        return;
      }

      setActiveSlideIndex(nextSlideIndex);
      exitInlineEdit();
      setHoveredNodeId(null);
      if (targetNode) {
        setSelection((s) => setSelectedNodeIds(s, [targetNode.id]));
        setFocusedNodeId(targetNode.id);
        window.setTimeout(
          () => focusStageNode(focusGeometryRegistry, targetNode.id),
          0,
        );
        return;
      }

      setSelection((s) => clearSelection(s));
      setFocusedNodeId(null);
      window.setTimeout(() => editorRootRef.current?.focus(), 0);
    });
  }, [
    deck,
    focusGeometryRegistry,
    setFocusedNodeId,
    setHoveredNodeId,
    undoRedoFocus,
  ]);

  function requestInspectorPanel(panel: InspectorPanelId) {
    setInspectorPanelRequest((current) => ({
      panel,
      nonce: (current?.nonce ?? 0) + 1,
    }));
  }

  function openMobileInspector(panel: InspectorPanelId = "slide") {
    requestInspectorPanel(panel);
    setInspectorSheetOpen(true);
  }

  function openInspectorPanel(panel: InspectorPanelId) {
    requestInspectorPanel(panel);
    if (isMobileInspectorViewport()) setInspectorSheetOpen(true);
  }

  function closeMobileInspector() {
    setInspectorSheetOpen(false);
  }

  function handleNotesControlClick() {
    setSelection(createSelectionState(selection.mode));
    exitInlineEdit();
    requestInspectorPanel("notes");
    if (isMobileInspectorViewport()) {
      setInspectorSheetOpen(true);
      return;
    }
  }

  useEffect(() => {
    const node = stageViewportRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let frameId: number | null = null;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const paddingX =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const paddingY =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      const next = {
        width: Math.max(1, rect.width - paddingX),
        height: Math.max(1, rect.height - paddingY),
      };
      setStageViewportSize((current) =>
        current?.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    const scheduleMeasure = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };
    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(node);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    return scheduleEffectStateUpdate(() => {
      setFilmstripCollapsed(readFilmstripCollapsed(documentId));
    });
  }, [documentId]);

  function toggleFilmstripCollapsed() {
    setFilmstripCollapsed((prev) => {
      const next = !prev;
      writeFilmstripCollapsed(documentId, next);
      return next;
    });
  }

  function toggleSnapToGuides() {
    const next = !snapToGuides;
    setSnapToGuides(next);
    if (!next) setStageGuides([]);
    setStageAnnouncement(next ? "Snap to guides on" : "Snap to guides off");
  }

  function setFooterZoom(percent: number) {
    setStageZoomPercent(percent);
    setZoomMenuOpen(false);
  }

  function closeZoomMenuAndRestoreFocus() {
    setZoomMenuOpen(false);
    zoomMenuTriggerRef.current?.focus();
  }

  function closeFooterStatusMenuAndRestoreFocus() {
    setFooterStatusMenuOpen(false);
    footerStatusMenuTriggerRef.current?.focus();
  }

  function closeSourceMenuAndRestoreFocus() {
    setSourceMenuOpen(false);
    sourceMenuTriggerRef.current?.focus();
  }

  function closeCompactToolbarMenuAndRestoreFocus() {
    setCompactToolbarMenuOpen(false);
    compactToolbarMenuTriggerRef.current?.focus();
  }

  function handleZoomMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeZoomMenuAndRestoreFocus();
      return;
    }
    if (!isMenuCommandNavigationKey(event.key)) return;
    if (
      moveMenuCommandFocus({
        container: zoomMenuPanelRef.current,
        key: event.key,
        currentTarget: event.target,
      })
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleFooterStatusMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeFooterStatusMenuAndRestoreFocus();
      return;
    }
    if (!isMenuCommandNavigationKey(event.key)) return;
    if (
      moveMenuCommandFocus({
        container: footerStatusMenuPanelRef.current,
        key: event.key,
        currentTarget: event.target,
      })
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleSourceMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSourceMenuAndRestoreFocus();
      return;
    }
    if (!isMenuCommandNavigationKey(event.key)) return;
    if (
      moveMenuCommandFocus({
        container: sourceMenuPanelRef.current,
        key: event.key,
        currentTarget: event.target,
      })
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleCompactToolbarMenuKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeCompactToolbarMenuAndRestoreFocus();
      return;
    }
    if (!isMenuCommandNavigationKey(event.key)) return;
    if (
      moveMenuCommandFocus({
        container: compactToolbarMenuPanelRef.current,
        key: event.key,
        currentTarget: event.target,
      })
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function clearActiveEditingState(
    mode: SelectionState["mode"] = selection.mode,
  ) {
    setSelection(createSelectionState(mode));
    setFocusedNodeId(null);
    setHoveredNodeId(null);
    setActiveGroupId(null);
    clearTableEditing();
  }

  function handleInsertSlide() {
    setAddSlidePickerOpen(true);
  }

  function handleInsertTemplateSlide(choice: AddSlideTemplateChoice) {
    const template = TEMPLATE_REGISTRY.get(choice.kind);
    if (!template) return;
    const spec = emptySlideSpecFromLayout(
      choice.kind,
      choice.layoutId,
      TEMPLATE_REGISTRY,
    );
    const result = insertTemplateSlide(
      deck,
      spec,
      template,
      activeSlideIndex + 1,
    );
    onDeckChange(result.deck);
    setActiveSlideIndex(result.index);
    clearActiveEditingState();
    setAddSlidePickerOpen(false);
    setStageAnnouncement(`${template.label} slide added.`);
  }

  function handleInsertNode(node: SlideChildNode) {
    if (!activeSlide) return;
    const result = insertNode(deck, activeSlide.id, node);
    onDeckChange(result.deck);
    setSelection((s) => setSelectedNodeIds(s, [result.nodeId]));
    setFocusedNodeId(result.nodeId);
    window.setTimeout(
      () => focusStageNode(focusGeometryRegistry, result.nodeId),
      0,
    );
  }

  function handleInsertText() {
    handleInsertNode(defaultTextNode(nextLayeredZIndex(activeSlide, "text")));
  }

  function handleInsertShape() {
    handleInsertNode(defaultShapeNode(nextLayeredZIndex(activeSlide, "shape")));
  }

  function handleInsertTable() {
    handleInsertNode(defaultTableNode(nextLayeredZIndex(activeSlide, "table")));
  }

  function handleInsertImage() {
    if (!activeSlide) return;
    insertImagePendingRef.current = true;
    replaceImageTargetIdRef.current = null;
    replaceImageFileInputRef.current?.click();
  }

  function handleReplaceSelectedImageRequest() {
    if (!selectedNode || selectedNode.type !== "image") return;
    insertImagePendingRef.current = false;
    replaceImageTargetIdRef.current = selectedNode.id;
    replaceImageFileInputRef.current?.click();
  }

  async function deckWithUploadedImageAsset(file: File): Promise<
    | {
        deckWithAsset: DeckV7;
        assetId: string;
        alt: string;
      }
    | undefined
  > {
    const upload = onUploadImage
      ? await onUploadImage(file)
      : { src: await readImageFileAsDataUrl(file) };
    return createDeckWithUploadedImageAsset({
      deck,
      upload,
      fileName: file.name,
      fileType: file.type,
      createAssetId: assetFactoryId,
    });
  }

  async function handleReplaceImageFile(file: File | undefined) {
    const targetId = replaceImageTargetIdRef.current;
    const inserting = insertImagePendingRef.current;
    replaceImageTargetIdRef.current = null;
    insertImagePendingRef.current = false;
    if (!file || !activeSlide || (!targetId && !inserting)) return;
    if (!file.type.startsWith("image/")) {
      setToolbarError("Choose an image file to replace the selected image.");
      return;
    }
    try {
      const uploadedImage = await deckWithUploadedImageAsset(file);
      if (!uploadedImage) return;
      const { deckWithAsset, assetId, alt } = uploadedImage;
      if (inserting) {
        const node = defaultImageNode(nextLayeredZIndex(activeSlide, "image"));
        if (node.type !== "image") return;
        const result = insertNode(deckWithAsset, activeSlide.id, {
          ...node,
          content: { ...node.content, assetId, alt },
        });
        onDeckChange(result.deck);
        setSelection((s) => setSelectedNodeIds(s, [result.nodeId]));
        focusSelectedNodeSoon(result.nodeId);
      } else if (targetId) {
        onDeckChange(
          updateNodeContent(deckWithAsset, activeSlide.id, targetId, {
            assetId,
            alt,
          }),
        );
        setSelection((s) => setSelectedNodeIds(s, [targetId]));
        focusSelectedNodeSoon(targetId);
      }
      setToolbarError(null);
    } catch {
      setToolbarError("Image replacement failed. Please try another file.");
    }
  }

  function handleUploadSlideBackgroundImageRequest() {
    if (!activeSlide) return;
    replaceSlideBackgroundFileInputRef.current?.click();
  }

  async function handleReplaceSlideBackgroundImageFile(file: File | undefined) {
    if (!file || !activeSlide) return;
    if (!file.type.startsWith("image/")) {
      setToolbarError("Choose an image file to set the slide background.");
      return;
    }
    const slideId = activeSlide.id;
    try {
      const uploadedImage = await deckWithUploadedImageAsset(file);
      if (!uploadedImage) return;
      onDeckChange(
        updateSlideLocalStyle(uploadedImage.deckWithAsset, slideId, {
          slide: {
            background: {
              type: "image",
              assetId: uploadedImage.assetId,
              opacity: 1,
            },
          },
        }),
      );
      setToolbarError(null);
    } catch {
      setToolbarError(
        "Background image upload failed. Please try another file.",
      );
    }
  }

  async function handleInsertVisual() {
    if (!activeSlide) return;
    if (!onPickVisual) {
      handleInsertNode(
        defaultVisualNode(nextLayeredZIndex(activeSlide, "visual")),
      );
      setToolbarError(null);
      return;
    }
    const pickResult = await runVisualPickerMutation({
      onPickVisual,
      onPicked: (picked) => {
        const deckWithAsset = deckWithPickedVisualAsset(deck, picked);
        const node = defaultVisualNode(
          nextLayeredZIndex(activeSlide, "visual"),
        );
        if (node.type !== "visual") return;
        const result = insertNode(deckWithAsset, activeSlide.id, {
          ...node,
          content: {
            ...node.content,
            ...visualContentPatchFromPick(picked),
          },
        });
        onDeckChange(result.deck);
        setSelection((s) => setSelectedNodeIds(s, [result.nodeId]));
        focusSelectedNodeSoon(result.nodeId);
      },
    });
    if (pickResult === "failed") {
      setToolbarError(VISUAL_PICKER_FAILURE_MESSAGE);
      return;
    }
    setToolbarError(null);
  }

  async function handleReplaceSelectedVisual() {
    if (!activeSlide || !selectedNode || selectedNode.type !== "visual") return;
    if (!onPickVisual) {
      setStageAnnouncement("No visual picker is configured for this editor.");
      return;
    }
    const pickResult = await runVisualPickerMutation({
      onPickVisual,
      onPicked: (picked) => {
        onDeckChange(
          updateNodeContent(
            deckWithPickedVisualAsset(deck, picked),
            activeSlide.id,
            selectedNode.id,
            visualContentPatchFromPick(picked),
          ),
        );
        setSelection((s) => setSelectedNodeIds(s, [selectedNode.id]));
        focusSelectedNodeSoon(selectedNode.id);
      },
    });
    if (pickResult === "failed") {
      setToolbarError(VISUAL_PICKER_FAILURE_MESSAGE);
      return;
    }
    setToolbarError(null);
  }

  function handleInsertConnector() {
    handleInsertNode(
      defaultConnectorNode(nextLayeredZIndex(activeSlide, "connector")),
    );
  }

  function handleInsertDocumentSourceBlock(
    block: Parameters<typeof createDocumentSourceNode>[0]["block"],
  ) {
    if (!activeSlide) return;
    const result = insertNode(
      deck,
      activeSlide.id,
      createDocumentSourceNode({
        block,
        nodeId: nodeFactoryId(block.kind),
        zIndex: nextLayeredZIndex(activeSlide, block.kind),
        linkedAt: new Date().toISOString(),
      }),
    );
    onDeckChange(result.deck);
    setSelection((s) => setSelectedNodeIds(s, [result.nodeId]));
    focusSelectedNodeSoon(result.nodeId);
    setSourceMenuOpen(false);
    setStageAnnouncement(
      `Inserted ${sourceBlockKindLabel(block.kind)} from document.`,
    );
  }

  function focusSelectedNodeSoon(nodeId: string | undefined) {
    if (!nodeId) return;
    setFocusedNodeId(nodeId);
    window.setTimeout(() => focusStageNode(focusGeometryRegistry, nodeId), 0);
  }

  function focusStageViewportSoon() {
    window.setTimeout(() => {
      const stageViewport = stageViewportRef.current;
      if (stageViewport) {
        stageViewport.focus();
        return;
      }
      editorRootRef.current?.focus();
    }, 0);
  }

  function handleContextToolbarEscape() {
    if (firstSelectedId) {
      focusSelectedNodeSoon(firstSelectedId);
      return;
    }
    focusStageViewportSoon();
  }

  function handleCopyNodes() {
    if (!activeSlide || selectedIds.length === 0) return;
    const copied = selectedIds
      .map((id) => findNodeById(activeSlide.children, id))
      .filter((node): node is SlideChildNode => node !== undefined);
    setClipboardNodes(copied);
  }

  function handlePasteNodes() {
    if (!activeSlide || clipboardNodes.length === 0) return;
    const result = pasteNodes(deck, activeSlide.id, clipboardNodes);
    onDeckChange(result.deck);
    if (result.nodeIds.length > 0) {
      setSelection((s) => setSelectedNodeIds(s, result.nodeIds));
      focusSelectedNodeSoon(result.nodeIds[0]);
    }
  }

  function applySelectionDeletion(
    deletedIds: readonly string[],
    nextDeck: DeckV7,
  ) {
    if (!activeSlide || deletedIds.length === 0) return;
    const deletedCount = deletedIds.length;
    const replacementId = replacementNodeAfterDelete(deletedIds);
    onDeckChange(nextDeck);
    if (tableEditingNodeId && deletedIds.includes(tableEditingNodeId)) {
      clearTableEditing();
    }
    if (activeGroupId && deletedIds.includes(activeGroupId)) {
      setActiveGroupId(null);
    }
    if (replacementId) {
      setSelection((s) => setSelectedNodeIds(s, [replacementId]));
      setFocusedNodeId(replacementId);
      window.setTimeout(
        () => focusStageNode(focusGeometryRegistry, replacementId),
        0,
      );
    } else {
      setSelection((s) => clearSelection(s));
      setFocusedNodeId(null);
      window.setTimeout(() => editorRootRef.current?.focus(), 0);
    }
    setStageAnnouncement(
      `Deleted ${deletedCount} ${deletedCount === 1 ? "node" : "nodes"}, ${Math.max(
        0,
        nodesInReadingOrder(activeSlide.children).length - deletedCount,
      )} remaining`,
    );
  }

  function handleCutNodes() {
    if (!activeSlide || selectedIds.length === 0) return;
    const result = cutNodes(deck, activeSlide.id, selectedIds);
    if (result.nodes.length === 0) return;
    setClipboardNodes(result.nodes);
    applySelectionDeletion(selectedIds, result.deck);
  }

  function handleGroupSelection() {
    if (!activeSlide || selectedIds.length < 2) return;
    const groupId = nodeFactoryId("group");
    onDeckChange(
      groupNodes(deck, activeSlide.id, selectedIds, groupId, {
        ref: "surface.card",
      }),
    );
    setSelection((s) => setSelectedNodeIds(s, [groupId]));
    setActiveGroupId(groupId);
    setStageAnnouncement("Grouped nodes. Group context active.");
    focusSelectedNodeSoon(groupId);
  }

  function handleUngroupSelection() {
    if (!activeSlide || !selectedNode || selectedNode.type !== "group") return;
    const result = ungroupNodes(deck, activeSlide.id, selectedNode.id);
    onDeckChange(result.deck);
    setActiveGroupId((current) =>
      current === selectedNode.id ? null : current,
    );
    if (result.nodeIds.length > 0) {
      setSelection((s) => setSelectedNodeIds(s, result.nodeIds));
      setStageAnnouncement("Ungrouped nodes");
      focusSelectedNodeSoon(result.nodeIds[0]);
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
      buildKeyboardConnectorNodeVNext({
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

  function handleKeyboardConnectorModeKey(
    event: KeyboardEvent<HTMLDivElement>,
  ): boolean {
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
    const targetId = nextKeyboardConnectorTargetIdVNext(
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

  function handleKeyboardConnectorShortcut(
    event: KeyboardEvent<HTMLDivElement>,
  ) {
    if (!activeSlide) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key.toLowerCase() !== "c") return false;
    const selectedConnector =
      selectedIds.length <= 1 && selectedNode?.type === "connector"
        ? selectedNode
        : undefined;
    if (selectedConnector?.layout) {
      const endpointKey = event.shiftKey ? "from" : "to";
      const nextEndpoint = cycleConnectorEndpointAnchorVNext(
        selectedConnector.content[endpointKey],
      );
      if (nextEndpoint !== selectedConnector.content[endpointKey]) {
        event.preventDefault();
        const nextFrame = connectorFrameForEndpointsVNext(
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
      const mode = startKeyboardConnectorModeVNext(
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

  function semanticHitsAtPoint(
    point: { x: number; y: number },
    options: { selectedNodeBonus?: boolean } = {},
  ): StageHitCandidate[] {
    if (!activeSlide) return [];
    const hits = hitTestSlideNodes(point, activeSlide.children, {
      includeLocked: true,
      stageAspect: canvasAspectRatio(deck),
      selectedNodeBonus: options.selectedNodeBonus,
      selectedNodeIds: new Set(selectedIds),
    });
    semanticCandidateStackRef.current = stageCandidateNodeIds(hits);
    return hits;
  }

  function semanticHitsFromEvent(
    event: Pick<
      MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
      "clientX" | "clientY" | "target"
    >,
    options: { selectedNodeBonus?: boolean } = {},
  ): StageHitCandidate[] {
    const canvasElement = canvasElementFromTarget(event.target);
    if (
      !canvasElement ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      return [];
    }
    const rect = canvasElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    return semanticHitsAtPoint(pointPctFromEvent(event, rect), options);
  }

  function semanticTargetFromEvent(
    fallbackNodeId: string,
    event: Pick<
      MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
      "clientX" | "clientY" | "target"
    >,
    options: { selectedNodeBonus?: boolean } = {},
  ): StageNodeInteractionTarget | null {
    if (!activeSlide) return null;
    return resolveStageNodeTarget({
      hits: semanticHitsFromEvent(event, options),
      nodes: activeSlide.children,
      fallbackNodeId,
    });
  }

  function semanticTargetFromHits(
    hits: readonly StageHitCandidate[],
  ): StageNodeInteractionTarget | null {
    if (!activeSlide) return null;
    return resolveStageNodeTarget({
      hits,
      nodes: activeSlide.children,
    });
  }

  function isInlineEditableNode(
    node: SlideChildNode,
  ): node is Extract<SlideChildNode, { type: "text" }> {
    return node.type === "text";
  }

  function inlineEditableNodeHasText(
    node: Extract<SlideChildNode, { type: "text" }>,
  ): boolean {
    const paragraphs = node.content.paragraphs;
    return (
      paragraphs?.some((paragraph) => paragraph.text.trim().length > 0) === true
    );
  }

  function initialCaretFromNodeClick(
    node: Extract<SlideChildNode, { type: "text" }>,
    event: Pick<MouseEvent | ReactPointerEvent, "clientX" | "clientY">,
  ): InlineTextInitialCaret {
    return inlineEditableNodeHasText(node) &&
      Number.isFinite(event.clientX) &&
      Number.isFinite(event.clientY)
      ? { kind: "client", x: event.clientX, y: event.clientY }
      : { kind: "start" };
  }

  function applyStageTargetContext(target: StageNodeInteractionTarget) {
    const nextActiveGroupId = nextActiveGroupIdForStageTarget({
      currentActiveGroupId: activeGroupId,
      target,
    });
    if (nextActiveGroupId !== activeGroupId) {
      setActiveGroupId(nextActiveGroupId);
    }
  }

  function applyActiveGroupContext(nodeId: string) {
    if (!activeSlide) return;
    const target = resolveStageNodeTarget({
      hits: [],
      nodes: activeSlide.children,
      fallbackNodeId: nodeId,
    });
    if (target) applyStageTargetContext(target);
  }

  function handleStageContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!activeSlide || isEditableTarget(event.target)) return;
    if (isStageEditingHandleTarget(event.target)) return;
    const hits = semanticHitsFromEvent(event, { selectedNodeBonus: true });
    const target = semanticTargetFromHits(hits);
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();
    const targetNodeId = target.nodeId;
    if (inlineEditNodeId && inlineEditNodeId !== targetNodeId) {
      exitInlineEdit();
    }
    if (tableEditingNodeId && tableEditingNodeId !== targetNodeId) {
      clearTableEditing();
    }
    applyStageTargetContext(target);
    setFocusedNodeId(targetNodeId);
    if (!selectedIds.includes(targetNodeId)) {
      setSelection((s) => setSelectedNodeIds(s, [targetNodeId]));
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodeId: targetNodeId,
      candidateIds: target.candidateIds,
    });
  }

  function handleNodeFocus(nodeId: string) {
    setFocusedNodeId(nodeId);
    if (activeSlide) {
      const parentGroupId = parentGroupIdForNode(activeSlide.children, nodeId);
      if (parentGroupId) setActiveGroupId(parentGroupId);
    }
    if (!selectedIds.includes(nodeId)) {
      setSelection((s) => setSelectedNodeIds(s, [nodeId]));
    }
  }

  function replacementNodeAfterDelete(
    deletedIds: readonly string[],
  ): string | undefined {
    if (!activeSlide) return undefined;
    const deleted = new Set(deletedIds);
    const ordered = nodesInReadingOrder(activeSlide.children);
    const firstDeletedIndex = ordered.findIndex((node) => deleted.has(node.id));
    const remaining = ordered.filter((node) => !deleted.has(node.id));
    if (remaining.length === 0) return undefined;
    return remaining[
      Math.max(0, Math.min(firstDeletedIndex, remaining.length - 1))
    ]?.id;
  }

  function handleDeleteSelection() {
    if (!activeSlide || selectedIds.length === 0) return;
    applySelectionDeletion(
      selectedIds,
      deleteNodes(deck, activeSlide.id, selectedIds),
    );
  }

  function handleNodeDoubleClick(nodeId: string, event: MouseEvent) {
    if (!activeSlide) return;
    const target = semanticTargetFromEvent(nodeId, event, {
      selectedNodeBonus: false,
    });
    if (!target) return;
    const targetNodeId = target.nodeId;
    const node = target.node;
    if (node.type === "group") {
      setActiveGroupId(node.id);
      const firstChildId = childIdsForGroup(activeSlide.children, node.id)[0];
      if (firstChildId) {
        setSelection((s) => setSelectedNodeIds(s, [firstChildId]));
        focusSelectedNodeSoon(firstChildId);
      }
      setStageAnnouncement("Entered group. Press Escape to exit group.");
      return;
    }
    if (node.type === "table") {
      handleEnterTableEdit(targetNodeId, {
        announcement: "Editing table cells",
      });
      return;
    }
    if (node.type === "text") {
      setSelection((s) => setSelectedNodeIds(s, [targetNodeId]));
      applyStageTargetContext(target);
      enterInlineEdit(targetNodeId);
    }
  }

  function handleInlineEditCommit(
    nodeId: string,
    paragraphs: import("@/lib/presentation-vnext/schema").Paragraph[],
    nextFrame?: LayoutBox["frame"],
    textAlign?: "left" | "center" | "right",
  ) {
    if (!activeSlide) return;
    const node = findNodeById(activeSlide.children, nodeId);
    if (!node || node.type !== "text") return;
    const updated = applyInlineTextCommit({
      deck,
      slideId: activeSlide.id,
      node,
      paragraphs,
      nextFrame,
      textAlign,
    });
    onDeckChange(updated);
    exitInlineEdit();
  }

  function handleInlineEditCancel() {
    exitInlineEdit();
  }

  function handleInlineEditTab(direction: 1 | -1) {
    if (!activeSlide || !inlineEditNodeId) return;
    const nextId = adjacentInlineEditableNodeId(
      activeSlide.children,
      inlineEditNodeId,
      direction,
    );
    if (!nextId || nextId === inlineEditNodeId) return;
    setSelection((s) => setSelectedNodeIds(s, [nextId]));
    enterInlineEdit(nextId);
  }

  function handleStageClick(e: MouseEvent) {
    if (suppressStageClickRef.current) return;
    if (isEditableTarget(e.target)) return;
    if (e.target instanceof HTMLElement && e.target.closest("[data-node-id]")) {
      return;
    }
    setSelection((s) => clearSelection(s));
    setFocusedNodeId(null);
    setActiveGroupId(null);
    clearTableEditing();
  }

  function handleStageDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (
      !activeSlide ||
      inlineEditNodeId ||
      tableEditingNodeId ||
      isEditableTarget(event.target)
    ) {
      return;
    }
    if (isStageHandleTarget(event.target)) return;
    const canvasElement = canvasElementFromTarget(event.target);
    if (!canvasElement) return;
    const rect = canvasElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const point = pointPctFromEvent(event, rect);
    const result = insertNode(
      deck,
      activeSlide.id,
      textNodeAtPoint(point, nextLayeredZIndex(activeSlide, "text")),
    );
    onDeckChange(result.deck);
    setSelection((selectionState) =>
      setSelectedNodeIds(selectionState, [result.nodeId]),
    );
    setFocusedNodeId(result.nodeId);
    setActiveGroupId(null);
    clearTableEditing();
    enterInlineEdit(result.nodeId, { kind: "start" });
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activeSlide || event.button !== 0 || isEditableTarget(event.target)) {
      return;
    }
    if (isStageHandleTarget(event.target)) return;
    const canvasElement = canvasElementFromTarget(event.target);
    if (!canvasElement) return;
    const rect = canvasElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Pressing the empty stage exits an in-progress inline/table edit.
    if (inlineEditNodeId) exitInlineEdit();
    if (tableEditingNodeId) clearTableEditing();

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
      isEditableTarget(event.target) ||
      isStageEditingHandleTarget(event.target)
    ) {
      setHoveredNodeId((current) => (current === null ? current : null));
      setSlideHovered((current) => (current === false ? current : false));
      return;
    }
    const hits = semanticHitsFromEvent(event, {
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
    semanticCandidateStackRef.current = [];
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
        const point = pointPctFromEvent(moveEvent, rect);
        const deltaX = ((point.x - start.x) / frame.w) * 100;
        const deltaY = ((point.y - start.y) / frame.h) * 100;
        const nextCrop: ImageCrop = { ...startCrop };
        if (handle === "left")
          nextCrop.left = clampCrop(startCrop.left + deltaX);
        if (handle === "right") {
          nextCrop.right = clampCrop(startCrop.right - deltaX);
        }
        if (handle === "top") nextCrop.top = clampCrop(startCrop.top + deltaY);
        if (handle === "bottom") {
          nextCrop.bottom = clampCrop(startCrop.bottom - deltaY);
        }
        gesture.update(nextCrop);
        setStageAnnouncement(`Cropping image ${handle}`);
      },
      onEnd: () => {
        gesture.finish();
        setActiveCropHandle(null);
      },
    });
  }

  function handleResetSelectedImageCrop() {
    if (!activeSlide || !selectedNode || selectedNode.type !== "image") return;
    onDeckChange(resetImageCrop(deck, activeSlide.id, selectedNode.id));
    setSelection((s) => setSelectedNodeIds(s, [selectedNode.id]));
    focusSelectedNodeSoon(selectedNode.id);
    setStageAnnouncement("Image crop reset");
  }

  function toggleSelectionMode() {
    const normalSelectableIds =
      activeSlideTree !== null
        ? getSelectableNodes(activeSlideTree, "normal").map((node) => node.id)
        : activeSlide
          ? flattenEditorNodes(activeSlide.children).map((node) => node.id)
          : [];
    setSelection((s) =>
      setSelectionMode(
        s,
        s.mode === "normal" ? "layers" : "normal",
        s.mode === "layers" ? normalSelectableIds : undefined,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Resolved render tree
  // ---------------------------------------------------------------------------

  const renderTree = useDeckV7RenderTree(deck, pkg);
  const activeSlideTree = renderTree?.slides[activeSlideIndex] ?? null;
  const stageNodeGestureDrafts = buildStageNodeGestureDrafts({
    moveGestureDraft,
    resizeGestureDraft,
    cropGestureDraft,
    rotationGestureDraft,
    connectorGestureDraft,
  });
  const stageGestureBadge = buildStageGestureBadge({
    moveGestureDraft,
    resizeGestureDraft,
  });

  const exportDiagnostics = useExportDiagnostics(renderTree);

  // ---------------------------------------------------------------------------
  // Selected node data (from the persisted deck, not the resolved tree)
  // ---------------------------------------------------------------------------

  const selectedIds = selectedNodeIds(selection);
  const firstSelectedId = selectedIds[0];

  const selectedNode: SlideChildNode | undefined =
    activeSlide && firstSelectedId
      ? findNodeById(activeSlide.children, firstSelectedId)
      : undefined;
  const selectedSource = selectedNode?.source;
  const {
    documentSourceIndex,
    sourceDerivations,
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
    handleDismissSourceAt,
    handleRefreshAllSources,
    handleSyncFromDocument,
    handleReviewSourceLinks,
  } = useSourceReviewController({
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
  });
  const diagnostics = dedupeDiagnostics([
    ...boundaryDiagnostics,
    ...(renderTree?.diagnostics ?? []),
    ...exportDiagnostics,
    ...sourceDerivations.diagnostics,
  ]);
  const {
    tableEditingNodeId,
    activeTableCell,
    clearTableEditing,
    handleEnterTableEdit,
    handleTableCellFocus,
    handleTableCellCommit,
    handleTableCellKeyDown,
  } = useTableCellEditing({
    deck,
    activeSlide,
    selectedNodeId: firstSelectedId,
    selectedNodeIds: selectedIds,
    findNodeById,
    setSelection,
    setFocusedNodeId,
    onDeckChange,
    setStageAnnouncement,
    focusSelectedNodeSoon,
  });
  const slidePresence = useSlidePresence({
    documentId,
    userName: presenceUserName,
    userId: presenceUserId,
    selectedSlideId: activeSlide?.id ?? null,
    selectedNodeIds: selectedIds,
    editingMode:
      inlineEditNodeId || tableEditingNodeId
        ? "editing"
        : selectedIds.length > 0
          ? "selecting"
          : "browsing",
    awareness: presenceAwareness,
    deck,
  });
  const remotePresencePeers = slidePresence.peers.filter((peer) => !peer.self);

  useEffect(() => {
    return scheduleEffectStateUpdate(() => {
      if (!activeSlide) {
        setActiveGroupId(null);
        clearTableEditing();
        return;
      }
      if (activeGroupId && !findNodeById(activeSlide.children, activeGroupId)) {
        setActiveGroupId(null);
      }
      if (
        tableEditingNodeId &&
        findNodeById(activeSlide.children, tableEditingNodeId)?.type !== "table"
      ) {
        clearTableEditing();
      }
    });
  }, [activeGroupId, activeSlide, clearTableEditing, tableEditingNodeId]);

  // Also find the selected resolved node to support decoration detach
  const selectedResolvedNode: ResolvedRenderNode | undefined =
    activeSlideTree && firstSelectedId
      ? [
          ...activeSlideTree.nodes,
          ...(selection.mode === "layers" ? activeSlideTree.decorations : []),
          ...(selection.mode === "layers" ? activeSlideTree.chrome : []),
        ].find((n) => n.id === firstSelectedId)
      : undefined;

  useEffect(() => {
    return scheduleEffectStateUpdate(() => {
      if (selectedIds.length === 0) {
        setStageAnnouncement("Slide selected");
      } else if (selectedIds.length === 1) {
        const type = selectedNode?.type ?? "node";
        setStageAnnouncement(
          `${type.charAt(0).toUpperCase()}${type.slice(1)} selected`,
        );
      } else {
        setStageAnnouncement(`${selectedIds.length} nodes selected`);
      }
    });
  }, [selectedIds, selectedNode?.type, setStageAnnouncement]);

  function resolveDeckAsset(assetId: string): string | undefined {
    return resolveDeckAssetSource(deck, assetId);
  }

  // Alt-click cycles the selection to the node beneath the current one
  // (select-under). Kept as a helper so both the click fallback and the
  // Alt-drag gesture can reuse the exact legacy behavior.
  function selectUnderFromHits(hits: readonly StageHitCandidate[]) {
    const nextId = nextSemanticSelectUnderNodeId(
      stageCandidateNodeIds(hits),
      new Set(selectedIds),
    );
    if (nextId) {
      setSelection((s) => setSelectedNodeIds(s, [nextId]));
      setFocusedNodeId(nextId);
      applyActiveGroupContext(nextId);
    }
  }

  // Alt-drag duplicates the dragged node(s) and drops the copies at the moved
  // position, leaving the originals in place (Canva parity). Alt without any
  // movement falls back to select-under so the legacy click behavior is intact.
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
    if (!target || !rect || rect.width <= 0 || rect.height <= 0) {
      selectUnderFromHits(hits);
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
      selectUnderFromHits(hits);
      return;
    }
    const alignmentGuides = alignmentGuidesForFrames(
      layoutFramesExcluding(activeSlide.children, new Set(dragIds)),
    );

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
      // Alt-drag never mutates the originals — the duplicates are created on
      // release instead, so the commit path is intentionally empty.
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
          snapToGuides: snapToGuides,
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
          selectUnderFromHits(hits);
        }
      },
    });
  }

  function handleNodePointerDown(nodeId: string, event: ReactPointerEvent) {
    if (!activeSlide || event.button !== 0 || isEditableTarget(event.target)) {
      return;
    }
    const hits = semanticHitsFromEvent(event, { selectedNodeBonus: false });
    if (event.altKey) {
      handleAltNodePointerDown(nodeId, event, hits);
      return;
    }

    const target = resolveStageNodeTarget({
      hits,
      nodes: activeSlide.children,
      fallbackNodeId: nodeId,
    });
    if (!target) return;
    const targetNodeId = target.nodeId;
    // Pressing another node exits an in-progress inline/table edit so the
    // original node does not stay in edit state while dragging/selecting.
    if (inlineEditNodeId && inlineEditNodeId !== targetNodeId) {
      exitInlineEdit();
    }
    if (tableEditingNodeId && tableEditingNodeId !== targetNodeId) {
      clearTableEditing();
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
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const originalFrames = new Map<string, LayoutBox["frame"]>();
    for (const id of dragIds) {
      const node = findNodeById(activeSlide.children, id);
      if (!node?.layout || node.locked) continue;
      originalFrames.set(id, node.layout.frame);
    }
    if (originalFrames.size === 0) return;
    const alignmentGuides = alignmentGuidesForFrames(
      layoutFramesExcluding(activeSlide.children, new Set(dragIds)),
    );

    const startX = event.clientX;
    const startY = event.clientY;
    let dragThresholdPassed = false;
    let pointerMovedPastClickThreshold = false;
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
        if (!dragThresholdPassed) {
          dragThresholdPassed = true;
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
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    setActiveResizeHandle({ nodeId, handle });
    const startX = event.clientX;
    const startY = event.clientY;
    const originalFrame = node.layout.frame;
    const alignmentGuides = alignmentGuidesForFrames(
      layoutFramesExcluding(activeSlide.children, new Set([nodeId])),
    );
    const gesture = createSingleCommitGesture<LayoutBox["frame"]>({
      initialValue: originalFrame,
      equals: framesEqual,
      onPreview: (frame) =>
        setResizeGestureDraft(frame ? { nodeId, frame } : null),
      onCommit: (frame) =>
        onDeckChange(
          updateNodeLayout(deck, activeSlide.id, nodeId, {
            frame,
          }),
        ),
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        const deltaX = ((moveEvent.clientX - startX) / rect.width) * 100;
        const deltaY = ((moveEvent.clientY - startY) / rect.height) * 100;
        // Shift locks the aspect ratio during resize (Canva parity), matching
        // the always-on lock for nodes that declare preserveAspectRatio.
        const constrainAspect =
          node.layout?.constraints?.preserveAspectRatio === true ||
          moveEvent.shiftKey;
        const nextFrame = constrainAspect
          ? applyAspectLock(
              originalFrame,
              resizeFrame(originalFrame, handle, deltaX, deltaY),
            )
          : resizeFrame(originalFrame, handle, deltaX, deltaY);
        const snapped =
          snapToGuides && !moveEvent.altKey
            ? snapFrameToStageGuides(nextFrame, 0.75, alignmentGuides)
            : { frame: nextFrame, guides: [] as StageGuide[] };
        setStageGuides(snapped.guides);
        gesture.update(snapped.frame);
      },
      onEnd: () => {
        gesture.finish();
        setActiveResizeHandle(null);
        setStageGuides([]);
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
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const frame = node.layout.frame;
    const center = {
      x: rect.left + ((frame.x + frame.w / 2) / 100) * rect.width,
      y: rect.top + ((frame.y + frame.h / 2) / 100) * rect.height,
    };
    const startAngle =
      (Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180) /
      Math.PI;
    const startRotation = node.layout.rotation ?? 0;

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
        const angle =
          (Math.atan2(
            moveEvent.clientY - center.y,
            moveEvent.clientX - center.x,
          ) *
            180) /
          Math.PI;
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
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    setActiveConnectorEndpoint({ nodeId, endpoint });
    setSelection((s) => setSelectedNodeIds(s, [nodeId]));
    const connectorFrame = node.layout.frame;
    const startEndpoint = node.content[endpoint];
    const gesture = createSingleCommitGesture<ConnectorEndpoint>({
      initialValue: startEndpoint,
      equals: connectorEndpointsEqual,
      onPreview: (value) =>
        setConnectorGestureDraft(value ? { nodeId, endpoint, value } : null),
      onCommit: (value) =>
        onDeckChange(
          updateNodeContent(deck, activeSlide.id, nodeId, {
            [endpoint]: value,
          }),
        ),
    });

    startPointerDragLifecycle(event, {
      onMove: (moveEvent) => {
        const slidePoint = pointPctFromEvent(moveEvent, rect);
        const snapped =
          nearestConnectorAnchor(activeSlide.children, slidePoint, nodeId) ??
          connectorEndpointFromSlidePoint(slidePoint, connectorFrame);
        gesture.update(snapped);
        setStageAnnouncement(
          snapped.kind === "node"
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

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Don't intercept keys when inline editing is active (inline editor handles them)
    if (inlineEditNodeId) return;
    if (isEditableTarget(event.target)) return;
    if (!activeSlide) return;
    if (keyboardConnectorMode && handleKeyboardConnectorModeKey(event)) {
      return;
    }
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
        window.setTimeout(
          () => focusStageNode(focusGeometryRegistry, nextId),
          0,
        );
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
        setStageAnnouncement("Exited group");
        event.preventDefault();
        return;
      }
      if (selectedIds.length > 0) {
        setSelection((s) => clearSelection(s));
      } else {
        handleCloseRequest();
      }
      event.preventDefault();
      return;
    }

    if (handleKeyboardConnectorShortcut(event)) {
      return;
    }
    // Enter key enters inline edit mode on the selected text/shape node
    if (event.key === "Enter" && selectedIds.length === 1 && selectedNode) {
      if (selectedNode.type === "group") {
        setActiveGroupId(selectedNode.id);
        const firstChildId = childIdsForGroup(
          activeSlide.children,
          selectedNode.id,
        )[0];
        if (firstChildId) {
          setSelection((s) => setSelectedNodeIds(s, [firstChildId]));
          focusSelectedNodeSoon(firstChildId);
        }
        setStageAnnouncement("Entered group. Press Escape to exit group.");
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
      if (event.shiftKey) {
        onRedo?.();
      } else {
        onUndo?.();
      }
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
        window.setTimeout(
          () => focusStageNode(focusGeometryRegistry, primaryId),
          0,
        );
      }
      return;
    }

    if (event.key === "?") {
      setShortcutHelpOpen((open) => !open);
      event.preventDefault();
      return;
    }

    if (event.altKey && event.key === "]") {
      const anchorId = focusedNodeId ?? firstSelectedId;
      let candidateIds = semanticCandidateStackRef.current;
      if (anchorId) {
        const anchorNode = findNodeById(activeSlide.children, anchorId);
        if (anchorNode?.layout) {
          candidateIds = stageCandidateNodeIds(
            semanticHitsAtPoint(
              {
                x: anchorNode.layout.frame.x + anchorNode.layout.frame.w / 2,
                y: anchorNode.layout.frame.y + anchorNode.layout.frame.h / 2,
              },
              { selectedNodeBonus: true },
            ),
          );
        }
      }
      const nextId = nextSemanticSelectUnderNodeId(
        candidateIds,
        new Set(selectedIds),
      );
      if (nextId) {
        setSelection((s) => setSelectedNodeIds(s, [nextId]));
        focusSelectedNodeSoon(nextId);
        applyActiveGroupContext(nextId);
      }
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
      if (event.shiftKey) {
        handleUngroupSelection();
      } else {
        handleGroupSelection();
      }
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

    const arrangeKind = canvasArrangeShortcutKind(event);
    if (arrangeKind) {
      handleReorderSelection(arrangeKind);
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
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Slide root controls
  // ---------------------------------------------------------------------------

  function handleUpdateControls(patch: Partial<SlideControls>) {
    if (!activeSlide) return;
    onDeckChange(updateSlideControls(deck, activeSlide.id, patch));
  }

  function handleUpdateProps(patch: Partial<SlideProps>) {
    if (!activeSlide) return;
    // SlideProps (decoration/chrome) updates are applied via updateSlideControls
    // by merging into the slide props
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
          if (props[key] === undefined) {
            delete props[key];
          }
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

  // ---------------------------------------------------------------------------
  // Style binding
  // ---------------------------------------------------------------------------

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
        window.setTimeout(() => editorRootRef.current?.focus(), 0);
      }
    }
  }

  function handleUpdateSelectedContent(patch: Record<string, unknown>) {
    if (!activeSlide || !firstSelectedId) return;
    onDeckChange(
      updateNodeContent(deck, activeSlide.id, firstSelectedId, patch),
    );
  }

  // ---------------------------------------------------------------------------
  // Local override reset
  // ---------------------------------------------------------------------------

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
    if (activeSlide) {
      setActiveGroupId(parentGroupIdForNode(activeSlide.children, nodeId));
    }
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
    const entries = collectSelectedLayoutEntries(
      activeSlide.children,
      selectedIds,
    );
    const patches = buildAlignSelectionPatches(entries, mode);
    if (patches.size === 0) return;
    onDeckChange(updateNodeLayouts(deck, activeSlide.id, patches));
  }

  function handleDistributeSelection(mode: SelectionDistributeMode) {
    if (!activeSlide) return;
    const entries = collectSelectedLayoutEntries(
      activeSlide.children,
      selectedIds,
    );
    const patches = buildDistributeSelectionPatches(entries, mode);
    if (patches.size === 0) return;
    onDeckChange(updateNodeLayouts(deck, activeSlide.id, patches));
  }

  function handleMatchSize(mode: SelectionMatchSizeMode) {
    if (!activeSlide) return;
    const entries = collectSelectedLayoutEntries(
      activeSlide.children,
      selectedIds,
    );
    const patches = buildMatchSizeSelectionPatches(entries, mode);
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

  function handleDuplicateActiveSlide() {
    if (!activeSlide) return;
    const result = duplicateSlide(deck, activeSlide.id);
    onDeckChange(result.deck);
    if (result.index >= 0) setActiveSlideIndex(result.index);
    setSelection(createSelectionState(selection.mode));
  }

  function handleDeleteActiveSlide() {
    const result = deleteActiveSlideFromToolbar(deck, activeSlide?.id);
    if (!result.deleted) {
      if (result.statusMessage) {
        setStageAnnouncement(result.statusMessage);
      }
      return;
    }
    onDeckChange(result.nextDeck);
    setActiveSlideIndex(result.nextIndex);
    setSelection(createSelectionState(selection.mode));
  }

  // ---------------------------------------------------------------------------
  // Diagnostics actions
  // ---------------------------------------------------------------------------

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
    setActiveSlideIndex(slideIndex);
    exitInlineEdit();
    setHoveredNodeId(null);
    if (node) {
      setSelection((s) => setSelectedNodeIds(s, [node.id]));
      setFocusedNodeId(node.id);
      focusSelectedNodeSoon(node.id);
      return;
    }
    setSelection((s) => clearSelection(s));
    setFocusedNodeId(null);
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
    focusDiagnosticTarget({
      slideId: targetSlide.id,
      ...(targetNode ? { nodeId: targetNode.id } : {}),
    });
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
        replaceImageTargetIdRef.current = node.id;
        insertImagePendingRef.current = false;
        replaceImageFileInputRef.current?.click();
      } else {
        requestInspectorPanel("diagnostics");
        setStageAnnouncement(
          "Select the asset field in the inspector to repair this node.",
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Decoration detach
  // ---------------------------------------------------------------------------

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
    // Build a LayoutBox from the resolved layout (drop framePx)
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

  const stageFit = canvasStageFit(
    deck,
    stageZoomPercent,
    stageViewportSize,
    isDesktopInspectorViewport,
  );
  const stageFrameStyle = canvasFrameStyle(stageFit);
  const stageScrollStyle = stageScrollContentStyle(stageFit);
  const activeSlideName = slideDisplayName(activeSlide, activeSlideIndex);
  const selectedNodeSummary = selectedSummary(selectedIds.length);
  const diagnosticSummary = diagnosticsSummary(diagnostics.length);
  const currentCanvasFormat: "16:9" | "4:3" | "square" =
    deck.canvas.format === "custom" ? "16:9" : deck.canvas.format;
  const saveErrorAnnouncement =
    saveStatus === "error"
      ? saveErrorMessage
        ? `${saveStatusLabel}. ${saveErrorMessage}`
        : saveStatusLabel
      : null;
  const selectionModeLabel =
    selection.mode === "layers" ? "Layers mode" : "Normal mode";
  const activeTemplate = activeSlide
    ? TEMPLATE_REGISTRY.get(activeSlide.template.kind)
    : undefined;
  const activeLayoutId = activeSlide?.template.layoutId;
  const activeSlideBackgroundColor =
    activeSlide?.localStyle?.slide?.background?.type === "solid" &&
    typeof activeSlide.localStyle.slide.background.color === "string"
      ? activeSlide.localStyle.slide.background.color
      : "#ffffff";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isDecorationSelected =
    selectedResolvedNode?.source === "themeDecoration" ||
    selectedResolvedNode?.source === "deckChrome";
  const inspectorKey = `${inspectorPanelRequest?.panel ?? "auto"}-${inspectorPanelRequest?.nonce ?? 0}`;
  const renderInspectorShell = () => (
    <InspectorShell
      key={inspectorKey}
      initialPanel={inspectorPanelRequest?.panel}
      activeSlide={activeSlide}
      deckChrome={deck.chrome}
      selectedNode={selectedNode}
      selectedResolvedStyle={selectedResolvedNode?.style}
      selectedIds={selectedIds}
      isDecorationSelected={isDecorationSelected}
      selectedGeneratedSource={
        selectedResolvedNode?.source === "themeDecoration" ||
        selectedResolvedNode?.source === "deckChrome"
          ? selectedResolvedNode.source
          : undefined
      }
      diagnostics={diagnostics}
      layerDecorations={activeSlideTree?.decorations}
      layerChrome={activeSlideTree?.chrome}
      onUpdateControls={handleUpdateControls}
      onUpdateProps={handleUpdateProps}
      onUpdateDeckChrome={handleUpdateDeckChrome}
      onUpdateSlideAttributes={handleUpdateSlideAttributes}
      onUpdateSlideLocalStyle={handleUpdateSlideLocalStyle}
      onResetSlideLocalStyle={handleResetSlideLocalStyle}
      onUpdateSlideSource={handleUpdateSlideSource}
      onUploadSlideBackgroundImage={handleUploadSlideBackgroundImageRequest}
      onUpdateSelectedLayout={
        handleUpdateSelectedLayout as Parameters<
          typeof InspectorShell
        >[0]["onUpdateSelectedLayout"]
      }
      onUpdateSelectedAttributes={handleUpdateSelectedAttributes}
      onUpdateSelectedContent={handleUpdateSelectedContent}
      onUpdateSelectedLocalStyle={handleUpdateSelectedLocalStyle}
      assetResolver={resolveDeckAsset}
      onReplaceImage={handleReplaceSelectedImageRequest}
      onReplaceVisual={handleReplaceSelectedVisual}
      onResetToTheme={handleResetToTheme}
      onUpdateSelectedSource={handleUpdateSelectedSource}
      onRefreshSelectedSource={handleRefreshSelectedSource}
      onUnlinkSelectedSource={
        activeSlide && selectedNode
          ? () => handleUnlinkSourceAt(activeSlide.id, selectedNode.id)
          : undefined
      }
      onRelinkSelectedSource={
        activeSlide && selectedNode
          ? (block) =>
              handleRelinkSourceAt(activeSlide.id, selectedNode.id, block)
          : undefined
      }
      selectedSourceClassification={selectedSourceClassification}
      sourceBlocks={documentSourceIndex?.blocks}
      onChangeStyleBinding={handleChangeStyleBinding}
      onAlignSelection={handleAlignSelection}
      onDistributeSelection={handleDistributeSelection}
      onMatchSize={handleMatchSize}
      onGroupSelection={handleGroupSelection}
      onUngroupSelection={handleUngroupSelection}
      onReorderSelection={handleReorderSelection}
      onSelectLayer={handleSelectLayer}
      onUpdateLayer={handleUpdateLayer}
      onReorderLayer={handleReorderLayer}
      onDetachDecoration={handleDetachDecoration}
      onDiagnosticAction={handleDiagnosticAction}
      TEMPLATE_OPTIONS={TEMPLATE_OPTIONS}
      activeTemplate={activeTemplate}
      activeLayoutId={activeLayoutId}
      onReapplyTemplate={handleReapplyTemplate}
      selectionMode={selection.mode}
      onToggleSelectionMode={toggleSelectionMode}
    />
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented) return;
      handleEditorKeyDown(event as unknown as KeyboardEvent<HTMLDivElement>);
    }
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  });

  return (
    <div
      role="dialog"
      aria-label="Slide editor"
      data-slide-editor-vnext="true"
      ref={editorRootRef}
      tabIndex={-1}
      onKeyDown={handleEditorKeyDown}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-ds-surface"
    >
      <input
        ref={replaceImageFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          handleReplaceImageFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={replaceSlideBackgroundFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          handleReplaceSlideBackgroundImageFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      {addSlidePickerOpen ? (
        <>
          <div
            data-floating-panel="true"
            aria-hidden="true"
            onClick={() => setAddSlidePickerOpen(false)}
            className="fixed inset-0 z-modal bg-ds-backdrop"
          />
          <FocusTrapped>
            <div
              data-floating-panel="true"
              role="dialog"
              aria-modal="true"
              aria-label="Add semantic slide"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setAddSlidePickerOpen(false);
                }
              }}
              className="fixed inset-x-4 top-8 z-modal mx-auto flex max-h-[calc(100vh-4rem)] max-w-5xl overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface-overlay shadow-ds-overlay"
            >
              <AddSlideTemplatePicker
                templates={TEMPLATE_OPTIONS}
                onChoose={handleInsertTemplateSlide}
                onClose={() => setAddSlidePickerOpen(false)}
              />
            </div>
          </FocusTrapped>
        </>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Top Toolbar                                                         */}
      {/* ------------------------------------------------------------------ */}
      <DeckToolbar>
        <DeckToolbarRow>
          <DeckToolbarGroup label="Deck setup">
            <select
              aria-label="Deck theme"
              value={deck.theme.packageId}
              onChange={(event) =>
                handleThemePackageChange(event.currentTarget.value)
              }
              className={cx(
                "h-8 max-w-36 shrink-0 rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 text-xs font-medium text-ds-text-primary",
                FOCUS_RING,
              )}
            >
              {themePackages.map((themePackageOption) => (
                <option
                  key={themePackageOption.id}
                  value={themePackageOption.id}
                >
                  {themePackageOption.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Slide ratio"
              value={currentCanvasFormat}
              onChange={(event) =>
                handleCanvasRatioChange(
                  event.currentTarget.value as "16:9" | "4:3" | "square",
                )
              }
              className={cx(
                "h-8 shrink-0 rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 text-xs font-medium text-ds-text-primary",
                FOCUS_RING,
              )}
            >
              <option value="16:9">16:9</option>
              <option value="4:3">4:3</option>
              <option value="square">1:1</option>
            </select>
            <Popover
              open={deckChromeToolbarOpen}
              onClose={() => setDeckChromeToolbarOpen(false)}
              aria-label="Deck chrome controls"
              portal
              className="max-h-[calc(100vh-6rem)] w-[22rem] overflow-y-auto p-0"
              trigger={
                <DeckToolbarButton
                  label="Deck chrome"
                  active={deckChromeToolbarOpen}
                  hasPopup="dialog"
                  expanded={deckChromeToolbarOpen}
                  onClick={() => setDeckChromeToolbarOpen((open) => !open)}
                >
                  Deck chrome
                </DeckToolbarButton>
              }
            >
              <div
                ref={deckChromeToolbarPanelRef}
                data-deck-chrome-toolbar-panel="true"
              >
                <DeckChromePanel
                  idPrefix="deck-chrome-toolbar"
                  chrome={deck.chrome}
                  slideProps={activeSlide?.props}
                  onUpdateChrome={handleUpdateDeckChrome}
                  onUpdateSlideProps={handleUpdateProps}
                />
              </div>
            </Popover>
          </DeckToolbarGroup>

          <DeckToolbarDivider />

          <DeckToolbarGroup label="Document source">
            <Popover
              open={sourceMenuOpen}
              onClose={() => setSourceMenuOpen(false)}
              role="menu"
              aria-label="Document source commands"
              portal
              className="w-72 p-2"
              trigger={
                <button
                  ref={sourceMenuTriggerRef}
                  type="button"
                  aria-label="Document source"
                  aria-haspopup="menu"
                  aria-expanded={sourceMenuOpen}
                  aria-controls={sourceMenuOpen ? sourceMenuId : undefined}
                  onClick={() => setSourceMenuOpen((open) => !open)}
                  className={cx(
                    "relative flex h-8 items-center gap-1 rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2.5 text-xs font-medium text-ds-text-primary transition-colors hover:bg-ds-state-hover",
                    FOCUS_RING,
                  )}
                >
                  Source
                  <ChevronDown size={12} aria-hidden="true" />
                  {sourceReview.length > 0 ? (
                    <span className="absolute -right-1 -top-1 rounded-full bg-ds-warning-surface px-1 text-[10px] font-bold text-ds-warning-text">
                      {sourceReview.length}
                    </span>
                  ) : null}
                </button>
              }
            >
              <div
                ref={sourceMenuPanelRef}
                id={sourceMenuId}
                className="space-y-1"
                onKeyDown={handleSourceMenuKeyDown}
              >
                <div className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-secondary">
                  {sourceStatusLabel}
                </div>
                {documentSourceIndex ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleSyncFromDocument}
                    className={cx(
                      "flex w-full items-center rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                      FOCUS_RING,
                    )}
                  >
                    Refresh all source links
                  </button>
                ) : null}
                {sourceReview.length > 0 ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleReviewSourceLinks}
                    className={cx(
                      "flex w-full items-center rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                      FOCUS_RING,
                    )}
                  >
                    Review source links
                  </button>
                ) : null}
                {selectedSource && selectedNode && activeSlide ? (
                  <>
                    <div className="my-1 border-t border-ds-border-subtle" />
                    <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted">
                      Selected source
                    </p>
                    <p className="truncate px-2 py-1 text-[11px] text-ds-text-secondary">
                      {(selectedSource.blockKind ?? "source").toString()} ·{" "}
                      {selectedSource.blockId ?? "linked"}
                    </p>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        void handleRefreshSelectedSource();
                        closeSourceMenuAndRestoreFocus();
                      }}
                      className={cx(
                        "flex w-full items-center rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                        FOCUS_RING,
                      )}
                    >
                      Refresh selected source
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        handleUnlinkSourceAt(activeSlide.id, selectedNode.id);
                        closeSourceMenuAndRestoreFocus();
                      }}
                      className={cx(
                        "flex w-full items-center rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                        FOCUS_RING,
                      )}
                    >
                      Mark selected as unlinked
                    </button>
                  </>
                ) : null}
                {documentInsertBlocks.length > 0 ? (
                  <>
                    <div className="my-1 border-t border-ds-border-subtle" />
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted">
                      From document
                    </p>
                    {documentInsertBlocks.map((block) => (
                      <button
                        key={`${block.kind}:${block.id}`}
                        type="button"
                        role="menuitem"
                        onClick={() => handleInsertDocumentSourceBlock(block)}
                        className={cx(
                          "flex w-full min-w-0 flex-col items-start rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                          FOCUS_RING,
                        )}
                      >
                        <span className="w-full truncate font-medium text-ds-text-primary">
                          {block.displayLabel}
                        </span>
                        <span className="w-full truncate text-[10px] text-ds-text-muted">
                          {sourceBlockKindLabel(block.kind)} · {block.id}
                        </span>
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
            </Popover>
            {onRegenerate ? (
              <DeckToolbarButton
                label="Regenerate deck from document"
                tooltip="Regenerate deck from document"
                disabled={saveStatus === "saving"}
                onClick={() => void handleRegenerate()}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Rebuild
              </DeckToolbarButton>
            ) : null}
          </DeckToolbarGroup>
        </DeckToolbarRow>

        <DeckToolbarGroup label="Deck actions" className="justify-end">
          <Popover
            open={compactToolbarMenuOpen}
            onClose={() => setCompactToolbarMenuOpen(false)}
            role="menu"
            aria-label="More deck commands"
            portal
            className="w-64 p-2"
            trigger={
              <button
                ref={compactToolbarMenuTriggerRef}
                type="button"
                aria-label="Open more deck commands"
                aria-haspopup="menu"
                aria-expanded={compactToolbarMenuOpen}
                aria-controls={
                  compactToolbarMenuOpen ? compactToolbarMenuId : undefined
                }
                onClick={() => setCompactToolbarMenuOpen((open) => !open)}
                className={cx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-ds-md border border-ds-border-subtle bg-ds-surface text-ds-text-muted transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <MoreHorizontal size={15} aria-hidden="true" />
              </button>
            }
          >
            <div
              ref={compactToolbarMenuPanelRef}
              id={compactToolbarMenuId}
              className="space-y-1"
              onKeyDown={handleCompactToolbarMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                aria-label="Keyboard shortcuts"
                onClick={() => {
                  setShortcutHelpOpen(true);
                  closeCompactToolbarMenuAndRestoreFocus();
                }}
                className={cx(
                  "flex w-full items-center gap-2 rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <Keyboard size={14} aria-hidden="true" />
                Keyboard shortcuts
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={snapToGuides}
                onClick={() => {
                  toggleSnapToGuides();
                  closeCompactToolbarMenuAndRestoreFocus();
                }}
                className={cx(
                  "flex w-full items-center justify-between rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <span>Snap to guides</span>
                <span className="text-[10px] text-ds-text-muted">
                  {snapToGuides ? "On" : "Off"}
                </span>
              </button>
              {onSave ? (
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Save now"
                  disabled={saveStatus === "saving"}
                  onClick={() => {
                    void onSave(deck);
                    closeCompactToolbarMenuAndRestoreFocus();
                  }}
                  className={cx(
                    "flex w-full items-center justify-between rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary disabled:opacity-40",
                    FOCUS_RING,
                  )}
                >
                  <span>Save now</span>
                  <span className="text-[10px] text-ds-text-muted">
                    {saveStatusLabel}
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDeckDiagnosticsReviewOpen(true);
                  closeCompactToolbarMenuAndRestoreFocus();
                }}
                className={cx(
                  "flex w-full items-center justify-between rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <span>Diagnostics</span>
                <span className="text-[10px] text-ds-text-muted">
                  {diagnostics.length}
                </span>
              </button>
            </div>
          </Popover>

          <DeckToolbarDivider />

          <DeckToolbarGroup label="Undo and redo">
            <DeckToolbarIconButton
              label="Undo"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Undo2 size={14} aria-hidden="true" />
            </DeckToolbarIconButton>
            <DeckToolbarIconButton
              label="Redo"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <Redo2 size={14} aria-hidden="true" />
            </DeckToolbarIconButton>
          </DeckToolbarGroup>

          {onPresent ? (
            <DeckToolbarIconButton
              label="Present slides"
              disabled={saveStatus === "saving"}
              onClick={() =>
                void handleRoundtripAction(
                  onPresent,
                  "Presentation route failed. Please try again.",
                )
              }
            >
              <MonitorPlay size={14} aria-hidden="true" />
            </DeckToolbarIconButton>
          ) : null}
          {onShare ? (
            <DeckToolbarIconButton
              label="Share slides"
              disabled={saveStatus === "saving"}
              onClick={() =>
                void handleRoundtripAction(
                  onShare,
                  "Share route failed. Please try again.",
                )
              }
            >
              <Share2 size={14} aria-hidden="true" />
            </DeckToolbarIconButton>
          ) : null}
          {onExportPptx ? (
            <DeckToolbarButton
              label="Export as PPTX"
              onClick={() => void handleExportPptx()}
              className="font-semibold"
            >
              <FileDown size={14} aria-hidden="true" />
              Export PPTX
            </DeckToolbarButton>
          ) : null}
          {onClose ? (
            <DeckToolbarIconButton
              label="Close slide editor"
              onClick={handleCloseRequest}
            >
              <X size={16} aria-hidden="true" />
            </DeckToolbarIconButton>
          ) : null}
        </DeckToolbarGroup>
      </DeckToolbar>

      {/* Toolbar action error banner */}
      {toolbarError ? (
        <div
          role="alert"
          className="shrink-0 border-b border-ds-danger-border bg-ds-danger-surface px-3 py-2 text-xs text-ds-danger-text"
        >
          {toolbarError}
        </div>
      ) : null}

      {documentSourceIndex ? (
        <SourceReviewPanel
          items={sourceReview}
          sourceBlocks={documentSourceIndex.blocks}
          onSelect={handleSelectSourceItem}
          onRefresh={handleRefreshSourceAt}
          onUnlink={handleUnlinkSourceAt}
          onRelink={handleRelinkSourceAt}
          onDismiss={handleDismissSourceAt}
          onRefreshAll={handleRefreshAllSources}
          statusMessage={sourceReviewStatus}
        />
      ) : null}

      <KeyboardShortcutHelpDialog
        open={shortcutHelpOpen}
        isMac={isMac}
        onClose={() => setShortcutHelpOpen(false)}
      />

      {deckDiagnosticsReviewOpen ? (
        <FocusTrapped>
          <DeckDiagnosticsReview
            diagnostics={diagnostics}
            onClose={() => setDeckDiagnosticsReviewOpen(false)}
            onNavigate={handleDiagnosticNavigate}
            onAction={handleDiagnosticAction}
          />
        </FocusTrapped>
      ) : null}
      {closeConfirmOpen ? (
        <SlideEditorCloseConfirmDialog
          onCancel={handleCloseConfirmCancel}
          onDiscard={handleCloseConfirmDiscard}
        />
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Editor surface (stage + inspector — rail moved to bottom filmstrip)  */}
      {/* ------------------------------------------------------------------ */}
      <div className="relative isolate min-h-0 flex-1 overflow-hidden bg-ds-surface-recessed">
        {/* ------------------------------------------------------------------ */}
        {/* Main Stage                                                          */}
        {/* ------------------------------------------------------------------ */}
        <div
          data-slide-stage-shell="true"
          data-slide-toolbar-anchor="true"
          className="relative h-full min-w-0 overflow-hidden bg-ds-surface-recessed"
          onClick={handleStageClick}
          onContextMenu={handleStageContextMenu}
          onDoubleClick={handleStageDoubleClick}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerLeave={handleStagePointerLeave}
        >
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {stageAnnouncement}
          </div>

          {activeGroupId ? (
            <div className="absolute left-4 top-4 z-panel flex items-center gap-2 rounded-ds-md border border-ds-warning-border bg-ds-warning-surface px-2.5 py-1.5 text-xs text-ds-warning-text shadow-ds-popover">
              <span>Editing group</span>
              <button
                type="button"
                onClick={() => {
                  const groupId = activeGroupId;
                  setActiveGroupId(null);
                  setSelection((s) => setSelectedNodeIds(s, [groupId]));
                  focusSelectedNodeSoon(groupId);
                  setStageAnnouncement("Exited group");
                }}
                className="rounded-ds-sm px-1.5 py-0.5 font-medium underline-offset-2 hover:underline"
              >
                Exit
              </button>
            </div>
          ) : null}

          {/* Context / Popover Toolbar */}
          {contextMenu && activeSlide
            ? (() => {
                const contextNode = findNodeById(
                  activeSlide.children,
                  contextMenu.nodeId,
                );
                if (!contextNode) return null;
                const candidates = contextMenu.candidateIds
                  .map((id) => findNodeById(activeSlide.children, id) ?? null)
                  .filter((node): node is SlideChildNode => node !== null);
                const duplicateSelection = () => {
                  const result = duplicateNodes(
                    deck,
                    activeSlide.id,
                    selectedIds,
                  );
                  onDeckChange(result.deck);
                  if (result.duplicatedIds.length > 0) {
                    setSelection((s) =>
                      setSelectedNodeIds(s, result.duplicatedIds),
                    );
                    focusSelectedNodeSoon(result.duplicatedIds[0]);
                  }
                };
                return (
                  <StageNodeContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    node={contextNode}
                    candidates={candidates}
                    selectedCount={selectedIds.length}
                    canPaste={clipboardNodes.length > 0}
                    canGroup={selectedIds.length >= 2}
                    canUngroup={selectedNode?.type === "group"}
                    onClose={() => setContextMenu(null)}
                    onSelectCandidate={(nodeId) => {
                      setSelection((s) => setSelectedNodeIds(s, [nodeId]));
                      setFocusedNodeId(nodeId);
                      applyActiveGroupContext(nodeId);
                      focusSelectedNodeSoon(nodeId);
                    }}
                    onEdit={() => {
                      if (contextNode.type === "table") {
                        handleEnterTableEdit(contextNode.id);
                        return;
                      }
                      if (isInlineEditableNode(contextNode)) {
                        setSelection((s) =>
                          setSelectedNodeIds(s, [contextNode.id]),
                        );
                        enterInlineEdit(contextNode.id);
                      }
                    }}
                    onDuplicate={duplicateSelection}
                    onCopy={handleCopyNodes}
                    onCut={handleCutNodes}
                    onPaste={handlePasteNodes}
                    onDelete={handleDeleteSelection}
                    onBringToFront={() => handleReorderSelection("front")}
                    onSendToBack={() => handleReorderSelection("back")}
                    onToggleLock={() =>
                      handleUpdateSelectedAttributes({
                        locked: contextNode.locked !== true,
                      })
                    }
                    onDetachConnectorFrom={() => {
                      if (
                        contextNode.type !== "connector" ||
                        !contextNode.layout ||
                        contextNode.content.from.kind !== "node"
                      ) {
                        return;
                      }
                      onDeckChange(
                        updateNodeContent(
                          deck,
                          activeSlide.id,
                          contextNode.id,
                          {
                            from: detachConnectorEndpointVNext(
                              activeSlide.children,
                              contextNode as Extract<
                                SlideChildNode,
                                { type: "connector" }
                              > & {
                                layout: LayoutBox;
                              },
                              contextNode.content.from,
                            ),
                          },
                        ),
                      );
                      focusSelectedNodeSoon(contextNode.id);
                    }}
                    onDetachConnectorTo={() => {
                      if (
                        contextNode.type !== "connector" ||
                        !contextNode.layout ||
                        contextNode.content.to.kind !== "node"
                      ) {
                        return;
                      }
                      onDeckChange(
                        updateNodeContent(
                          deck,
                          activeSlide.id,
                          contextNode.id,
                          {
                            to: detachConnectorEndpointVNext(
                              activeSlide.children,
                              contextNode as Extract<
                                SlideChildNode,
                                { type: "connector" }
                              > & {
                                layout: LayoutBox;
                              },
                              contextNode.content.to,
                            ),
                          },
                        ),
                      );
                      focusSelectedNodeSoon(contextNode.id);
                    }}
                    onGroup={handleGroupSelection}
                    onUngroup={handleUngroupSelection}
                  />
                );
              })()
            : null}
          <ContextToolbar
            selectedIds={selectedIds}
            selectedNode={selectedNode}
            selectedResolvedStyle={selectedResolvedNode?.style}
            isInlineEditing={inlineEditNodeId !== null}
            isDragging={
              draggingStage ||
              activeResizeHandle !== null ||
              activeCropHandle !== null ||
              activeRotationNodeId !== null ||
              activeConnectorEndpoint !== null
            }
            isDecorationSelected={isDecorationSelected}
            onDelete={handleDeleteSelection}
            onCut={handleCutNodes}
            onDuplicate={() => {
              if (!activeSlide) return;
              const result = duplicateNodes(deck, activeSlide.id, selectedIds);
              onDeckChange(result.deck);
              if (result.duplicatedIds.length > 0) {
                setSelection((s) =>
                  setSelectedNodeIds(s, result.duplicatedIds),
                );
                focusSelectedNodeSoon(result.duplicatedIds[0]);
              }
            }}
            onGroup={handleGroupSelection}
            onUngroup={handleUngroupSelection}
            onBringForward={() => handleReorderSelection("forward")}
            onSendBackward={() => handleReorderSelection("backward")}
            onBringToFront={() => handleReorderSelection("front")}
            onSendToBack={() => handleReorderSelection("back")}
            onAlignSelection={handleAlignSelection}
            onDistributeSelection={handleDistributeSelection}
            onMatchSize={handleMatchSize}
            onUpdateSelectedContent={handleUpdateSelectedContent}
            onUpdateSelectedLayout={handleUpdateSelectedLayout}
            onUpdateSelectedLocalStyle={handleUpdateSelectedLocalStyle}
            onUpdateSelectedAttributes={handleUpdateSelectedAttributes}
            onReplaceImage={handleReplaceSelectedImageRequest}
            onReplaceVisual={handleReplaceSelectedVisual}
            onResetImageCrop={handleResetSelectedImageCrop}
            onEnterTableEdit={() => handleEnterTableEdit()}
            slideBackgroundColor={activeSlideBackgroundColor}
            onUpdateSlideLocalStyle={handleUpdateSlideLocalStyle}
            onInsertSlide={handleInsertSlide}
            onInsertText={handleInsertText}
            onInsertShape={handleInsertShape}
            onInsertImage={handleInsertImage}
            onInsertVisual={() => void handleInsertVisual()}
            onInsertConnector={handleInsertConnector}
            onInsertTable={handleInsertTable}
            onDuplicateSlide={handleDuplicateActiveSlide}
            onDeleteSlide={handleDeleteActiveSlide}
            canDeleteSlide={deck.slides.length > 1}
            onDetachDecoration={handleDetachDecoration}
            onRequestStageFocus={handleContextToolbarEscape}
          />

          {activeSlideTree ? (
            <div
              ref={stageViewportRef}
              data-slide-stage-viewport="true"
              tabIndex={-1}
              className={cx(
                "box-border h-full min-h-0 p-6",
                stageFit.needsScroll ? "overflow-auto" : "overflow-hidden",
              )}
            >
              <div style={stageScrollStyle}>
                <div
                  ref={handleCanvasRef}
                  data-slide-stage-frame="true"
                  className="relative"
                  style={stageFrameStyle}
                >
                  <SlideCanvasVNext
                    slide={activeSlideTree}
                    canvas={renderTree?.canvas}
                    assetResolver={resolveDeckAsset}
                    visualResolver={resolveDocumentVisual}
                    selection={selection}
                    onNodeDoubleClick={handleNodeDoubleClick}
                    onNodePointerDown={handleNodePointerDown}
                    onNodeFocus={handleNodeFocus}
                    onResizeHandlePointerDown={handleResizeHandlePointerDown}
                    onCropHandlePointerDown={handleCropHandlePointerDown}
                    onRotationHandlePointerDown={
                      handleRotationHandlePointerDown
                    }
                    onConnectorEndpointPointerDown={
                      handleConnectorEndpointPointerDown
                    }
                    nodeGestureDrafts={stageNodeGestureDrafts}
                    activeResizeHandle={activeResizeHandle}
                    activeCropHandle={activeCropHandle}
                    activeRotationNodeId={activeRotationNodeId}
                    activeConnectorEndpoint={activeConnectorEndpoint}
                    activeGroupId={activeGroupId}
                    tableEditingNodeId={tableEditingNodeId}
                    activeTableCell={activeTableCell}
                    onTableCellFocus={handleTableCellFocus}
                    onTableCellCommit={handleTableCellCommit}
                    onTableCellKeyDown={handleTableCellKeyDown}
                    hiddenNodeIds={
                      inlineEditNodeId ? new Set([inlineEditNodeId]) : undefined
                    }
                    hoveredNodeId={hoveredNodeId}
                    slideHovered={
                      slideHovered &&
                      !marqueeFrame &&
                      !draggingStage &&
                      activeResizeHandle === null &&
                      activeCropHandle === null &&
                      activeRotationNodeId === null &&
                      activeConnectorEndpoint === null
                    }
                    slideSelected={selectedIds.length === 0}
                    focusedNodeId={focusedNodeId ?? firstSelectedId ?? null}
                    focusGeometryRegistry={focusGeometryRegistry}
                    className="shadow-ds-xl"
                  />

                  {/* Inline text editor overlay */}
                  {inlineEditNodeId &&
                    activeSlide &&
                    canvasElement &&
                    (() => {
                      const editNode = findNodeById(
                        activeSlide.children,
                        inlineEditNodeId,
                      );
                      if (!editNode?.layout) return null;
                      const canvasEl = canvasElement.querySelector(
                        '[data-slide-canvas-vnext="true"]',
                      );
                      const canvasRect =
                        canvasEl?.getBoundingClientRect() ??
                        canvasElement.getBoundingClientRect();
                      const paragraphs =
                        editNode.type === "text"
                          ? editNode.content.paragraphs
                          : [{ id: `${inlineEditNodeId}-p-1`, text: "" }];
                      const resolvedEditNode = activeSlideTree.nodes.find(
                        (node) => node.id === inlineEditNodeId,
                      );
                      return (
                        <InlineTextEditorVNext
                          nodeId={inlineEditNodeId}
                          initialParagraphs={paragraphs}
                          frame={editNode.layout.frame}
                          canvasRect={canvasRect}
                          textStyle={resolveNodeFontCss(
                            resolvedEditNode?.style,
                          )}
                          autoHeight={editNode.layout.autoHeight === true}
                          initialCaret={inlineEditInitialCaret}
                          onCommit={handleInlineEditCommit}
                          onCancel={handleInlineEditCancel}
                          onTabNext={() => handleInlineEditTab(1)}
                          onTabPrev={() => handleInlineEditTab(-1)}
                        />
                      );
                    })()}

                  {stageGuides.length > 0 ? (
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{ zIndex: STAGE_CHROME_Z_INDEX.snapGuide }}
                    >
                      {stageGuides.map((guide, index) => (
                        <span
                          key={`${guide.axis}-${guide.positionPct}-${index}`}
                          className="absolute bg-ds-accent-fill/70"
                          style={
                            guide.axis === "x"
                              ? {
                                  left: `${guide.positionPct}%`,
                                  top: 0,
                                  width: 1,
                                  height: "100%",
                                }
                              : {
                                  left: 0,
                                  top: `${guide.positionPct}%`,
                                  width: "100%",
                                  height: 1,
                                }
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                  {marqueeFrame ? (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute border border-ds-accent-border bg-ds-accent-surface/25"
                      style={{
                        left: `${marqueeFrame.x}%`,
                        top: `${marqueeFrame.y}%`,
                        width: `${marqueeFrame.w}%`,
                        height: `${marqueeFrame.h}%`,
                        zIndex: STAGE_CHROME_Z_INDEX.marquee,
                      }}
                    />
                  ) : null}
                  {renderStageGestureBadge(stageGestureBadge)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ds-text-muted">
              No slide selected
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Inspector Panel (tab-routed)                                        */}
        {/* ------------------------------------------------------------------ */}
        <SlideEditorInspectorRegion
          isDesktopInspectorViewport={isDesktopInspectorViewport}
          activeSlide={activeSlide}
          inspectorSheetOpen={effectiveInspectorSheetOpen}
          onOpenMobileInspector={openMobileInspector}
          onCloseMobileInspector={closeMobileInspector}
          renderInspectorShell={renderInspectorShell}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Bottom Filmstrip                                                     */}
      {/* ------------------------------------------------------------------ */}
      {renderTree && (
        <Filmstrip
          renderTree={renderTree}
          activeSlideIndex={activeSlideIndex}
          collapsed={filmstripCollapsed}
          assetResolver={resolveDeckAsset}
          visualResolver={resolveDocumentVisual}
          onSelectSlide={(index) => {
            setActiveSlideIndex(index);
            setSelection(createSelectionState(selection.mode));
            exitInlineEdit();
            setActiveGroupId(null);
            clearTableEditing();
          }}
          onInsertSlide={handleInsertSlide}
          onDuplicateSlide={(slideId) => {
            const result = duplicateSlide(deck, slideId);
            onDeckChange(result.deck);
            if (result.index >= 0) setActiveSlideIndex(result.index);
            setSelection(createSelectionState(selection.mode));
          }}
          onDeleteSlide={(slideId) => {
            const result = deleteSlide(deck, slideId);
            onDeckChange(result.deck);
            setActiveSlideIndex(result.index);
            setSelection(createSelectionState(selection.mode));
          }}
          onMoveSlide={(slideId, targetIndex) => {
            const result = moveSlide(deck, slideId, targetIndex);
            onDeckChange(result.deck);
            if (result.index >= 0) setActiveSlideIndex(result.index);
          }}
        />
      )}

      {/* Footer status bar */}
      <footer
        data-slide-bottom-dock="true"
        className="tiq-safe-bottom-dock grid min-h-9 shrink-0 grid-cols-1 items-center gap-2 bg-transparent px-3 py-1 text-[11px] text-ds-text-muted sm:h-9 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3 sm:py-0"
      >
        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <span className="truncate font-medium text-ds-text-secondary">
            {deck.title ?? "Slides"}
          </span>
          <span aria-hidden="true" className="text-ds-border-strong">
            ·
          </span>
          <span className="truncate">
            {activeSlideName} (
            {Math.min(activeSlideIndex + 1, deck.slides.length)}/
            {deck.slides.length})
          </span>
          <span
            aria-hidden="true"
            className="hidden text-ds-border-strong lg:inline"
          >
            ·
          </span>
          <span className="hidden truncate lg:inline">{pkg.name}</span>
          <span
            aria-hidden="true"
            className="hidden text-ds-border-strong xl:inline"
          >
            ·
          </span>
          <span className="hidden truncate xl:inline">{sourceStatusLabel}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5 sm:flex-nowrap sm:justify-center">
          <Tooltip
            label={
              filmstripCollapsed
                ? "Show slide thumbnails"
                : "Hide slide thumbnails"
            }
            side="top"
          >
            <button
              type="button"
              aria-label={
                filmstripCollapsed
                  ? "Show slide thumbnails"
                  : "Hide slide thumbnails"
              }
              aria-pressed={!filmstripCollapsed}
              onClick={toggleFilmstripCollapsed}
              className={cx(
                "flex h-7 items-center gap-1 rounded-ds-md px-1.5 text-[11px] font-semibold transition-colors sm:px-2",
                !filmstripCollapsed
                  ? "bg-ds-accent-surface text-ds-accent-text"
                  : "text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
                FOCUS_RING,
              )}
            >
              <LayoutPanelLeft size={13} aria-hidden />
              Slides
              {filmstripCollapsed ? (
                <ChevronUp size={11} aria-hidden />
              ) : (
                <ChevronDown size={11} aria-hidden />
              )}
            </button>
          </Tooltip>
          <button
            type="button"
            aria-pressed={inspectorPanelRequest?.panel === "notes"}
            onClick={handleNotesControlClick}
            className={cx(
              "flex h-7 items-center gap-1 rounded-ds-md px-1.5 text-[11px] font-semibold transition-colors sm:px-2",
              inspectorPanelRequest?.panel === "notes"
                ? "bg-ds-accent-surface text-ds-accent-text"
                : "text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
              FOCUS_RING,
            )}
          >
            <StickyNote size={13} aria-hidden />
            Notes
          </button>
          <span className="hidden truncate font-medium text-ds-text-muted sm:inline">
            Slide {Math.min(activeSlideIndex + 1, deck.slides.length)} of{" "}
            {deck.slides.length}
          </span>
          <div
            className="mx-1 hidden h-5 w-px bg-ds-border-subtle sm:block"
            aria-hidden="true"
          />
          <input
            type="range"
            min={25}
            max={200}
            step={5}
            value={stageZoomPercent}
            onChange={(event) =>
              setStageZoomPercent(Number(event.currentTarget.value))
            }
            aria-label="Slide zoom"
            className="hidden w-24 accent-ds-accent sm:block sm:w-28 lg:w-32"
          />
          <Popover
            open={zoomMenuOpen}
            onClose={() => setZoomMenuOpen(false)}
            role="menu"
            aria-label="Zoom presets"
            placement="top"
            className="w-20 p-1"
            trigger={
              <button
                ref={zoomMenuTriggerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={zoomMenuOpen}
                aria-controls={zoomMenuOpen ? zoomMenuId : undefined}
                aria-label={`Set slide zoom (${stageZoomPercent}%)`}
                onClick={() => setZoomMenuOpen((open) => !open)}
                className={cx(
                  "h-7 min-w-12 rounded-ds-md px-1.5 text-[11px] font-semibold tabular-nums text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary sm:min-w-14 sm:px-2",
                  FOCUS_RING,
                )}
              >
                {stageZoomPercent}%
              </button>
            }
          >
            <div
              ref={zoomMenuPanelRef}
              id={zoomMenuId}
              className="flex flex-col"
              onKeyDown={handleZoomMenuKeyDown}
            >
              {ZOOM_PERCENT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="menuitemradio"
                  aria-checked={preset === stageZoomPercent}
                  onClick={() => {
                    setFooterZoom(preset);
                    closeZoomMenuAndRestoreFocus();
                  }}
                  className={cx(
                    "rounded-ds-sm px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                    preset === stageZoomPercent
                      ? "bg-ds-state-hover text-ds-text-primary"
                      : "text-ds-text-secondary",
                    FOCUS_RING,
                  )}
                >
                  {preset}%
                </button>
              ))}
              <div className="my-1 border-t border-ds-border-subtle" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFooterZoom(100);
                  closeZoomMenuAndRestoreFocus();
                }}
                className={cx(
                  "rounded-ds-sm px-2 py-1.5 text-left text-xs font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                Fit
              </button>
            </div>
          </Popover>
          <Tooltip
            label={snapToGuides ? "Snap to guides: on" : "Snap to guides: off"}
            side="top"
          >
            <button
              type="button"
              aria-label="Toggle snap to guides"
              aria-pressed={snapToGuides}
              onClick={toggleSnapToGuides}
              className={cx(
                "flex h-7 items-center gap-1 rounded-ds-md px-1.5 text-[11px] font-semibold transition-colors sm:px-2",
                snapToGuides
                  ? "bg-ds-accent-surface text-ds-accent-text"
                  : "text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
                FOCUS_RING,
              )}
            >
              <Grid3x3 size={13} aria-hidden />
              Snap
            </button>
          </Tooltip>
          <Popover
            open={footerStatusMenuOpen}
            onClose={() => setFooterStatusMenuOpen(false)}
            role="menu"
            aria-label="Footer status"
            placement="top"
            align="end"
            className="w-56 p-2.5 sm:hidden"
            trigger={
              <button
                ref={footerStatusMenuTriggerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={footerStatusMenuOpen}
                aria-controls={
                  footerStatusMenuOpen ? footerStatusMenuId : undefined
                }
                aria-label={`Footer status: ${saveStatusLabel}. ${diagnosticSummary}.`}
                onClick={() => setFooterStatusMenuOpen((open) => !open)}
                className={cx(
                  "h-7 rounded-ds-md px-2 text-[11px] font-semibold text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                Status
              </button>
            }
          >
            <div
              ref={footerStatusMenuPanelRef}
              id={footerStatusMenuId}
              className="space-y-2 text-xs"
              onKeyDown={handleFooterStatusMenuKeyDown}
            >
              <p className="truncate font-medium text-ds-text-primary">
                {deck.title ?? "Slides"}
              </p>
              <p>
                {activeSlideName} (
                {Math.min(activeSlideIndex + 1, deck.slides.length)}/
                {deck.slides.length})
              </p>
              <p>{pkg.name}</p>
              <p>{sourceStatusLabel}</p>
              {saveStatus === "error" && onSave ? (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={saveStatusLabel}
                  onClick={() => {
                    void onSave(deck);
                    closeFooterStatusMenuAndRestoreFocus();
                  }}
                  className="text-ds-danger-text underline-offset-2 hover:underline"
                >
                  {saveStatusLabel}
                </button>
              ) : (
                <p>{saveStatusLabel}</p>
              )}
              {saveStatus === "error" && saveErrorMessage ? (
                <p className="max-w-[200px] text-ds-danger-text">
                  {saveErrorMessage}
                </p>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDeckDiagnosticsReviewOpen(true);
                  closeFooterStatusMenuAndRestoreFocus();
                }}
                aria-label={`Open deck diagnostics review (${diagnosticSummary})`}
                className={cx(
                  "rounded-ds-sm px-1.5 py-1 text-left font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                {diagnosticSummary}
              </button>
              {activeGroupId ? <p>Group edit</p> : null}
              {tableEditingNodeId ? <p>Table edit</p> : null}
              <p>{selectionModeLabel}</p>
              <p>
                {remotePresencePeers.length > 0
                  ? remotePresencePeers
                      .map((peer) =>
                        presencePeerSummary(peer, deck, activeSlide?.id),
                      )
                      .join(" · ")
                  : "Solo"}
              </p>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={snapToGuides}
                onClick={() => {
                  toggleSnapToGuides();
                  closeFooterStatusMenuAndRestoreFocus();
                }}
                className={cx(
                  "rounded-ds-sm px-1.5 py-1 text-left font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                Snap to guides: {snapToGuides ? "on" : "off"}
              </button>
            </div>
          </Popover>
        </div>
        {saveErrorAnnouncement ? (
          <span role="alert" className="sr-only">
            {saveErrorAnnouncement}
          </span>
        ) : null}
        <div className="hidden min-w-0 shrink-0 items-center justify-end gap-3 sm:flex">
          {saveStatus === "error" && onSave ? (
            <button
              type="button"
              onClick={() => void onSave(deck)}
              aria-label={saveStatusLabel}
              className="text-ds-danger-text underline-offset-2 hover:underline"
            >
              {saveStatusLabel}
            </button>
          ) : (
            <span role="status" aria-live="polite" aria-atomic="true">
              {saveStatusLabel}
            </span>
          )}
          {saveStatus === "error" && saveErrorMessage ? (
            <span
              role="status"
              aria-live="assertive"
              aria-atomic="true"
              className="max-w-[260px] truncate text-ds-danger-text"
            >
              {saveErrorMessage}
            </span>
          ) : null}
          <span
            aria-label={
              remotePresencePeers.length > 0
                ? `Slide collaborators: ${remotePresencePeers
                    .map((peer) =>
                      presencePeerSummary(peer, deck, activeSlide?.id),
                    )
                    .join("; ")}`
                : "No other slide collaborators"
            }
          >
            {remotePresencePeers.length > 0
              ? `${remotePresencePeers.length} present`
              : "Solo"}
          </span>
          <button
            type="button"
            onClick={() => setDeckDiagnosticsReviewOpen(true)}
            aria-label={`Open deck diagnostics review (${diagnosticSummary})`}
            className={cx(
              "rounded-ds-sm px-1.5 py-1 text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
              FOCUS_RING,
            )}
          >
            {diagnosticSummary}
          </button>
          {activeGroupId ? <span>Group edit</span> : null}
          {tableEditingNodeId ? <span>Table edit</span> : null}
          <span>{selectionModeLabel}</span>
          <span className="truncate">{selectedNodeSummary}</span>
        </div>
      </footer>
    </div>
  );
}
