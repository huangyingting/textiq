/**
 * Barrel export for the v7 presentation core library.
 *
 * UI/render/export agents should import from here rather than from individual
 * modules to get a stable surface that can be reorganised without changing
 * consumer imports.
 */

// Primitive types
export type {
  DeckId,
  SlideId,
  NodeId,
  AssetId,
  ThemePackageId,
  ThemeVersion,
  TemplateVersion,
  StyleVariantId,
  TokenPath,
  IsoDateTime,
  JsonPrimitive,
  JsonValue,
  DeepPartial,
  CanvasFormat,
  CanvasSpec,
  InsetsPct,
  InsetsPt,
  FramePct,
  PointPct,
} from "./types";

// ID helpers
export {
  isValidId,
  isNonEmptyAsciiString,
  isFiniteNumber,
  isPositiveFinite,
  isHexColor,
  clamp,
} from "./ids";

// Diagnostics
export type {
  PresentationDiagnosticCode,
  DiagnosticSeverity,
  DiagnosticCategory,
  DiagnosticTargetScope,
  DiagnosticTarget,
  DiagnosticAction,
  DiagnosticActionType,
  DiagnosticGroup,
  PresentationDiagnostic,
} from "./diagnostics";
export {
  DIAGNOSTIC_CATEGORIES,
  DIAGNOSTIC_TARGET_SCOPES,
  DIAGNOSTIC_SEVERITY_RANK,
  makeDiagnostic,
  categoryForDiagnosticCode,
  retargetDiagnostic,
  getDiagnosticTarget,
  getDiagnosticNodeId,
  getDiagnosticSlideId,
  diagnosticTargetKey,
  diagnosticTargetLabel,
  groupDiagnostics,
  DiagnosticCollector,
} from "./diagnostics";
export type {
  DiagnosticRepairContext,
  DiagnosticRepairFocus,
  DiagnosticRepairResult,
} from "./diagnostic-repairs";
export { applyDiagnosticRepairAction } from "./diagnostic-repairs";

// Style schema
export type {
  TokenRef,
  ColorValue,
  TextStyle,
  GradientStop,
  FillStyle,
  StrokeStyle,
  RadiusStyle,
  ShadowStyle,
  EffectStyle,
  ImageFitMode,
  ImageStyle,
  ConnectorStyle,
  TableStyle,
  SlideSurfaceStyle,
  VisualStyle,
  ClipStyle,
  StyleObject,
  StylePatch,
  StyleRef,
  StyleBinding,
  ThemeTokens,
} from "./style-schema";
export { resolveToken } from "./style-schema";
export type {
  SupportedVisualColorChannel,
  ResolvedVisualChannelColors,
} from "./visual-channel-colors";
export {
  SUPPORTED_VISUAL_COLOR_CHANNELS,
  DEFAULT_VISUAL_CHANNEL_COLORS,
  isSupportedVisualColorChannel,
  normalizeVisualChannelColors,
  visualChannelColorWithDefaults,
} from "./visual-channel-colors";

// Style registry
export { STYLE_REFS, isStyleRef } from "./style-registry";

// Core schema
export type {
  DeckMetadata,
  AssetOrigin,
  ImageAsset,
  FontAsset,
  VisualAssetRef,
  FileAsset,
  DeckAssetRegistry,
  ThemeOverridePatch,
  DeckThemeBinding,
  LayoutConstraints,
  LayoutBox,
  AccessibilityMetadata,
  SourceRefreshState,
  SourceRefreshMetadata,
  SourceDisplayMetadata,
  NodeSourceMetadata,
  SemanticRole,
  SlotKey,
  TextRun,
  ListMarker,
  Paragraph,
  TextFitMode,
  TextContent,
  ShapeKind,
  SvgPathData,
  ShapeContent,
  ImageCrop,
  ImageContent,
  ConnectorAnchor,
  ConnectorEndpoint,
  ConnectorContent,
  TableColumn,
  TableCell,
  TableRow,
  TableContent,
  VisualContent,
  GroupComponentKind,
  BaseNode,
  TextNode,
  ImageNode,
  ShapeNode,
  ConnectorNode,
  TableNode,
  VisualNode,
  GroupNode,
  SlideChildNode,
  SemanticTemplateKind,
  SlideTemplateBinding,
  SlideTone,
  SlideDensity,
  SlideEmphasis,
  SlideControls,
  SlideProps,
  DeckChromeKind,
  DeckChromeLayer,
  DeckChromeBase,
  DeckChromeLogoPlacement,
  DeckChromeLogoSize,
  DeckChromeLogo,
  DeckChromeTextAlign,
  DeckChromeFooter,
  DeckChromePageNumberFormat,
  DeckChromePageNumberPlacement,
  DeckChromePageNumber,
  DeckChromeWatermarkLayout,
  DeckChromeWatermarkSize,
  DeckChromeWatermark,
  DeckChromeBorder,
  DeckChromeSafeArea,
  DeckChromeConfig,
  SlideDeckChromeOverrideMode,
  SlideDeckChromeOverride,
  SlideDeckChromeOverrides,
  SlideNode,
  DeckV7,
} from "./schema";
export { DECK_SCHEMA_VERSION_V7 } from "./schema";

