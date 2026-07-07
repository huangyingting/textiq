import type { KeyboardEvent } from "react";

import type { ActionResult } from "@/lib/action-result";
import {
  findCurrentObjectCommandDescriptor,
  resolveSlideCommandPaletteCommands,
  type Deck,
  type SlideChildNode,
  type SlideCommandPaletteCommand,
  type StyleObject,
  type StylePatch,
} from "@/lib/presentation";
import type { SaveStatus } from "@/lib/presentation/save-status";
import {
  availablePanels,
  type InspectorPanelId,
} from "@/lib/presentation/inspector-panel-ui";

import type {
  SelectionAlignMode,
  SelectionDistributeMode,
  SelectionMatchSizeMode,
} from "./toolbar/context-toolbar";
import {
  routeContextToolbarTextCommand,
  seedContextToolbarStyles,
} from "./toolbar/context-toolbar";

type SlideCommandPaletteKeyboardEvent =
  | KeyboardEvent<HTMLDivElement>
  | globalThis.KeyboardEvent;

export interface SlideCommandPaletteControllerArgs {
  deck: Deck;
  hasActiveSlide: boolean;
  selectedNode: SlideChildNode | null;
  selectedIds: readonly string[];
  isDecorationSelected: boolean;
  isInlineEditing: boolean;
  isTableEditing: boolean;
  hasSelectedSource: boolean;
  selectedResolvedStyle?: StyleObject;
  sourceReviewCount: number;
  diagnosticsCount: number;
  saveStatus: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  onSave?: (deck: Deck) => Promise<ActionResult>;
  onUndo?: () => void;
  onRedo?: () => void;
  onPresent?: () => Promise<ActionResult>;
  onShare?: () => Promise<ActionResult>;
  onExportPptx?: () => Promise<void>;
  onExportPdf?: () => Promise<void>;
  onExportPng?: () => Promise<void>;
  handleEditorKeyDown: (event: SlideCommandPaletteKeyboardEvent) => void;
  handleRoundtripAction: (
    action: (() => Promise<ActionResult>) | undefined,
    fallbackError: string,
  ) => Promise<void>;
  handleExportPptx: () => Promise<void>;
  handleExportPdf: () => Promise<void>;
  handleExportPng: () => Promise<void>;
  handleInsertSlide: () => void;
  handleDuplicateActiveSlide: () => void;
  handleDeleteActiveSlide: () => void;
  handleInsertText: () => void;
  handleInsertShape: () => void;
  handleInsertImage: () => void;
  handleInsertVisual: () => Promise<void>;
  handleInsertConnector: () => void;
  handleInsertTable: () => void;
  handleAlignSelection: (mode: SelectionAlignMode) => void;
  handleDistributeSelection: (mode: SelectionDistributeMode) => void;
  handleMatchSize: (mode: SelectionMatchSizeMode) => void;
  handleGroupSelection: () => void;
  handleUngroupSelection: () => void;
  handleDuplicateSelection: () => void;
  handleDeleteSelection: () => void;
  handleCutNodes: () => Promise<void>;
  handleUpdateSelectedAttributes: (patch: { locked?: boolean }) => void;
  handleUpdateSelectedLocalStyle: (patch: StylePatch) => void;
  handleReviewSourceLinks: () => void;
  openInspectorPanel: (panel: InspectorPanelId) => void;
  focusSelectedNodeSoon: (nodeId: string) => void;
  focusStageViewportSoon: () => void;
  focusEditorRootSoon: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setShortcutHelpOpen: (open: boolean) => void;
  setDeckDiagnosticsReviewOpen: (open: boolean) => void;
  setDeckChromeToolbarOpen: (open: boolean) => void;
  setStageAnnouncement: (announcement: string) => void;
}

