import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SetStateAction } from "react";

import { buildMinimalDeck } from "@/test/builders/presentation-deck";
import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  createSlideEditorShellController,
  type SlideEditorShellController,
  type SlideEditorToolbarOperation,
  type UseSlideEditorShellControllerArgs,
  useSlideEditorShellController,
} from "./use-slide-editor-shell-controller";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createControllerHarness(
  args: UseSlideEditorShellControllerArgs,
): () => SlideEditorShellController {
  let toolbarError: string | null = null;
  let toolbarOperation: SlideEditorToolbarOperation | null = null;
  const toolbarOperationRef: {
    current: SlideEditorToolbarOperation | null;
  } = { current: null };
  let closeConfirmOpen = false;
  const setToolbarError = (next: SetStateAction<string | null>): void => {
    toolbarError = typeof next === "function" ? next(toolbarError) : next;
  };
  const setCloseConfirmOpen = (next: SetStateAction<boolean>): void => {
    closeConfirmOpen =
      typeof next === "function" ? next(closeConfirmOpen) : next;
  };
  const setToolbarOperation = (
    next: SetStateAction<SlideEditorToolbarOperation | null>,
  ): void => {
    toolbarOperation =
      typeof next === "function" ? next(toolbarOperation) : next;
  };

  return () =>
    createSlideEditorShellController({
      ...args,
      toolbarError,
      setToolbarError,
      toolbarOperation,
      setToolbarOperation,
      claimToolbarOperation: (operation) => {
        if (toolbarOperationRef.current) return false;
        toolbarOperationRef.current = operation;
        return true;
      },
      releaseToolbarOperation: (operation) => {
        if (toolbarOperationRef.current !== operation) return false;
        toolbarOperationRef.current = null;
        return true;
      },
      closeConfirmOpen,
      setCloseConfirmOpen,
    });
}