// Source-link block index and review helpers
export type {
  SourceBlockKind,
  SourceBlockRefreshPayload,
  SourceBlockIndexEntry,
  SourceBlockIndex,
} from "./block-index";
export { buildSourceBlockIndex, findSourceBlock } from "./block-index";
export type {
  SourceLinkClassification,
  SourceRefreshResult,
  SourceRefreshAllResult,
  SourceReviewItem,
} from "./source-links";
export {
  classifyNodeSource,
  classifyDeckSourceLinks,
  sourceReviewItems,
  sourceLinkDiagnostics,
  refreshNodeSource,
  unlinkNodeSource,
  relinkNodeSource,
  updateNodeSourceState,
  dismissNodeSourceIssue,
  refreshAllSafeSourceLinks,
} from "./source-links";

// Validation
export type { DeckV7ParseResult } from "./validation";
export { safeParseDeckV7 } from "./validation";

// Theme package schema
export type { BuiltInThemePackageId } from "../presentation-shared/theme-package-ids";
export {
  BUILT_IN_THEME_PACKAGE_IDS,
  DEFAULT_BUILT_IN_THEME_PACKAGE_ID,
  BUILT_IN_THEME_PACKAGE_ALIASES,
  isBuiltInThemePackageId,
  resolveBuiltInThemePackageId,
} from "../presentation-shared/theme-package-ids";
export type {
  TemplateStaticContent,
  ThemeDecorationRecipe,
  ThemeAssetManifest,
  ThemePackageV1,
  ThemePackageValidationResult,
} from "./theme-package-schema";
export { validateThemePackage } from "./theme-package-schema";

// Style resolver
export type { StyleResolutionResult, ResolvedTheme } from "./style-resolver";
export { resolveNodeStyle, resolveTheme } from "./style-resolver";

// Template registry
export type {
  SlotValueType,
  OverflowPolicy,
  SlotContract,
  TemplateControlSupport,
  TemplateGroup,
  TemplateNodeBlueprint,
  TemplateLayoutVariant,
  TemplateSelectionMetadata,
  SemanticTemplateV1,
} from "./template-registry";
export {
  SEMANTIC_TEMPLATE_KINDS,
  isSemanticTemplateKind,
  SemanticTemplateRegistry,
  selectLayout,
} from "./template-registry";

// AI plan schema
export type {
  BulletSlotItem,
  MetricSlotItem,
  CardSlotItem,
  StepSlotItem,
  TimelineSlotItem,
  SlotValue,
  SemanticSlideSpecV1,
  SemanticDeckPlanV1,
} from "./semantic-deck-plan";
export { isSlotValue } from "./semantic-deck-plan";

// AI plan repair
export type { SemanticDeckPlanRepairResult } from "./semantic-deck-plan-repair";
export { repairSemanticDeckPlan } from "./semantic-deck-plan-repair";

// Template compiler
export type { TemplateCompileResult } from "./template-compiler";
export { compileSlide, resetIdCounter } from "./template-compiler";

// Default node layer bands
export type { LayeredNodeType } from "./layer-bands";
export {
  NODE_LAYER_BANDS,
  layerBandForNodeType,
  layeredZIndexForNodeType,
  nextLayeredZIndex,
} from "./layer-bands";

