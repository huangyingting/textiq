"use client";

/**
 * presentation slide editor surface.
 *
 * A standalone editing surface for `Deck` decks that renders through the
 * `resolveDeckRenderTree` / `SlideCanvas` path. It wires together:
 *
 *   - Slide rail (thumbnail navigation)
 *   - Main stage (`SlideCanvas`)
 *   - Inspector: `SlideControlsPanel`, `StyleBindingPanel`,
 *     `LocalOverrideBadge`, `DiagnosticsPanel`
 *   - Node selection model (normal / layers mode)
 *   - presentation editor commands: `updateSlideControls`, `updateNodeStyleBinding`,
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
 * `onShare` for public roundtrip routes, and export callbacks for downloads.
 * Toolbar action errors are caught and surfaced inline.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { ActionResult } from "@/lib/action-result";
import type { BrandKitSavePort } from "@/lib/action-ports";
import type { DocumentBlock } from "@/lib/content/document-blocks";
import type { SaveStatus } from "@/lib/presentation/save-status";
import type {
  Deck,
  LayoutBox,
  SemanticTemplateKind,
  SlideNode,
  SlideChildNode,
} from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type { SourceBlockIndex } from "@/lib/presentation/block-index";
import type {
  SourceLinkHostRefreshArgs,
  SourceLinkHostRefreshResult,
} from "@/lib/presentation/source-link-orchestration";
import {
  createDocumentSourceNode,
  sourceBlockKindLabel,
} from "@/lib/presentation/document-source-commands";
import type { InspectorPanelId } from "@/lib/presentation/inspector-panel-ui";
import type { ResolvedRenderNode } from "@/lib/presentation/render-tree";
import {
  emptySlideSpecFromLayout,
  slideSpecFromSlide,
  updateSlideLocalStyle,
  setThemePackage,
  insertTemplateSlide,
  duplicateSlide,
  deleteSlide,
  moveSlide,
  insertNode,
  pasteNodes,
  cutNodes,
  updateNodeContent,
  resetImageCrop,
  deleteNodes,
  duplicateNodes,
  groupNodes,
  ungroupNodes,
  applyTemplate,
  buildDeckOutline,
} from "@/lib/presentation";

import { NEUTRAL_THEME_PACKAGE } from "@/lib/presentation/neutral-theme-package";
import { createDefaultTemplateRegistry } from "@/lib/presentation/theme-packages";
import { listThemePackages } from "@/lib/presentation/theme-package-registry";
import { resolveNodeFontCss } from "@/lib/presentation/node-font-css";
import { injectThemePackageFontFaces } from "@/lib/presentation/theme-package-fonts";
import { resolveDeckAssetSource } from "@/lib/presentation/deck-asset-source";
import { STAGE_CHROME_Z_INDEX } from "@/lib/presentation/stage-chrome";
import {} from "@/lib/presentation/stage-fit";
import {
  hitTestSlideNodes,
  type StageHitCandidate,
} from "@/lib/presentation/stage-hit-test";
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
  type ImageUploadResult,
  type VisualPickResult,
} from "@/lib/presentation/node-asset-factories";
import { nextLayeredZIndex } from "@/lib/presentation/layer-bands";
import { resolveRasterSlideDimensions } from "@/lib/presentation/raster-export";
import { renderSelectedNodesToPngBlob } from "@/lib/presentation/raster-browser-export";

import { SlideCanvas } from "./slide-canvas";
import {
  createSelectionState,
  getSelectableNodes,
  clearSelection,
  setSelection as setSelectedNodeIds,
  setSelectionMode,
  selectedNodeIds,
  type SelectionState,
} from "./selection-model";
import {
  adjacentInlineEditableNodeId,
  childIdsForGroup,
  findNodeById,
  flattenEditorNodes,
  nodesInReadingOrder,
  parentGroupIdForNode,
} from "./selection-traversal";
import { InspectorShell } from "./inspector";
import { ContextToolbar } from "./toolbar/context-toolbar";
import { SlideEditorTopToolbar } from "./slide-editor-top-toolbar";
import { Filmstrip } from "./filmstrip/filmstrip";
import {
  readFilmstripCollapsed,
  writeFilmstripCollapsed,
} from "./filmstrip/filmstrip-collapse-storage";
import { PrecisionGuideOverlays } from "./precision-guides-controls";
import { usePrecisionGuides } from "./use-precision-guides";
import {
  nextActiveGroupIdForStageTarget,
  resolveStageNodeTarget,
  stageCandidateNodeIds,
  type StageNodeInteractionTarget,
} from "./stage-targeting";
import { StageNodeContextMenu } from "./stage-context-menu";
import { detachConnectorEndpointPresentation } from "./stage-keyboard-interactions";
import {
  buildStageGestureBadge,
  buildStageNodeGestureDrafts,
  renderStageGestureBadge,
} from "./stage-gesture-feedback";
import {
  canvasElementFromTarget,
  isEditableTarget,
  isStageEditingHandleTarget,
  isStageHandleTarget,
  pointPctFromEvent,
} from "./stage-pointer-interactions";
import { useStageInteractionController } from "./use-stage-interaction-controller";
import { useStageGestureController } from "./use-stage-gesture-controller";
import {
  useFocusFirstDescendantWhenOpen,
  useStageFocusController,
} from "./use-stage-focus-controller";
import {
  AddSlideTemplatePicker,
  type AddSlideTemplateChoice,
} from "./add-slide-template-picker";
import { BrandKitAuthoringPanel } from "./brand-kit-authoring-panel";
import {
  InlineTextEditorPresentation,
  type InlineTextInitialCaret,
} from "./inline-text-editor";
import { applyInlineTextCommit } from "./inline-text-commit";
import { useDeckRenderTree } from "./use-deck-render-tree";
import { useExportDiagnostics } from "./use-export-diagnostics";
import {
  buildPresentationExportPreflight,
  type PresentationExportFormat,
  type PresentationExportPreflightResult,
} from "@/lib/presentation/export-preflight";
import {
  SlideEditorCloseConfirmDialog,
  useSlideEditorShellController,
} from "./use-slide-editor-shell-controller";
import { useSourceReviewController } from "./use-source-review-controller";
import { useTableCellEditing } from "./use-table-cell-editing";
import { useInlineTextEditingController } from "./use-inline-text-editing-controller";
import { useInspectorCommands } from "./inspector-command-descriptors";
import { useSlideCommandPaletteController } from "./use-slide-command-palette-controller";
import {
  dedupeDiagnostics,
  isMobileInspectorViewport,
  scheduleEffectStateUpdate,
  useDesktopInspectorViewport,
} from "./slide-editor-support";
import { SourceReviewPanel } from "./source-review-panel";
import { DeckDiagnosticsReview } from "./deck-diagnostics-review";
import { ExportPreflightDialog } from "./export-preflight-dialog";
import {
  runVisualPickerMutation,
  VISUAL_PICKER_FAILURE_MESSAGE,
} from "./visual-picker-recovery";
import { KeyboardShortcutHelpDialog } from "@/components/presentation/keyboard-shortcut-help-dialog";
import { SlideCommandPalette } from "@/components/presentation/slide-command-palette";
import {
  clipboardImageNode,
  clipboardTextNode,
  resolveExternalTextIqNodePaste,
} from "@/lib/presentation/clipboard/node-payload";
import { SlideEditorFooter } from "./slide-editor-footer";
import {
  canReadTextIqNodeClipboard,
  clipboardImageBlobToFile,
  readTextIqNodeClipboard,
  writeTextIqNodesToClipboard,
  type TextIqNodeClipboardWriteResult,
} from "./node-clipboard";
import {
  canvasAspectRatio,
  canvasFrameStyle,
  canvasStageFit,
  stageScrollContentStyle,
} from "./slide-editor-stage-fit";
import { deleteActiveSlideFromToolbar } from "./slide-editor-toolbar-actions";
import {
  FocusTrapped,
  SlideEditorInspectorRegion,
} from "./slide-editor-regions";
import { buildMobileInspectorContext } from "./mobile-inspector-context";
import { cx } from "@/components/ui/tokens";
import {
  focusFirstMenuCommand,
  isMenuCommandNavigationKey,
  moveMenuCommandFocus,
} from "@/lib/a11y/menu-command-semantics";
import {
  useSlidePresence,
  type SlidePresenceAwareness,
} from "@/lib/presentation/use-slide-presence";

export { deleteActiveSlideFromToolbar } from "./slide-editor-toolbar-actions";
export { SlideEditorInspectorRegion } from "./slide-editor-regions";

export {
  handleCloseConfirmAction,
  routeCloseRequest,
  setupBeforeUnloadGuard,
  SlideEditorCloseConfirmDialog,
} from "./use-slide-editor-shell-controller";

const TEMPLATE_REGISTRY = createDefaultTemplateRegistry();
const TEMPLATE_OPTIONS = TEMPLATE_REGISTRY.all();

export type SlideEditorImageUploadResult = ImageUploadResult;

export type SlideEditorVisualPickResult = VisualPickResult;

export type SlideEditorSourceRefreshResult = SourceLinkHostRefreshResult;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SlideEditorProps {
  documentId: string;
  /** The presentation deck to edit. */
  deck: Deck;
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
  onUploadImage?: (file: File) => Promise<SlideEditorImageUploadResult>;
  onPickVisual?: () => Promise<SlideEditorVisualPickResult | undefined>;
  documentBlocks?: readonly DocumentBlock[];
  sourceBlockIndex?: SourceBlockIndex;
  onRefreshSource?: (
    args: SourceLinkHostRefreshArgs,
  ) => Promise<SlideEditorSourceRefreshResult | undefined>;
  /**
   * Called on every structural change. Receives the updated deck with the
   * command result applied. The parent is responsible for persistence.
   */
  onDeckChange: (deck: Deck) => void;
  /**
   * Optional explicit save callback. Called when the user requests an
   * immediate save (e.g. Save button). When omitted, the parent's
   * `onDeckChange` handler is solely responsible for persistence timing.
   *
   * Extension point for presentation-specific autosave/commit infrastructure —
   * see `handleSave` in `use-slide-editor-open.ts`.
   */
  onSave?: (deck: Deck) => Promise<ActionResult>;
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
   * for invoking `exportDeckAsPPTX` and triggering the browser download.
   * Thrown errors are caught and displayed inline.
   */
  onExportPptx?: () => Promise<void>;
  /** Called when the user requests a multi-page PDF export. */
  onExportPdf?: () => Promise<void>;
  /** Called when the user requests per-slide PNG exports. */
  onExportPng?: () => Promise<void>;
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
  /** Saves a compiled brand-kit draft snapshot from the authoring dialog. */
  saveBrandKitDraft?: BrandKitSavePort["saveBrandKitDraft"];
  /** Current user id used to seed new user-scoped brand-kit drafts. */
  brandKitOwnerId?: string;
  presenceAwareness?: SlidePresenceAwareness | null;
  presenceUserId?: string;
  presenceUserName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlideEditor({
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
  onExportPdf,
  onExportPng,
  onPresent,
  onShare,
  saveBrandKitDraft,
  brandKitOwnerId = documentId,
  presenceAwareness = null,
  presenceUserId = "",
  presenceUserName = "Anonymous",
}: SlideEditorProps): JSX.Element {
  const pkg = themePackage ?? NEUTRAL_THEME_PACKAGE;
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const themePackages = useMemo(() => listThemePackages(), []);
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
  const [brandKitAuthoringOpen, setBrandKitAuthoringOpen] = useState(false);
  const replaceImageFileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceSlideBackgroundFileInputRef = useRef<HTMLInputElement | null>(
    null,
  );
  const replaceImageTargetIdRef = useRef<string | null>(null);
  const insertImagePendingRef = useRef(false);

  const {
    inlineEditNodeId,
    inlineEditInitialCaret,
    enterInlineEdit,
    exitInlineEdit,
    requestInlineEditCommit,
  } = useInlineTextEditingController();

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

  useEffect(() => {
    injectThemePackageFontFaces(pkg);
  }, [pkg]);

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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [stageZoomPercent, setStageZoomPercent] = useState(100);
  const [filmstripCollapsed, setFilmstripCollapsed] = useState(() =>
    readFilmstripCollapsed(documentId),
  );
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [footerStatusMenuOpen, setFooterStatusMenuOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [compactToolbarMenuOpen, setCompactToolbarMenuOpen] = useState(false);
  const zoomMenuId = useId();
  const exportMenuId = useId();
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
  const [exportPreflight, setExportPreflight] =
    useState<PresentationExportPreflightResult | null>(null);
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
    suppressNextStageClick,
    shouldSuppressStageClick,
  } = useStageInteractionController();
  const {
    precisionGuides,
    togglePrecisionGrid,
    togglePrecisionRulers,
    toggleCustomGuidesVisible,
    addCustomGuide,
    removeCustomGuide,
  } = usePrecisionGuides(documentId, setStageAnnouncement);
  const {
    focusGeometryRegistry,
    canvasElement,
    handleCanvasRef,
    stageViewportRef,
    stageViewportSize,
    focusSelectedNodeSoon,
    focusStageViewportSoon,
    focusEditorRootSoon,
    focusStageNodeSoon,
  } = useStageFocusController({
    editorRootRef,
    deck,
    undoRedoFocus,
    setActiveSlideIndex,
    setSelection,
    setFocusedNodeId,
    setHoveredNodeId,
    exitInlineEdit,
  });
  const {
    toolbarError,
    setToolbarError,
    closeConfirmOpen,
    handleExportPptx,
    handleExportPdf,
    handleExportPng,
    handleRegenerate,
    handleRoundtripAction,
    handleCloseRequest,
    handleCloseConfirmCancel,
    handleCloseConfirmDiscard,
  } = useSlideEditorShellController({
    deck,
    hasUnsavedWork,
    onClose,
    onExportPdf,
    onExportPng,
    onExportPptx,
    onRegenerate,
    onSave,
    setStageAnnouncement,
  });
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const isDesktopInspectorViewport = useDesktopInspectorViewport();
  const deckChromeToolbarPanelRef = useRef<HTMLDivElement | null>(null);

  useFocusFirstDescendantWhenOpen(
    deckChromeToolbarOpen,
    deckChromeToolbarPanelRef,
  );

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

  function requestInspectorPanel(panel: InspectorPanelId) {
    setInspectorPanelRequest((current) => ({
      panel,
      nonce: (current?.nonce ?? 0) + 1,
    }));
  }

  function openMobileInspector(panel?: InspectorPanelId) {
    requestInspectorPanel(panel ?? mobileInspectorContext.activePanel);
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

  function handleOpenBrandKitAuthoring() {
    setAddSlidePickerOpen(false);
    setBrandKitAuthoringOpen(true);
  }

  function handleSavedBrandKit(result: {
    packageId: string;
    packageVersion: string;
  }) {
    onDeckChange(
      setThemePackage(deck, result.packageId, result.packageVersion),
    );
    setBrandKitAuthoringOpen(false);
    setStageAnnouncement("Brand kit saved and applied to this deck.");
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
    focusStageNodeSoon(result.nodeId);
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
        deckWithAsset: Deck;
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

  function handleContextToolbarEscape() {
    if (firstSelectedId) {
      focusSelectedNodeSoon(firstSelectedId);
      return;
    }
    focusStageViewportSoon();
  }

  function clipboardWriteAnnouncement(
    action: "Copied" | "Cut",
    count: number,
    result: TextIqNodeClipboardWriteResult,
  ): string {
    const label = `${action} ${count} ${count === 1 ? "node" : "nodes"}`;
    if (result.ok) {
      return result.imageIncluded
        ? `${label} to clipboard with PNG, HTML, and text fallbacks.`
        : `${label} to clipboard with HTML and text fallbacks.`;
    }
    if (result.state === "permission-denied") {
      return `${label} for in-editor paste. Clipboard permission was denied.`;
    }
    if (result.state === "unsupported") {
      return `${label} for in-editor paste. System clipboard is unavailable.`;
    }
    if (result.plainTextFallbackWritten) {
      return `${label} for in-editor paste. System clipboard kept a text fallback only.`;
    }
    return `${label} for in-editor paste. System clipboard copy failed.`;
  }

  function selectedNodesPngRenderer(ids: readonly string[]) {
    return async () => {
      if (!activeSlideTree) return null;
      return await renderSelectedNodesToPngBlob(
        deck,
        activeSlideTree,
        ids,
        resolveRasterSlideDimensions(deck),
      );
    };
  }

  async function handleCopyNodes() {
    if (!activeSlide || selectedIds.length === 0) return;
    const copied = selectedIds
      .map((id) => findNodeById(activeSlide.children, id))
      .filter((node): node is SlideChildNode => node !== undefined);
    if (copied.length === 0) return;
    setClipboardNodes(copied);
    const writeResult = await writeTextIqNodesToClipboard(copied, {
      renderPng: selectedNodesPngRenderer(selectedIds),
    });
    setStageAnnouncement(
      clipboardWriteAnnouncement("Copied", copied.length, writeResult),
    );
  }

  async function handlePasteNodes() {
    if (!activeSlide) return;
    const clipboard = await readTextIqNodeClipboard();
    const resolved = resolveExternalTextIqNodePaste({
      osPayload: clipboard.textIqPayload,
      hasImage: clipboard.image !== null,
      html: clipboard.html,
      plainText: clipboard.plainText,
      memoryNodes: clipboardNodes,
    });
    if (resolved.source === "invalid") {
      setStageAnnouncement("TextIQ clipboard payload could not be pasted.");
      return;
    }
    if (resolved.source === "none" && clipboard.state !== "available") {
      setStageAnnouncement(
        clipboard.state === "permission-denied"
          ? "Clipboard permission was denied. Copy inside TextIQ and try paste again."
          : "Clipboard paste failed. Copy inside TextIQ and try paste again.",
      );
      return;
    }
    if (resolved.source === "image") {
      if (!clipboard.image) return;
      try {
        const file = clipboardImageBlobToFile(
          clipboard.image.blob,
          clipboard.image.type,
        );
        const uploadedImage = await deckWithUploadedImageAsset(file);
        if (!uploadedImage) {
          setToolbarError(
            "Pasted image upload failed. Please try another image.",
          );
          return;
        }
        const result = insertNode(
          uploadedImage.deckWithAsset,
          activeSlide.id,
          clipboardImageNode(
            { assetId: uploadedImage.assetId, alt: uploadedImage.alt },
            nextLayeredZIndex(activeSlide, "image"),
          ),
        );
        onDeckChange(result.deck);
        setSelection((s) => setSelectedNodeIds(s, [result.nodeId]));
        focusSelectedNodeSoon(result.nodeId);
        setToolbarError(null);
        setStageAnnouncement("Pasted image from clipboard.");
      } catch {
        setToolbarError(
          "Pasted image upload failed. Please try another image.",
        );
      }
      return;
    }
    if (resolved.source === "html" || resolved.source === "plain-text") {
      const rawText =
        resolved.source === "html" ? clipboard.html : clipboard.plainText;
      if (!rawText) return;
      const node = clipboardTextNode(
        rawText,
        nextLayeredZIndex(activeSlide, "text"),
        { html: resolved.source === "html" },
      );
      if (!node) return;
      const result = insertNode(deck, activeSlide.id, node);
      onDeckChange(result.deck);
      setSelection((s) => setSelectedNodeIds(s, [result.nodeId]));
      focusSelectedNodeSoon(result.nodeId);
      setToolbarError(null);
      setStageAnnouncement("Pasted text from clipboard.");
      return;
    }
    if (resolved.nodes.length === 0) return;
    const result = pasteNodes(deck, activeSlide.id, resolved.nodes);
    onDeckChange(result.deck);
    if (result.nodeIds.length > 0) {
      setSelection((s) => setSelectedNodeIds(s, result.nodeIds));
      focusSelectedNodeSoon(result.nodeIds[0]);
      setStageAnnouncement(
        `Pasted ${result.nodeIds.length} ${
          result.nodeIds.length === 1 ? "node" : "nodes"
        }${
          resolved.source === "os"
            ? " from clipboard"
            : clipboard.state === "available"
              ? ""
              : " from the in-editor clipboard"
        }.`,
      );
    }
  }

  function applySelectionDeletion(
    deletedIds: readonly string[],
    nextDeck: Deck,
  ) {
    if (!activeSlide || deletedIds.length === 0) return;
    const deletedCount = deletedIds.length;
    const replacementId = replacementNodeAfterDelete(deletedIds);
    onDeckChange(nextDeck);
    if (activeGroupId && deletedIds.includes(activeGroupId)) {
      setActiveGroupId(null);
    }
    if (replacementId) {
      setSelection((s) => setSelectedNodeIds(s, [replacementId]));
      setFocusedNodeId(replacementId);
      focusStageNodeSoon(replacementId);
    } else {
      setSelection((s) => clearSelection(s));
      setFocusedNodeId(null);
      focusEditorRootSoon();
    }
    setStageAnnouncement(
      `Deleted ${deletedCount} ${deletedCount === 1 ? "node" : "nodes"}, ${Math.max(
        0,
        nodesInReadingOrder(activeSlide.children).length - deletedCount,
      )} remaining`,
    );
  }

  async function handleCutNodes() {
    if (!activeSlide || selectedIds.length === 0) return;
    const result = cutNodes(deck, activeSlide.id, selectedIds);
    if (result.nodes.length === 0) return;
    setClipboardNodes(result.nodes);
    const writeResult = await writeTextIqNodesToClipboard(result.nodes, {
      renderPng: selectedNodesPngRenderer(selectedIds),
    });
    applySelectionDeletion(selectedIds, result.deck);
    setStageAnnouncement(
      clipboardWriteAnnouncement("Cut", result.nodes.length, writeResult),
    );
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
      requestInlineEditCommit();
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

  function handleDuplicateSelection() {
    if (!activeSlide || selectedIds.length === 0) return;
    const result = duplicateNodes(deck, activeSlide.id, selectedIds);
    onDeckChange(result.deck);
    if (result.duplicatedIds.length > 0) {
      setSelection((s) => setSelectedNodeIds(s, result.duplicatedIds));
      focusSelectedNodeSoon(result.duplicatedIds[0]);
      setStageAnnouncement(
        `Duplicated ${result.duplicatedIds.length} ${
          result.duplicatedIds.length === 1 ? "node" : "nodes"
        }.`,
      );
    }
  }

  function handleNodeDoubleClick(nodeId: string, event: MouseEvent) {
    if (!activeSlide) return;
    const target = semanticTargetFromEvent(nodeId, event, {
      selectedNodeBonus: false,
    });
    if (!target) return;
    const targetNodeId = target.nodeId;
    const node = target.node;
    event.preventDefault();
    event.stopPropagation();

    if (inlineEditNodeId && inlineEditNodeId !== targetNodeId) {
      requestInlineEditCommit();
    }
    setSelection((s) => setSelectedNodeIds(s, [targetNodeId]));
    setFocusedNodeId(targetNodeId);

    if (target.parentGroupId && activeGroupId !== target.parentGroupId) {
      setActiveGroupId(target.parentGroupId);
      setStageAnnouncement("Entered group. Press Escape to exit group.");
      return;
    }

    applyStageTargetContext(target);

    if (node.locked) return;

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
      enterInlineEdit(targetNodeId, initialCaretFromNodeClick(node, event));
      return;
    }
  }

  function handleInlineEditCommit(
    nodeId: string,
    paragraphs: import("@/lib/presentation/schema").Paragraph[],
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
    if (shouldSuppressStageClick() || isEditableTarget(e.target)) return;
    const clickTarget = e.target as { closest?: (selector: string) => unknown };
    const insideSelectionOrFloatingPanel =
      typeof clickTarget.closest === "function" &&
      Boolean(clickTarget.closest("[data-node-id],[data-floating-panel]"));
    if (insideSelectionOrFloatingPanel) return;
    setSelection((s) => clearSelection(s));
    setFocusedNodeId(null);
    setActiveGroupId(null);
    clearTableEditing();
  }

  function handleStageDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (!activeSlide || isEditableTarget(event.target)) {
      return;
    }
    if (isStageHandleTarget(event.target)) return;
    const canvasElement = canvasElementFromTarget(event.target);
    if (!canvasElement) return;
    const rect = canvasElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (inlineEditNodeId) requestInlineEditCommit();
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
    enterInlineEdit(result.nodeId, { kind: "start" });
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

  const renderTree = useDeckRenderTree(deck, pkg);
  const deckOutline = useMemo(
    () =>
      renderTree
        ? buildDeckOutline(renderTree, {
            assets: deck.assets,
          })
        : undefined,
    [deck.assets, renderTree],
  );
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

  function runExportAction(format: PresentationExportFormat): Promise<void> {
    if (format === "pptx") return handleExportPptx();
    if (format === "pdf") return handleExportPdf();
    return handleExportPng();
  }

  function handleExportRequest(format: PresentationExportFormat): void {
    setExportMenuOpen(false);
    if (!renderTree) {
      void runExportAction(format);
      return;
    }

    try {
      const result = buildPresentationExportPreflight({
        deck,
        renderTree,
        format,
      });
      if (!result.hasFatal && !result.hasWarnings) {
        void runExportAction(format);
        return;
      }
      setToolbarError(null);
      setExportPreflight(result);
    } catch {
      setToolbarError("Export preflight failed. Please try again.");
    }
  }

  function handleExportPreflightContinue(): void {
    const format = exportPreflight?.format;
    setExportPreflight(null);
    if (!format) return;
    void runExportAction(format);
  }

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
    handleNavigateSourceBlock,
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
        return;
      }
      if (activeGroupId && !findNodeById(activeSlide.children, activeGroupId)) {
        setActiveGroupId(null);
      }
    });
  }, [activeGroupId, activeSlide]);

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

  // Alt-drag duplicates the dragged node(s) and drops the copies at the moved
  // position, leaving the originals in place (Canva parity). Alt without any
  // movement falls back to select-under so the legacy click behavior is intact.

  function requestImageRepair(nodeId: string) {
    replaceImageTargetIdRef.current = nodeId;
    insertImagePendingRef.current = false;
    replaceImageFileInputRef.current?.click();
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

  const {
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
  } = useInspectorCommands({
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
    setActiveSlideIndex,
    setDeckDiagnosticsReviewOpen,
    setInspectorSheetOpen,
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
  });

  const {
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
  } = useStageGestureController({
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
    customGuides: precisionGuides.customGuides,
    tableEditingNodeId,
    draggingStage,
    activeResizeHandle,
    activeCropHandle,
    activeRotationNodeId,
    activeConnectorEndpoint,
    semanticCandidateStackRef,
    enterInlineEdit,
    requestInlineEditCommit,
    clearTableEditing,
    focusSelectedNodeSoon,
    focusStageNodeSoon,
    handleCloseRequest,
    handleCopyNodes,
    handleCutNodes,
    handleDeleteSelection,
    handleEnterTableEdit,
    handleGroupSelection,
    handlePasteNodes,
    handleReorderSelection,
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
    setShortcutHelpOpen,
    setSlideHovered,
    setStageAnnouncement,
    setStageGuides,
    suppressNextStageClick,
    semanticHitsAtPoint,
    semanticHitsFromEvent,
    semanticTargetFromHits,
  });

  const stageFit = canvasStageFit(
    deck,
    stageZoomPercent,
    stageViewportSize,
    isDesktopInspectorViewport,
  );
  const stageFrameStyle = canvasFrameStyle(stageFit);
  const stageScrollStyle = stageScrollContentStyle(stageFit);
  const currentCanvasFormat: "16:9" | "4:3" | "square" =
    deck.canvas.format === "custom" ? "16:9" : deck.canvas.format;
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
  const mobileInspectorContext = buildMobileInspectorContext({
    activeSlide,
    selectedNode,
    selectedIds,
    isDecorationSelected,
    selectedGeneratedSource:
      selectedResolvedNode?.source === "themeDecoration" ||
      selectedResolvedNode?.source === "deckChrome"
        ? selectedResolvedNode.source
        : undefined,
    requestedPanel: inspectorPanelRequest?.panel,
    hasDiagnostics: diagnostics.length > 0,
  });
  function handleMobileInspectorPanelSelect(panel: InspectorPanelId) {
    requestInspectorPanel(panel);
    const panelLabel =
      mobileInspectorContext.panels.find((option) => option.id === panel)
        ?.label ?? panel;
    setStageAnnouncement(`${panelLabel} inspector panel selected`);
  }
  const {
    commandPaletteCommands,
    handleRunCommandPaletteCommand,
    handleSlideEditorKeyDown,
  } = useSlideCommandPaletteController({
    deck,
    hasActiveSlide: activeSlide !== undefined,
    selectedNode: selectedNode ?? null,
    selectedIds,
    isDecorationSelected,
    isInlineEditing: inlineEditNodeId !== null,
    isTableEditing: tableEditingNodeId !== null,
    hasSelectedSource: selectedSource !== undefined,
    selectedResolvedStyle: selectedResolvedNode?.style,
    sourceReviewCount: sourceReview.length,
    diagnosticsCount: diagnostics.length,
    saveStatus,
    canUndo,
    canRedo,
    onSave,
    onUndo,
    onRedo,
    onPresent,
    onShare,
    onExportPptx,
    onExportPdf,
    onExportPng,
    handleEditorKeyDown,
    handleRoundtripAction,
    handleExportPptx,
    handleExportPdf,
    handleExportPng,
    handleInsertSlide,
    handleDuplicateActiveSlide,
    handleDeleteActiveSlide,
    handleInsertText,
    handleInsertShape,
    handleInsertImage,
    handleInsertVisual,
    handleInsertConnector,
    handleInsertTable,
    handleAlignSelection,
    handleDistributeSelection,
    handleMatchSize,
    handleReorderSelection,
    handleGroupSelection,
    handleUngroupSelection,
    handleDuplicateSelection,
    handleDeleteSelection,
    handleCutNodes,
    handleUpdateSelectedAttributes,
    handleUpdateSelectedLocalStyle,
    handleReviewSourceLinks,
    openInspectorPanel,
    focusSelectedNodeSoon,
    focusStageViewportSoon,
    focusEditorRootSoon,
    setCommandPaletteOpen,
    setShortcutHelpOpen,
    setDeckDiagnosticsReviewOpen,
    setDeckChromeToolbarOpen,
    setStageAnnouncement,
  });
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
      handleSlideEditorKeyDown(event);
    }
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  });

  return (
    <div
      role="dialog"
      aria-label="Slide editor"
      data-slide-editor="true"
      ref={editorRootRef}
      tabIndex={-1}
      onKeyDown={handleSlideEditorKeyDown}
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
                onAuthorBrandKit={handleOpenBrandKitAuthoring}
              />
            </div>
          </FocusTrapped>
        </>
      ) : null}

      {brandKitAuthoringOpen ? (
        <>
          <div
            data-floating-panel="true"
            aria-hidden="true"
            onClick={() => setBrandKitAuthoringOpen(false)}
            className="fixed inset-0 z-modal bg-ds-backdrop"
          />
          <FocusTrapped>
            <div
              data-floating-panel="true"
              role="dialog"
              aria-modal="true"
              aria-label="Author brand kit"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setBrandKitAuthoringOpen(false);
                }
              }}
              className="fixed inset-x-4 top-8 z-modal mx-auto flex max-h-[calc(100vh-4rem)] max-w-6xl overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface-overlay shadow-ds-overlay"
            >
              <BrandKitAuthoringPanel
                ownerId={brandKitOwnerId}
                saveBrandKitDraft={saveBrandKitDraft}
                onSaved={handleSavedBrandKit}
                onClose={() => setBrandKitAuthoringOpen(false)}
              />
            </div>
          </FocusTrapped>
        </>
      ) : null}

      <SlideEditorTopToolbar
        deck={deck}
        activeSlide={activeSlide}
        themePackages={themePackages}
        currentCanvasFormat={currentCanvasFormat}
        brandKitAuthoringOpen={brandKitAuthoringOpen}
        deckChromeToolbarOpen={deckChromeToolbarOpen}
        deckChromeToolbarPanelRef={deckChromeToolbarPanelRef}
        snapToGuides={snapToGuides}
        precisionGuides={precisionGuides}
        sourceMenuOpen={sourceMenuOpen}
        sourceMenuTriggerRef={sourceMenuTriggerRef}
        sourceMenuPanelRef={sourceMenuPanelRef}
        sourceMenuId={sourceMenuId}
        sourceStatusLabel={sourceStatusLabel}
        sourceReview={sourceReview}
        documentSourceIndex={documentSourceIndex}
        selectedSource={selectedSource}
        selectedNode={selectedNode}
        documentInsertBlocks={documentInsertBlocks}
        onRegenerate={onRegenerate}
        saveStatus={saveStatus}
        compactToolbarMenuOpen={compactToolbarMenuOpen}
        compactToolbarMenuTriggerRef={compactToolbarMenuTriggerRef}
        compactToolbarMenuPanelRef={compactToolbarMenuPanelRef}
        compactToolbarMenuId={compactToolbarMenuId}
        onSave={onSave}
        saveStatusLabel={saveStatusLabel}
        diagnosticsCount={diagnostics.length}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        onPresent={onPresent}
        onShare={onShare}
        onExportPptx={onExportPptx}
        onExportPdf={onExportPdf}
        onExportPng={onExportPng}
        exportMenuOpen={exportMenuOpen}
        exportMenuId={exportMenuId}
        onClose={onClose}
        handleThemePackageChange={handleThemePackageChange}
        handleCanvasRatioChange={handleCanvasRatioChange}
        handleOpenBrandKitAuthoring={handleOpenBrandKitAuthoring}
        setDeckChromeToolbarOpen={setDeckChromeToolbarOpen}
        handleUpdateDeckChrome={handleUpdateDeckChrome}
        handleUpdateProps={handleUpdateProps}
        toggleSnapToGuides={toggleSnapToGuides}
        togglePrecisionGrid={togglePrecisionGrid}
        togglePrecisionRulers={togglePrecisionRulers}
        toggleCustomGuidesVisible={toggleCustomGuidesVisible}
        addCustomGuide={addCustomGuide}
        removeCustomGuide={removeCustomGuide}
        setSourceMenuOpen={setSourceMenuOpen}
        handleSourceMenuKeyDown={handleSourceMenuKeyDown}
        handleSyncFromDocument={handleSyncFromDocument}
        handleReviewSourceLinks={handleReviewSourceLinks}
        handleRefreshSelectedSource={handleRefreshSelectedSource}
        closeSourceMenuAndRestoreFocus={closeSourceMenuAndRestoreFocus}
        handleUnlinkSourceAt={handleUnlinkSourceAt}
        handleInsertDocumentSourceBlock={handleInsertDocumentSourceBlock}
        handleRegenerate={handleRegenerate}
        setCompactToolbarMenuOpen={setCompactToolbarMenuOpen}
        handleCompactToolbarMenuKeyDown={handleCompactToolbarMenuKeyDown}
        setCommandPaletteOpen={setCommandPaletteOpen}
        closeCompactToolbarMenuAndRestoreFocus={
          closeCompactToolbarMenuAndRestoreFocus
        }
        setShortcutHelpOpen={setShortcutHelpOpen}
        setDeckDiagnosticsReviewOpen={setDeckDiagnosticsReviewOpen}
        handleRoundtripAction={handleRoundtripAction}
        setExportMenuOpen={setExportMenuOpen}
        handleExportRequest={handleExportRequest}
        handleCloseRequest={handleCloseRequest}
      />
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
          onNavigateSource={handleNavigateSourceBlock}
          onDismiss={handleDismissSourceAt}
          onRefreshAll={handleRefreshAllSources}
          statusMessage={sourceReviewStatus}
        />
      ) : null}

      <SlideCommandPalette
        open={commandPaletteOpen}
        commands={commandPaletteCommands}
        isMac={isMac}
        onClose={() => setCommandPaletteOpen(false)}
        onRun={handleRunCommandPaletteCommand}
      />

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
      {exportPreflight ? (
        <FocusTrapped>
          <ExportPreflightDialog
            result={exportPreflight}
            onClose={() => setExportPreflight(null)}
            onContinue={handleExportPreflightContinue}
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
                return (
                  <StageNodeContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    node={contextNode}
                    candidates={candidates}
                    selectedCount={selectedIds.length}
                    canPaste={
                      clipboardNodes.length > 0 || canReadTextIqNodeClipboard()
                    }
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
                    onDuplicate={handleDuplicateSelection}
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
                            from: detachConnectorEndpointPresentation(
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
                            to: detachConnectorEndpointPresentation(
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
            onDuplicate={handleDuplicateSelection}
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
                  <SlideCanvas
                    slide={activeSlideTree}
                    canvas={renderTree?.canvas}
                    assetResolver={resolveDeckAsset}
                    visualResolver={resolveDocumentVisual}
                    selection={selection}
                    onNodeDoubleClick={handleNodeDoubleClick}
                    onNodePointerDown={handleNodePointerDown}
                    onNodeFocus={handleNodeFocus}
                    onResizeHandlePointerDown={handleResizeHandlePointerDown}
                    onMultiResizeHandlePointerDown={
                      handleMultiResizeHandlePointerDown
                    }
                    onMultiRotationHandlePointerDown={
                      handleMultiRotationHandlePointerDown
                    }
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
                    draggingStage={draggingStage}
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
                    deckOutline={deckOutline}
                    outlineActiveSlideIndex={activeSlideIndex}
                    outlineCurrentNodeId={focusedNodeId ?? firstSelectedId}
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
                        '[data-slide-canvas="true"]',
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
                      const inlineEditFrame =
                        stageNodeGestureDrafts?.get(inlineEditNodeId)?.frame ??
                        editNode.layout.frame;
                      return (
                        <InlineTextEditorPresentation
                          nodeId={inlineEditNodeId}
                          initialParagraphs={paragraphs}
                          frame={inlineEditFrame}
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

                  <PrecisionGuideOverlays preferences={precisionGuides} />

                  {stageGuides.length > 0 ? (
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{ zIndex: STAGE_CHROME_Z_INDEX.snapGuide }}
                    >
                      {stageGuides.map((guide, index) => (
                        <span
                          key={`${guide.axis}-${guide.positionPct}-${index}`}
                          className="tiq-stage-snap-guide absolute bg-ds-accent-fill/70"
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
        {/* Inspector Panel (panel-routed)                                      */}
        {/* ------------------------------------------------------------------ */}
        <SlideEditorInspectorRegion
          isDesktopInspectorViewport={isDesktopInspectorViewport}
          activeSlide={activeSlide}
          inspectorSheetOpen={effectiveInspectorSheetOpen}
          onOpenMobileInspector={openMobileInspector}
          onCloseMobileInspector={closeMobileInspector}
          renderInspectorShell={renderInspectorShell}
          mobileInspectorContext={{
            ...mobileInspectorContext,
            onSelectPanel: handleMobileInspectorPanelSelect,
          }}
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

      <SlideEditorFooter
        deck={deck}
        activeSlide={activeSlide}
        activeSlideIndex={activeSlideIndex}
        filmstripCollapsed={filmstripCollapsed}
        inspectorPanel={inspectorPanelRequest?.panel}
        stageZoomPercent={stageZoomPercent}
        zoomMenuOpen={zoomMenuOpen}
        zoomMenuId={zoomMenuId}
        zoomMenuTriggerRef={zoomMenuTriggerRef}
        zoomMenuPanelRef={zoomMenuPanelRef}
        footerStatusMenuOpen={footerStatusMenuOpen}
        footerStatusMenuId={footerStatusMenuId}
        footerStatusMenuTriggerRef={footerStatusMenuTriggerRef}
        footerStatusMenuPanelRef={footerStatusMenuPanelRef}
        hasUnsavedWork={hasUnsavedWork}
        saveStatus={saveStatus}
        saveStatusLabel={saveStatusLabel}
        saveErrorMessage={saveErrorMessage}
        sourceReviewCount={sourceReview.length}
        sourceStatusLabel={sourceStatusLabel}
        diagnosticsCount={diagnostics.length}
        activeGroupId={activeGroupId}
        tableEditingNodeId={tableEditingNodeId}
        selectionMode={selection.mode}
        selectedCount={selectedIds.length}
        remotePresencePeers={remotePresencePeers}
        onSave={onSave}
        onToggleFilmstripCollapsed={toggleFilmstripCollapsed}
        onNotesClick={handleNotesControlClick}
        onSetStageZoomPercent={setStageZoomPercent}
        onSetFooterZoom={setFooterZoom}
        onSetZoomMenuOpen={setZoomMenuOpen}
        onSetFooterStatusMenuOpen={setFooterStatusMenuOpen}
        onCloseZoomMenuAndRestoreFocus={closeZoomMenuAndRestoreFocus}
        onCloseFooterStatusMenuAndRestoreFocus={
          closeFooterStatusMenuAndRestoreFocus
        }
        onZoomMenuKeyDown={handleZoomMenuKeyDown}
        onFooterStatusMenuKeyDown={handleFooterStatusMenuKeyDown}
        onReviewSourceLinks={handleReviewSourceLinks}
        onOpenDiagnosticsReview={() => setDeckDiagnosticsReviewOpen(true)}
      />
    </div>
  );
}
