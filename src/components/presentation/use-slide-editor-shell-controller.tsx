import {
  useEffect,
  useState,
  type Dispatch,
  type JSX,
  type SetStateAction,
} from "react";
import { unstable_rethrow } from "next/navigation";

import type { ActionResult } from "@/lib/action-result";
import type { Deck } from "@/lib/presentation/schema";
import { Dialog } from "@/components/ui/dialog";
import { cx, FOCUS_RING } from "@/components/ui/tokens";

interface CloseRequestHandlers {
  openCloseConfirmDialog: () => void;
  closeEditor: () => void;
}

export function routeCloseRequest(
  hasUnsavedWork: boolean,
  handlers: CloseRequestHandlers,
): void {
  if (hasUnsavedWork) {
    handlers.openCloseConfirmDialog();
    return;
  }
  handlers.closeEditor();
}

interface CloseConfirmActionHandlers {
  closeCloseConfirmDialog: () => void;
  closeEditor: () => void;
}

export function handleCloseConfirmAction(
  action: "cancel" | "discard",
  handlers: CloseConfirmActionHandlers,
): void {
  handlers.closeCloseConfirmDialog();
  if (action === "discard") {
    handlers.closeEditor();
  }
}

interface BeforeUnloadGuardHandlers {
  addBeforeUnloadListener: (
    listener: (event: BeforeUnloadEvent) => void,
  ) => void;
  removeBeforeUnloadListener: (
    listener: (event: BeforeUnloadEvent) => void,
  ) => void;
}

export function setupBeforeUnloadGuard(
  hasUnsavedWork: boolean,
  handlers: BeforeUnloadGuardHandlers,
): (() => void) | undefined {
  if (!hasUnsavedWork) {
    return undefined;
  }
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  handlers.addBeforeUnloadListener(onBeforeUnload);
  return () => handlers.removeBeforeUnloadListener(onBeforeUnload);
}