// Slide spec projection
export { slideSpecFromSlide, emptySlideSpecFromLayout } from "./slide-spec";

// DeckV7 node tree traversal and mutation helpers
export type {
  NodeTreeEntry,
  NodeTreeFlattenOptions,
  NodeLayerOrder,
  NodeLayerOrderOptions,
  NodeTreeMutationResult,
  InsertNodeResult,
  RemoveNodesResult,
  ReorderNodeResult,
  GroupNodeFactoryContext,
  GroupNodesResult,
  UngroupNodeResult,
} from "./node-tree-ops";
export {
  flattenNodeTreeEntries,
  flattenNodeTree,
  flattenLeafNodes,
  findNodeEntryById,
  findNodeById,
  findParentGroupForNode,
  parentGroupIdForNode,
  parentPathForNode,
  ancestorIdsForNode,
  isAncestorOfNode,
  collectSubtreeNodeIds,
  collectDescendantNodeIds,
  collectNodeTreeIds,
  expandNodeIdsWithDescendants,
  topLevelSelectedNodeIds,
  commonAncestorPath,
  nodesInLayerOrder,
  buildLayerReorderPatches,
  insertNodeAtPath,
  insertNodeRelativeTo,
  removeNodesById,
  removeNodeById,
  reorderNodeWithinParent,
  groupNodesById,
  ungroupNodeById,
} from "./node-tree-ops";

// Render tree
export type {
  ResolvedLayoutBox,
  ResolvedNodeContent,
  ResolvedRenderNode,
  ResolvedSlideBackground,
  ResolvedSlideRenderTree,
  ResolvedDeckRenderTree,
} from "./render-tree";

// Render resolver
export type { ResolveDeckOptions } from "./render-resolver";
export { resolveDeckRenderTree } from "./render-resolver";

// Accessibility outline and narration
export type {
  DeckOutlineNodeRole,
  NodeNarrationWarning,
  NodeNarration,
  NodeNarrationOptions,
} from "./a11y/node-narration";
export { narrateNode, truncateNarrationText } from "./a11y/node-narration";
export type {
  DeckOutlineNode,
  SlideOutline,
  DeckOutline,
  BuildDeckOutlineOptions,
} from "./a11y/deck-outline";
export { buildDeckOutline } from "./a11y/deck-outline";

// Export spec
export type {
  ExportBackgroundOperation,
  ExportTextOperation,
  ExportShapeOperation,
  ExportImageOperation,
  ExportConnectorOperation,
  ExportVisualOperation,
  ExportTableShapeOperation,
  ExportOperation,
  ExportSlideSpec,
  ExportDeckSpec,
} from "./export-spec";
export { buildExportSpec } from "./export-spec";

// Editor commands
export {
  MIN_DECK_SLIDES_MESSAGE,
  insertSlide,
  insertTemplateSlide,
  insertBlankSlide,
  duplicateSlide,
  deleteSlide,
  moveSlide,
  applyTemplate,
  updateSlideControls,
  updateSlideAttributes,
  updateSlideLocalStyle,
  resetSlideLocalStyle,
  updateSlideSourceMetadata,
  setThemePackage,
  updateDeckChrome,
  insertNode,
  pasteNodes,
  cutNodes,
  updateNodeContent,
  resetImageCrop,
  updateNodeLayout,
  updateNodeRotation,
  updateNodeLayouts,
  updateNodeAttributes,
  updateNodeSourceMetadata,
  moveNodesBy,
  deleteNodes,
  duplicateNodes,
  updateNodeStyleBinding,
  updateLocalStyle,
  resetLocalStyleOverride,
  restoreThemeDecoration,
  detachDecoration,
  detachDeckChrome,
  groupNodes,
  ungroupNodes,
  reorderZIndex,
  updateAssetMetadata,
} from "./editor-commands";