describe("useSlideEditorShellController", () => {
  test("surfaces PPTX export failures in the toolbar error banner", async () => {
    const deck = buildMinimalDeck();
    const renderController = createControllerHarness({
      deck,
      hasUnsavedWork: false,
      onExportPptx: async () => {
        throw new Error("export failed");
      },
      setStageAnnouncement: () => undefined,
    });

    let controller = renderController();
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      await controller.handleExportPptx();
    } finally {
      console.error = originalConsoleError;
    }

    controller = renderController();
    assert.equal(
      controller.toolbarError,
      "PPTX export failed. Please try again.",
    );
  });

  test("saves before roundtrip actions and blocks routes on save failure", async () => {
    const deck = buildMinimalDeck();
    const calls: string[] = [];
    const renderController = createControllerHarness({
      deck,
      hasUnsavedWork: false,
      onSave: async (savedDeck) => {
        calls.push("save");
        assert.equal(savedDeck, deck);
        return { ok: false, error: "Save blocked" };
      },
      setStageAnnouncement: () => undefined,
    });

    let controller = renderController();
    await controller.handleRoundtripAction(async () => {
      calls.push("present");
      return { ok: true, data: undefined };
    }, "Presentation route failed. Please try again.");

    controller = renderController();
    assert.deepEqual(calls, ["save"]);
    assert.equal(controller.toolbarError, "Save blocked");
  });

  test("Save now surfaces action failures and announces only confirmed success", async () => {
    const deck = buildMinimalDeck();
    const announcements: string[] = [];
    let saveCalls = 0;
    const renderController = createControllerHarness({
      deck,
      hasUnsavedWork: false,
      onSave: async () => {
        saveCalls += 1;
        return saveCalls === 1
          ? { ok: false, error: "Save rejected" }
          : { ok: true, data: undefined };
      },
      setStageAnnouncement: (message) => announcements.push(message),
    });

    let controller = renderController();
    await controller.handleSaveNow();
    controller = renderController();
    assert.equal(controller.toolbarError, "Save rejected");
    assert.deepEqual(announcements, []);

    await controller.handleSaveNow();
    controller = renderController();
    assert.equal(controller.toolbarError, null);
    assert.deepEqual(announcements, ["Slide deck saved."]);
  });

  test("unmounting invalidates a pending save before its late success announcement", async () => {
    const saveAttempt = deferred<{
      ok: true;
      data: undefined;
    }>();
    const announcements: string[] = [];
    const renderer = createReactRenderHarness();
    const controller = renderer.run(() =>
      useSlideEditorShellController({
        deck: buildMinimalDeck(),
        hasUnsavedWork: true,
        onSave: () => saveAttempt.promise,
        setStageAnnouncement: (message) => announcements.push(message),
      }),
    );
    const settled = controller.handleSaveNow();
    assert.deepEqual(announcements, []);

    renderer.cleanup();
    saveAttempt.resolve({ ok: true, data: undefined });
    await settled;

    assert.deepEqual(announcements, []);
  });

  test("one synchronous boundary suppresses duplicate and competing toolbar operations", async () => {
    const deck = buildMinimalDeck();
    let exportCalls = 0;
    let regenerateCalls = 0;
    let saveCalls = 0;
    let resolveExport!: () => void;
    const exportPromise = new Promise<void>((resolve) => {
      resolveExport = resolve;
    });
    const renderController = createControllerHarness({
      deck,
      hasUnsavedWork: false,
      onExportPptx: () => {
        exportCalls += 1;
        return exportPromise;
      },
      onRegenerate: async () => {
        regenerateCalls += 1;
        return { ok: true, data: undefined };
      },
      onSave: async () => {
        saveCalls += 1;
        return { ok: true, data: undefined };
      },
      setStageAnnouncement: () => undefined,
    });

    let controller = renderController();
    const firstExport = controller.handleExportPptx();
    const duplicateExport = controller.handleExportPptx();
    const competingRegenerate = controller.handleRegenerate();
    const competingSave = controller.handleSaveNow();

    assert.equal(exportCalls, 1);
    assert.equal(regenerateCalls, 0);
    assert.equal(saveCalls, 0);
    controller = renderController();
    assert.equal(controller.toolbarActionPending, true);

    resolveExport();
    await Promise.all([
      firstExport,
      duplicateExport,
      competingRegenerate,
      competingSave,
    ]);
    controller = renderController();
    assert.equal(controller.toolbarActionPending, false);

    await controller.handleRegenerate();
    assert.equal(regenerateCalls, 1);
  });

  test("Next navigation control flow escapes toolbar recovery and releases the operation lock", async () => {
    const deck = buildMinimalDeck();
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/present;307;",
    });
    let successfulRoundtrips = 0;
    const renderController = createControllerHarness({
      deck,
      hasUnsavedWork: false,
      setStageAnnouncement: () => undefined,
    });

    let controller = renderController();
    await assert.rejects(
      () =>
        controller.handleRoundtripAction(
          () => Promise.reject(redirectError),
          "fallback should not replace redirect control flow",
        ),
      (error: unknown) => error === redirectError,
    );

    controller = renderController();
    assert.equal(controller.toolbarActionPending, false);
    assert.equal(controller.toolbarError, null);
    await controller.handleRoundtripAction(async () => {
      successfulRoundtrips += 1;
      return { ok: true, data: undefined };
    }, "roundtrip failed");
    assert.equal(successfulRoundtrips, 1);
  });

  test("announces roundtrip success only after the action confirms it", async () => {
    const deck = buildMinimalDeck();
    const announcements: string[] = [];
    const renderController = createControllerHarness({
      deck,
      hasUnsavedWork: false,
      setStageAnnouncement: (message) => announcements.push(message),
    });

    let controller = renderController();
    await controller.handleRoundtripAction(
      async () => ({ ok: false, error: "Share rejected" }),
      "Share route failed. Please try again.",
      "Share flow opened.",
    );
    assert.deepEqual(announcements, []);

    controller = renderController();
    await controller.handleRoundtripAction(
      async () => ({ ok: true, data: undefined }),
      "Share route failed. Please try again.",
      "Share flow opened.",
    );
    assert.deepEqual(announcements, ["Share flow opened."]);
  });

  test("announces successful regeneration after clearing prior errors", async () => {
    const deck = buildMinimalDeck();
    let announcement = "";
    const renderController = createControllerHarness({
      deck,
      hasUnsavedWork: false,
      onRegenerate: async () => ({ ok: true, data: undefined }),
      setStageAnnouncement: (message) => {
        announcement = message;
      },
    });

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
    const deck = buildMinimalDeck();
    let closeCount = 0;
    const renderController = createControllerHarness({
      deck,
      hasUnsavedWork: true,
      onClose: () => {
        closeCount += 1;
      },
      setStageAnnouncement: () => undefined,
    });

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
