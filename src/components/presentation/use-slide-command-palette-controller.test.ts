import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { StylePatch } from "@/lib/presentation";
import {
  buildDeck,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";

import {
  useSlideCommandPaletteController,
  type SlideCommandPaletteControllerArgs,
} from "./use-slide-command-palette-controller";

function controllerArgs(
  overrides: Partial<SlideCommandPaletteControllerArgs> = {},
): SlideCommandPaletteControllerArgs {
  const selectedNode = buildTextNode();
  return {
    deck: buildDeck([buildSlide("content", [selectedNode])]),
    hasActiveSlide: true,
    selectedNode,
    selectedIds: [selectedNode.id],
    isDecorationSelected: false,
    isInlineEditing: false,
    isTableEditing: false,
    hasSelectedSource: false,
    sourceReviewCount: 0,
    diagnosticsCount: 0,
    saveStatus: "saved",
    canUndo: false,
    canRedo: false,
    handleEditorKeyDown: () => undefined,
    handleRoundtripAction: async () => undefined,
    handleExportPptx: async () => undefined,
    handleExportPdf: async () => undefined,
    handleExportPng: async () => undefined,
    handleInsertSlide: () => undefined,
    handleDuplicateActiveSlide: () => undefined,
    handleDeleteActiveSlide: () => undefined,
    handleInsertText: () => undefined,
    handleInsertShape: () => undefined,
    handleInsertImage: () => undefined,
    handleInsertVisual: async () => undefined,
    handleInsertConnector: () => undefined,
    handleInsertTable: () => undefined,
    handleAlignSelection: () => undefined,
    handleDistributeSelection: () => undefined,
    handleMatchSize: () => undefined,
    handleReorderSelection: () => undefined,
    handleGroupSelection: () => undefined,
    handleUngroupSelection: () => undefined,
    handleDuplicateSelection: () => undefined,
    handleDeleteSelection: () => undefined,
    handleCutNodes: async () => undefined,
    handleUpdateSelectedAttributes: () => undefined,
    handleUpdateSelectedLocalStyle: () => undefined,
    handleReviewSourceLinks: () => undefined,
    openInspectorPanel: () => undefined,
    focusSelectedNodeSoon: () => undefined,
    focusStageViewportSoon: () => undefined,
    focusEditorRootSoon: () => undefined,
    setCommandPaletteOpen: () => undefined,
    setShortcutHelpOpen: () => undefined,
    setDeckDiagnosticsReviewOpen: () => undefined,
    setDeckChromeToolbarOpen: () => undefined,
    setStageAnnouncement: () => undefined,
    ...overrides,
  };
}

describe("useSlideCommandPaletteController", () => {
  test("routes enabled Bold palette command through the text formatting toggle", () => {
    const patches: StylePatch[] = [];
    const openedPanels: string[] = [];
    const announcements: string[] = [];
    const args = controllerArgs({
      selectedResolvedStyle: { text: { weight: 400 } },
      handleUpdateSelectedLocalStyle: (patch) => patches.push(patch),
      openInspectorPanel: (panel) => openedPanels.push(panel),
      setStageAnnouncement: (message) => announcements.push(message),
    });
    const controller = useSlideCommandPaletteController(args);
    const command = controller.commandPaletteCommands.find(
      (entry) => entry.id === "text.bold",
    );

    assert.ok(command, "text.bold should be discoverable");
    assert.equal(command.disabledReason, undefined);
    controller.handleRunCommandPaletteCommand(command);

    assert.deepEqual(patches, [{ text: { weight: 700 } }]);
    assert.deepEqual(openedPanels, []);
    assert.deepEqual(announcements, ["Bold text toggled."]);
  });
});