// Current-object command descriptors
export type {
  CurrentObjectCommandSurface,
  CurrentObjectCommandDisabledReason,
  CurrentObjectKind,
  CurrentObjectCommandFamily,
  CurrentObjectCommandOwner,
  CurrentObjectCommandDescriptor,
  CurrentObjectInsertNodeKind,
  CurrentObjectInsertNodeCommandDescriptor,
  CurrentObjectInsertNodeCommandId,
  CurrentObjectAlignMode,
  CurrentObjectAlignCommandDescriptor,
  CurrentObjectAlignCommandId,
  CurrentObjectReorderMode,
  CurrentObjectReorderCommandDescriptor,
  CurrentObjectReorderCommandId,
  CurrentObjectCommandId,
} from "./current-object-command-descriptors";
export {
  CURRENT_OBJECT_COMMAND_SURFACES,
  CURRENT_OBJECT_COMMAND_SURFACE_LABELS,
  CURRENT_OBJECT_DISABLED_REASONS,
  CURRENT_OBJECT_DISABLED_REASON_LABELS,
  CURRENT_OBJECT_COMMAND_FAMILIES,
  CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS,
  CURRENT_OBJECT_ALIGN_COMMAND_DESCRIPTORS,
  CURRENT_OBJECT_REORDER_COMMAND_DESCRIPTORS,
  CURRENT_OBJECT_COMMAND_DESCRIPTORS,
  findCurrentObjectCommandDescriptor,
  currentObjectCommandDescriptor,
  currentObjectCommandDescriptorsForSurface,
  currentObjectAlignCommandDescriptor,
  currentObjectReorderCommandDescriptor,
  currentObjectInsertNodeCommandDescriptor,
} from "./current-object-command-descriptors";

export type {
  StageGuide,
  StageGuideInput,
  SnapFrameResult,
} from "./stage-guides";
export {
  alignmentGuidesForFrames,
  snapFrameToStageGuides,
} from "./stage-guides";
export type { SelectionFrame } from "./selection-geometry";
export {
  normalizeSelectionFrame,
  selectNodesInFrame,
} from "./selection-geometry";

// Theme packages (built-in template registry)
export {
  createDefaultTemplateRegistry,
  BUILT_IN_TEMPLATES,
} from "./theme-packages";

// Neutral fallback theme package
export { NEUTRAL_THEME_PACKAGE } from "./neutral-theme-package";

// Runtime v7 theme package registry
export type { ThemePackageResolution } from "./theme-package-registry";
export {
  THEME_PACKAGE_REGISTRY,
  resolveThemePackageIdV7,
  getThemePackageV7,
  listThemePackagesV7,
  resolveThemePackageForDeck,
} from "./theme-package-registry";

// Native v7 starter decks
export { createBlankDeckV7 } from "./empty-deck";

// Open-deck boundary helper (current DeckV7 runtime parse)
export type { OpenDeckResult, DeckOpenDecision } from "./open-deck";
export {
  openDeckFromJson,
  openAiGeneratedDeck,
  decideDeckOpen,
  looksLikeDeckV7,
} from "./open-deck";

// Undo/redo focus targeting (structural diff of committed deck snapshots)
export type { DeckNodeDiff } from "./deck-diff";
export { diffDeckNodes, pickUndoFocusTarget } from "./deck-diff";

// PPTX export adapter (DOM-free; browser applier calls PptxGenJS with the result)
export type {
  VnextPptxLayout,
  VnextPptxTextStyle,
  VnextPptxBackgroundOp,
  VnextPptxTextOp,
  VnextPptxShapeOp,
  VnextPptxImageOp,
  VnextPptxConnectorOp,
  VnextPptxVisualOp,
  VnextPptxTableOp,
  VnextPptxOp,
  VnextPptxSlideSpec,
  VnextPptxDeckSpec,
  BuildVnextPptxSpecOptions,
} from "./pptx-export-adapter";
export { buildVnextPptxSpec } from "./pptx-export-adapter";

// Browser-only v7 PPTX applier and high-level export function
export type { PptxTextRun } from "./pptx-vnext-apply";
export {
  textContentToPptxRuns,
  vnextShapeToName,
  applyVnextTextOp,
  applyVnextShapeOp,
  applyVnextImageOp,
  applyVnextConnectorOp,
  applyVnextTableOp,
  applyVnextPptxSpec,
  exportDeckV7AsPPTX,
} from "./pptx-vnext-apply";
