import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildMinimalDeckV7 } from "@/test/builders/deck-v7";
import { createServerRenderHarness } from "@/test/react-server-renderer";

import { useSlideEditorShellController } from "./use-slide-editor-shell-controller";

describe("useSlideEditorShellController", () => {
  test("surfaces PPTX export failures in the toolbar error banner", async () => {
    const hookRenderer = createServerRenderHarness();
    const deck = buildMinimalDeckV7();
    const renderController = () =>
      hookRenderer.run(() =>
        useSlideEditorShellController({
          deck,
          hasUnsavedWork: false,
          onExportPptx: async () => {
            throw new Error("export failed");
          },
          setStageAnnouncement: () => undefined,
        }),
      );

    let controller = renderController();
    await controller.handleExportPptx();

    controller = renderController();
    assert.equal(
      controller.toolbarError,
      "PPTX export failed. Please try again.",
    );
  });

  test("saves before roundtrip actions and blocks routes on save failure", async () => {
    const hookRenderer = createServerRenderHarness();
    const deck = buildMinimalDeckV7();
    const calls: string[] = [];
    const renderController = () =>
      hookRenderer.run(() =>
        useSlideEditorShellController({
          deck,
          hasUnsavedWork: false,
          onSave: async (savedDeck) => {
            calls.push("save");
            assert.equal(savedDeck, deck);
            return { ok: false, error: "Save blocked" };
          },
          setStageAnnouncement: () => undefined,
        }),
      );

    let controller = renderController();
    await controller.handleRoundtripAction(async () => {
      calls.push("present");
      return { ok: true, data: undefined };
    }, "Presentation route failed. Please try again.");

    controller = renderController();
    assert.deepEqual(calls, ["save"]);
    assert.equal(controller.toolbarError, "Save blocked");
  });

  test("announces successful regeneration after clearing prior errors", async () => {
    const hookRenderer = createServerRenderHarness();
    const deck = buildMinimalDeckV7();
    let announcement = "";
    const renderController = () =>
      hookRenderer.run(() =>
        useSlideEditorShellController({
          deck,
          hasUnsavedWork: false,
          onRegenerate: async () => ({ ok: true, data: undefined }),
          setStageAnnouncement: (message) => {
            announcement = message;
          },
        }),
      );

    let controller = renderController();
    controller.setToolbarError("Previous toolbar error");
    controller = renderController();
    assert.equal(controller.toolbarError, "Previous toolbar error");

    await controller.handleRegenerate();

    controller = renderController();
    assert.equal(controller.toolbarError, null);
    assert.equal(
      announcement,
      "Regenerated slides from the latest saved document.",
    );
  });

  test("routes unsaved close requests through confirm actions", () => {
    const hookRenderer = createServerRenderHarness();
    const deck = buildMinimalDeckV7();
    let closeCount = 0;
    const renderController = () =>
      hookRenderer.run(() =>
        useSlideEditorShellController({
          deck,
          hasUnsavedWork: true,
          onClose: () => {
            closeCount += 1;
          },
          setStageAnnouncement: () => undefined,
        }),
      );

    let controller = renderController();
    controller.handleCloseRequest();

    controller = renderController();
    assert.equal(controller.closeConfirmOpen, true);

    controller.handleCloseConfirmCancel();
    controller = renderController();
    assert.equal(controller.closeConfirmOpen, false);
    assert.equal(closeCount, 0);

    controller.handleCloseRequest();
    controller = renderController();
    controller.handleCloseConfirmDiscard();
    controller = renderController();
    assert.equal(controller.closeConfirmOpen, false);
    assert.equal(closeCount, 1);
  });
});
