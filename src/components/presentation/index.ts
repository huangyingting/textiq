/**
 * Public API surface for the presentation UI components.
 *
 * Import from this module rather than from individual files so the internal
 * file layout can change without breaking consumers.
 */

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export { SlideCanvas, DeckCanvas } from "./slide-canvas";
export type {
  SlideCanvasProps,
  DeckCanvasProps,
  ResizeHandlePosition,
} from "./slide-canvas";

// ---------------------------------------------------------------------------
// Node renderer
// ---------------------------------------------------------------------------

export {
  SlideNodeRenderer,
  styleObjectToContainerCss,
} from "./slide-node-renderer";
export type { SlideNodeRendererProps } from "./slide-node-renderer";

// ---------------------------------------------------------------------------
// Selection model
// ---------------------------------------------------------------------------

export type { SelectionMode, SelectionState } from "./selection-model";
export {
  isSelectable,
  getSelectableNodes,
  createSelectionState,
  selectNode,
  deselectNode,
  toggleNode,
  clearSelection,
  setSelection,
  setSelectionMode,
  isSelected,
  hasSelection,
  selectionSize,
  selectedNodeIds,
} from "./selection-model";

// ---------------------------------------------------------------------------
// Inspector panels
// ---------------------------------------------------------------------------

export {
  StyleBindingPanel,
  LocalOverrideBadge,
  DiagnosticsPanel,
  SlideControlsPanel,
  SlideSettingsPanel,
  NodeGeometryPanel,
  NodeContentPanel,
  LocalStylePanel,
  NodeSourcePanel,
  LayersPanel,
} from "./inspector";
export type {
  StyleBindingPanelProps,
  LocalOverrideBadgeProps,
  DiagnosticsPanelProps,
  SlideControlsPanelProps,
  SlideSettingsPanelProps,
  NodeGeometryPanelProps,
  NodeContentPanelProps,
  LocalStylePanelProps,
  NodeSourcePanelProps,
  LayersPanelProps,
} from "./inspector";

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

export type { StageFit } from "./stage/fit-helpers";
export {
  fitCanvasToContainer,
  canvasPctToContainerPx,
  containerPxToCanvasPct,
} from "./stage/fit-helpers";

// ---------------------------------------------------------------------------
// Render tree hook
// ---------------------------------------------------------------------------

export { useDeckRenderTree } from "./use-deck-render-tree";
export type { UseDeckRenderTreeOptions } from "./use-deck-render-tree";

// ---------------------------------------------------------------------------
// presentation editor surface
// ---------------------------------------------------------------------------

export { SlideEditor } from "./slide-editor";
export type { SlideEditorProps } from "./slide-editor";
export { DeckDiagnosticsReview } from "./deck-diagnostics-review";
export type { DeckDiagnosticsReviewProps } from "./deck-diagnostics-review";

// ---------------------------------------------------------------------------
// presentation present mode
// ---------------------------------------------------------------------------

export { PresentMode } from "./present-mode";
export type { PresentModeProps } from "./present-mode";

// ---------------------------------------------------------------------------
// presentation public present viewer
// ---------------------------------------------------------------------------

export { PublicPresentViewer } from "./public-present-viewer";
export type { PublicPresentViewerProps } from "./public-present-viewer";

// ---------------------------------------------------------------------------
// presentation deck generation preview
// ---------------------------------------------------------------------------

export { DeckGenerationPreview } from "./deck-generation-preview";
export type { DeckGenerationPreviewProps } from "./deck-generation-preview";
