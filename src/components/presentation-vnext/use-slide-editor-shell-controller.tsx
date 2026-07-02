import {
  useEffect,
  useState,
  type Dispatch,
  type JSX,
  type SetStateAction,
} from "react";

import type { ActionResult } from "@/lib/action-result";
import type { DeckV7 } from "@/lib/presentation-vnext/schema";
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
      aria-labelledby="slide-editor-vnext-close-confirm-title"
      className="max-w-sm"
    >
      <h2
        id="slide-editor-vnext-close-confirm-title"
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
  deck: DeckV7;
  hasUnsavedWork: boolean;
  onClose?: () => void;
  onExportPptx?: () => Promise<void>;
  onExportPdf?: () => Promise<void>;
  onExportPng?: () => Promise<void>;
  onRegenerate?: () => Promise<ActionResult>;
  onSave?: (deck: DeckV7) => Promise<ActionResult>;
  setStageAnnouncement: (announcement: string) => void;
}

export interface SlideEditorShellController {
  toolbarError: string | null;
  setToolbarError: Dispatch<SetStateAction<string | null>>;
  closeConfirmOpen: boolean;
  handleExportPptx: () => Promise<void>;
  handleExportPdf: () => Promise<void>;
  handleExportPng: () => Promise<void>;
  handleRegenerate: () => Promise<void>;
  handleRoundtripAction: (
    action: (() => Promise<ActionResult>) | undefined,
    fallbackError: string,
  ) => Promise<void>;
  handleCloseRequest: () => void;
  handleCloseConfirmCancel: () => void;
  handleCloseConfirmDiscard: () => void;
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
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  async function handleExportPptx() {
    if (!onExportPptx) return;
    setToolbarError(null);
    try {
      await onExportPptx();
    } catch {
      setToolbarError("PPTX export failed. Please try again.");
    }
  }

  async function handleExportPdf() {
    if (!onExportPdf) return;
    setToolbarError(null);
    try {
      await onExportPdf();
    } catch {
      setToolbarError("PDF export failed. Please try again.");
    }
  }

  async function handleExportPng() {
    if (!onExportPng) return;
    setToolbarError(null);
    try {
      await onExportPng();
    } catch {
      setToolbarError("PNG export failed. Please try again.");
    }
  }

  async function handleRegenerate() {
    if (!onRegenerate) return;
    setToolbarError(null);
    try {
      const result = await onRegenerate();
      if (!result.ok) {
        setToolbarError(result.error);
        return;
      }
      setStageAnnouncement(
        "Regenerated slides from the latest saved document.",
      );
    } catch {
      setToolbarError("Regenerate failed. Please try again.");
    }
  }

  async function handleRoundtripAction(
    action: (() => Promise<ActionResult>) | undefined,
    fallbackError: string,
  ) {
    if (!action) return;
    setToolbarError(null);
    try {
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
      }
    } catch {
      setToolbarError(fallbackError);
    }
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

  return {
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
  };
}
