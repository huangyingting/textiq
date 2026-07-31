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
    toolbarActionPending: false,
    canUndo: false,
    canRedo: false,
    handleEditorKeyDown: () => undefined,
    handleSaveNow: async () => undefined,
    handleRoundtripAction: async () => undefined,
    handleExportRequest: () => undefined,
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
    handleReorderSelection: () => undefined,
    handleDistributeSelection: () => undefined,
    handleMatchSize: () => undefined,
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

  test("routes layer palette commands to the canonical reorder handler", () => {
    const reorderModes: string[] = [];
    const controller = useSlideCommandPaletteController(
      controllerArgs({
        handleReorderSelection: (mode) => reorderModes.push(mode),
      }),
    );
    const command = controller.commandPaletteCommands.find(
      (entry) => entry.id === "selection.reorder-back",
    );

    assert.ok(command, "selection.reorder-back should be discoverable");
    assert.equal(command.disabledReason, undefined);
    controller.handleRunCommandPaletteCommand(command);
    assert.deepEqual(reorderModes, ["back"]);
  });

  test("routes export palette commands through the shared export request path", () => {
    const requestedFormats: string[] = [];
    const controller = useSlideCommandPaletteController(
      controllerArgs({
        onExportPptx: async () => undefined,
        onExportPdf: async () => undefined,
        onExportPng: async () => undefined,
        handleExportRequest: (format) => requestedFormats.push(format),
      }),
    );

    for (const commandId of ["export.pptx", "export.pdf", "export.png"]) {
      const command = controller.commandPaletteCommands.find(
        (entry) => entry.id === commandId,
      );
      assert.ok(command, `${commandId} should be discoverable`);
      assert.equal(command.disabledReason, undefined);
      controller.handleRunCommandPaletteCommand(command);
    }

    assert.deepEqual(requestedFormats, ["pptx", "pdf", "png"]);
  });

  test("routes Save now through the shared toolbar operation boundary", () => {
    let directSaveCalls = 0;
    let guardedSaveCalls = 0;
    const announcements: string[] = [];
    const controller = useSlideCommandPaletteController(
      controllerArgs({
        onSave: async () => {
          directSaveCalls += 1;
          return { ok: true, data: undefined };
        },
        handleSaveNow: async () => {
          guardedSaveCalls += 1;
        },
        setStageAnnouncement: (message) => announcements.push(message),
      }),
    );
    const command = controller.commandPaletteCommands.find(
      (entry) => entry.id === "deck.save",
    );

    assert.ok(command, "deck.save should be discoverable");
    controller.handleRunCommandPaletteCommand(command);
    assert.equal(guardedSaveCalls, 1);
    assert.equal(directSaveCalls, 0);
    assert.deepEqual(announcements, []);
  });
});