export function useSlideCommandPaletteController(
  args: SlideCommandPaletteControllerArgs,
) {
  const {
    deck,
    hasActiveSlide,
    selectedNode,
    selectedIds,
    isDecorationSelected,
    isInlineEditing,
    isTableEditing,
    hasSelectedSource,
    sourceReviewCount,
    diagnosticsCount,
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
  } = args;

  const commandPaletteCommands = resolveSlideCommandPaletteCommands({
    hasActiveSlide,
    slideCount: deck.slides.length,
    selectedNode,
    selectedCount: selectedIds.length,
    isDecorationSelected,
    isInlineEditing,
    isTableEditing,
    hasSelectedSource,
    hasSourceReview: sourceReviewCount > 0,
    hasDiagnostics: diagnosticsCount > 0,
    availablePanels: availablePanels(selectedNode, {
      multiSelect: selectedIds.length > 1,
      isDecoration: isDecorationSelected,
      hasDiagnostics: diagnosticsCount > 0,
    }),
    capabilities: {
      canSave: onSave !== undefined,
      canUndo: onUndo !== undefined && canUndo,
      canRedo: onRedo !== undefined && canRedo,
      canPresent: onPresent !== undefined,
      canShare: onShare !== undefined,
      canExportPptx: onExportPptx !== undefined,
      canExportPdf: onExportPdf !== undefined,
      canExportPng: onExportPng !== undefined,
      saveStatus,
    },
  });

  function openDescriptorInspectorPanel(commandId: string): boolean {
    const descriptor = findCurrentObjectCommandDescriptor(commandId);
    const panel = descriptor?.owners.find(
      (owner) => owner.surface === "inspector" && owner.inspectorPanel,
    )?.inspectorPanel;
    if (!panel) return false;
    args.openInspectorPanel(panel);
    return true;
  }

  function runCurrentObjectPaletteCommand(commandId: string) {
    if (commandId.startsWith("selection.align-")) {
      args.handleAlignSelection(
        commandId.replace("selection.align-", "") as SelectionAlignMode,
      );
      return;
    }
    switch (commandId) {
      case "slide.insert":
        args.handleInsertSlide();
        return;
      case "slide.duplicate":
        args.handleDuplicateActiveSlide();
        return;
      case "slide.delete":
        args.handleDeleteActiveSlide();
        return;
      case "slide.insert-text":
        args.handleInsertText();
        return;
      case "slide.insert-shape":
        args.handleInsertShape();
        return;
      case "slide.insert-image":
        args.handleInsertImage();
        return;
      case "slide.insert-visual":
        void args.handleInsertVisual();
        return;
      case "slide.insert-connector":
      case "connector.create":
        args.handleInsertConnector();
        return;
      case "slide.insert-table":
        args.handleInsertTable();
        return;
      case "selection.distribute-horizontal":
        args.handleDistributeSelection("horizontal");
        return;
      case "selection.distribute-vertical":
        args.handleDistributeSelection("vertical");
        return;
      case "selection.match-width":
        args.handleMatchSize("width");
        return;
      case "selection.match-height":
        args.handleMatchSize("height");
        return;
      case "selection.group":
        args.handleGroupSelection();
        return;
      case "selection.ungroup":
        args.handleUngroupSelection();
        return;
      case "selection.duplicate":
        args.handleDuplicateSelection();
        return;
      case "selection.delete":
        args.handleDeleteSelection();
        return;
      case "selection.cut":
        void args.handleCutNodes();
        return;
      case "selection.lock":
        if (selectedNode) {
          args.handleUpdateSelectedAttributes({
            locked: selectedNode.locked !== true,
          });
        }
        return;
      case "text.bold":
        routeContextToolbarTextCommand({
          command: "bold",
          isInlineEditing,
          textStyle: seedContextToolbarStyles(
            selectedNode ?? undefined,
            args.selectedResolvedStyle,
          ).textStyle,
          onUpdateSelectedLocalStyle: args.handleUpdateSelectedLocalStyle,
        });
        return;
      case "source.review":
        if (sourceReviewCount > 0) args.handleReviewSourceLinks();
        else args.openInspectorPanel("source");
        return;
      case "diagnostics.repair":
        args.setDeckDiagnosticsReviewOpen(true);
        return;
      case "stage.select-object":
      case "stage.transform-selection":
        if (selectedIds[0]) args.focusSelectedNodeSoon(selectedIds[0]);
        else args.focusStageViewportSoon();
        return;
      default:
        if (!openDescriptorInspectorPanel(commandId))
          args.focusEditorRootSoon();
    }
  }

  function handleRunCommandPaletteCommand(command: SlideCommandPaletteCommand) {
    if (command.disabledReason) return;
    args.setCommandPaletteOpen(false);
    switch (command.intent.kind) {
      case "current-object":
        runCurrentObjectPaletteCommand(command.intent.commandId);
        break;
      case "open-inspector-panel":
        args.openInspectorPanel(command.intent.panel);
        break;
      case "open-shortcuts":
        args.setShortcutHelpOpen(true);
        break;
      case "save":
        if (onSave) void onSave(deck);
        break;
      case "undo":
        if (canUndo && onUndo) onUndo();
        break;
      case "redo":
        if (canRedo && onRedo) onRedo();
        break;
      case "present":
        if (onPresent) {
          void args.handleRoundtripAction(
            onPresent,
            "Presentation route failed. Please try again.",
          );
        }
        break;
      case "share":
        if (onShare) {
          void args.handleRoundtripAction(
            onShare,
            "Share route failed. Please try again.",
          );
        }
        break;
      case "deck-chrome":
        args.setDeckChromeToolbarOpen(true);
        break;
      case "source-review":
        if (sourceReviewCount > 0) args.handleReviewSourceLinks();
        else args.openInspectorPanel("source");
        break;
      case "diagnostics":
        args.setDeckDiagnosticsReviewOpen(true);
        break;
      case "export":
        if (command.intent.format === "pptx") void args.handleExportPptx();
        if (command.intent.format === "pdf") void args.handleExportPdf();
        if (command.intent.format === "png") void args.handleExportPng();
        break;
    }
    args.setStageAnnouncement(command.liveMessage);
  }

  function handleSlideEditorKeyDown(event: SlideCommandPaletteKeyboardEvent) {
    if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      args.setCommandPaletteOpen(true);
      return;
    }
    args.handleEditorKeyDown(event);
  }

  return {
    commandPaletteCommands,
    handleRunCommandPaletteCommand,
    handleSlideEditorKeyDown,
  };
}