export function SlideEditorCloseConfirmDialog({
  onCancel,
  onDiscard,
}: {
  onCancel: () => void;
  onDiscard: () => void;
}): JSX.Element {
  return (
    <Dialog
      open
      onClose={onCancel}
      aria-labelledby="slide-editor-close-confirm-title"
      className="max-w-sm"
    >
      <h2
        id="slide-editor-close-confirm-title"
        className="text-base font-semibold text-ds-text-primary"
      >
        Close and discard changes?
      </h2>
      <p className="mt-2 text-sm text-ds-text-secondary">
        You have unsaved slide changes. Close the editor and discard them?
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className={cx(
            "flex h-9 items-center justify-center rounded-full border border-ds-border-strong px-4 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary",
            FOCUS_RING,
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className={cx(
            "flex h-9 items-center justify-center rounded-full bg-ds-danger px-4 text-sm font-medium text-ds-text-on-accent transition hover:opacity-90",
            FOCUS_RING,
          )}
        >
          Discard changes
        </button>
      </div>
    </Dialog>
  );
}

export interface UseSlideEditorShellControllerArgs {
  deck: Deck;
  hasUnsavedWork: boolean;
  onClose?: () => void;
  onExportPptx?: () => Promise<void>;
  onExportPdf?: () => Promise<void>;
  onExportPng?: () => Promise<void>;
  onRegenerate?: () => Promise<ActionResult>;
  onSave?: (deck: Deck) => Promise<ActionResult>;
  setStageAnnouncement: (announcement: string) => void;
}

export interface SlideEditorShellController {
  toolbarError: string | null;
  setToolbarError: Dispatch<SetStateAction<string | null>>;
  toolbarActionPending: boolean;
  closeConfirmOpen: boolean;
  handleSaveNow: () => Promise<void>;
  handleExportPptx: () => Promise<void>;
  handleExportPdf: () => Promise<void>;
  handleExportPng: () => Promise<void>;
  handleRegenerate: () => Promise<void>;
  handleRoundtripAction: (
    action: (() => Promise<ActionResult>) | undefined,
    fallbackError: string,
    successAnnouncement?: string,
  ) => Promise<void>;
  handleCloseRequest: () => void;
  handleCloseConfirmCancel: () => void;
  handleCloseConfirmDiscard: () => void;
}

export type SlideEditorToolbarOperation =
  | "save"
  | "export-pptx"
  | "export-pdf"
  | "export-png"
  | "regenerate"
  | "roundtrip";

export function createSlideEditorToolbarOperationBoundary(): {
  claim: (operation: SlideEditorToolbarOperation) => boolean;
  release: (operation: SlideEditorToolbarOperation) => boolean;
} {
  let currentOperation: SlideEditorToolbarOperation | null = null;
  return {
    claim(operation) {
      if (currentOperation) return false;
      currentOperation = operation;
      return true;
    },
    release(operation) {
      if (currentOperation !== operation) return false;
      currentOperation = null;
      return true;
    },
  };
}

interface CreateSlideEditorShellControllerArgs extends UseSlideEditorShellControllerArgs {
  toolbarError: string | null;
  setToolbarError: Dispatch<SetStateAction<string | null>>;
  toolbarOperation: SlideEditorToolbarOperation | null;
  setToolbarOperation: Dispatch<
    SetStateAction<SlideEditorToolbarOperation | null>
  >;
  claimToolbarOperation: (operation: SlideEditorToolbarOperation) => boolean;
  releaseToolbarOperation: (operation: SlideEditorToolbarOperation) => boolean;
  closeConfirmOpen: boolean;
  setCloseConfirmOpen: Dispatch<SetStateAction<boolean>>;
}

export function createSlideEditorShellController({
  deck,
  hasUnsavedWork,
  onClose,
  onExportPptx,
  onExportPdf,
  onExportPng,
  onRegenerate,
  onSave,
  setStageAnnouncement,
  toolbarError,
  setToolbarError,
  toolbarOperation,
  setToolbarOperation,
  claimToolbarOperation,
  releaseToolbarOperation,
  closeConfirmOpen,
  setCloseConfirmOpen,
}: CreateSlideEditorShellControllerArgs): SlideEditorShellController {
  async function runToolbarOperation(
    operation: SlideEditorToolbarOperation,
    action: () => Promise<void>,
    fallbackError: string,
    logLabel?: string,
  ): Promise<void> {
    if (!claimToolbarOperation(operation)) return;
    setToolbarOperation(operation);
    setToolbarError(null);
    try {
      await action();
    } catch (error) {
      unstable_rethrow(error);
      if (logLabel) console.error(logLabel, error);
      setToolbarError(fallbackError);
    } finally {
      if (releaseToolbarOperation(operation)) {
        setToolbarOperation(null);
      }
    }
  }

  async function handleSaveNow() {
    if (!onSave) return;
    await runToolbarOperation(
      "save",
      async () => {
        const result = await onSave(deck);
        if (!result.ok) {
          setToolbarError(result.error);
          return;
        }
        setStageAnnouncement("Slide deck saved.");
      },
      "Save failed. Please try again.",
    );
  }

  async function handleExportPptx() {
    if (!onExportPptx) return;
    await runToolbarOperation(
      "export-pptx",
      onExportPptx,
      "PPTX export failed. Please try again.",
      "PPTX export failed",
    );
  }

  async function handleExportPdf() {
    if (!onExportPdf) return;
    await runToolbarOperation(
      "export-pdf",
      onExportPdf,
      "PDF export failed. Please try again.",
      "PDF export failed",
    );
  }

  async function handleExportPng() {
    if (!onExportPng) return;
    await runToolbarOperation(
      "export-png",
      onExportPng,
      "PNG export failed. Please try again.",
      "PNG export failed",
    );
  }

  async function handleRegenerate() {
    if (!onRegenerate) return;
    await runToolbarOperation(
      "regenerate",
      async () => {
        const result = await onRegenerate();
        if (!result.ok) {
          setToolbarError(result.error);
          return;
        }
        setStageAnnouncement(
          "Regenerated slides from the latest saved document.",
        );
      },
      "Regenerate failed. Please try again.",
    );
  }

  async function handleRoundtripAction(
    action: (() => Promise<ActionResult>) | undefined,
    fallbackError: string,
    successAnnouncement?: string,
  ) {
    if (!action) return;
    await runToolbarOperation(
      "roundtrip",
      async () => {
        if (onSave) {
          const saveResult = await onSave(deck);
          if (!saveResult.ok) {
            setToolbarError(saveResult.error);
            return;
          }
        }
        const result = await action();
        if (!result.ok) {
          setToolbarError(result.error);
          return;
        }
        if (successAnnouncement) setStageAnnouncement(successAnnouncement);
      },
      fallbackError,
    );
  }

  function handleCloseRequest() {
    routeCloseRequest(hasUnsavedWork, {
      openCloseConfirmDialog: () => setCloseConfirmOpen(true),
      closeEditor: () => onClose?.(),
    });
  }

  function handleCloseConfirmCancel() {
    handleCloseConfirmAction("cancel", {
      closeCloseConfirmDialog: () => setCloseConfirmOpen(false),
      closeEditor: () => onClose?.(),
    });
  }

  function handleCloseConfirmDiscard() {
    handleCloseConfirmAction("discard", {
      closeCloseConfirmDialog: () => setCloseConfirmOpen(false),
      closeEditor: () => onClose?.(),
    });
  }

  return {
    toolbarError,
    setToolbarError,
    toolbarActionPending: toolbarOperation !== null,
    closeConfirmOpen,
    handleSaveNow,
    handleExportPptx,
    handleExportPdf,
    handleExportPng,
    handleRegenerate,
    handleRoundtripAction,
    handleCloseRequest,
    handleCloseConfirmCancel,
    handleCloseConfirmDiscard,
  };
}

export function useSlideEditorShellController({
  deck,
  hasUnsavedWork,
  onClose,
  onExportPptx,
  onExportPdf,
  onExportPng,
  onRegenerate,
  onSave,
  setStageAnnouncement,
}: UseSlideEditorShellControllerArgs): SlideEditorShellController {
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  const [toolbarOperationBoundary] = useState(
    createSlideEditorToolbarOperationBoundary,
  );
  const [toolbarOperation, setToolbarOperation] =
    useState<SlideEditorToolbarOperation | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const controller = createSlideEditorShellController({
    deck,
    hasUnsavedWork,
    onClose,
    onExportPptx,
    onExportPdf,
    onExportPng,
    onRegenerate,
    onSave,
    setStageAnnouncement,
    toolbarError,
    setToolbarError,
    toolbarOperation,
    setToolbarOperation,
    claimToolbarOperation: toolbarOperationBoundary.claim,
    releaseToolbarOperation: toolbarOperationBoundary.release,
    closeConfirmOpen,
    setCloseConfirmOpen,
  });

  useEffect(
    () =>
      setupBeforeUnloadGuard(hasUnsavedWork, {
        addBeforeUnloadListener: (listener) =>
          window.addEventListener("beforeunload", listener),
        removeBeforeUnloadListener: (listener) =>
          window.removeEventListener("beforeunload", listener),
      }),
    [hasUnsavedWork],
  );

  return controller;
}
