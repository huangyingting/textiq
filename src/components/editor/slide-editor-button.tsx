"use client";

/**
 * Toolbar button that opens the SlideEditor panel for the current document.
 *
 * All open/close/route state is managed by {@link useSlideEditorOpen}; this
 * component is purely presentational.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { LayoutPanelLeft } from "lucide-react";

import { ConflictRecoveryDialog } from "@/components/presentation/conflict-recovery-dialog";
import { SlideEditorOpenDialog } from "@/components/editor/slide-editor-open-dialog";
import { SlideEditor } from "@/components/presentation/slide-editor";
import { DeckGenerationPreview } from "@/components/presentation/deck-generation-preview";
import { collectDocumentBlocks } from "@/lib/content/document-blocks";
import type { DocumentBlock } from "@/lib/content/document-blocks";
import type { DeckActionPort, SlideAssetActionPort } from "@/lib/action-ports";
import type { ActionResult } from "@/lib/action-result";
import { EditorToolbarButton } from "@/components/editor/toolbar-button";
import { useSlideEditorOpen } from "@/components/editor/use-slide-editor-open";
import { resolveSlideEditorButtonView } from "@/components/editor/slide-editor-button-view";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import { buildSourceBlockIndex } from "@/lib/presentation/block-index";
import { openDeckFromJson } from "@/lib/presentation/open-deck";
import { exportDeckAsPPTX } from "@/lib/presentation/pptx-apply";
import { resolveThemePackageForDeck } from "@/lib/presentation/theme-package-registry";
import { hashDocumentBlock } from "@/lib/presentation/document-block-hash";
import { useFocusTrap } from "@/lib/a11y/use-focus-trap";
import type { SlidePresenceAwareness } from "@/lib/presentation/use-slide-presence";
import { downloadBlob } from "@/lib/visual/export";

export function SlideEditorOpenRecovery({
  error,
  diagnostics,
  validationErrors,
  onClose,
}: {
  error: string;
  diagnostics: readonly PresentationDiagnostic[];
  validationErrors?: readonly string[];
  onClose: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-ds-surface">
      <header className="flex shrink-0 items-center justify-between border-b border-ds-border-subtle bg-ds-surface-chrome px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ds-text-primary">
            Slides could not be opened
          </h2>
          <p className="mt-0.5 text-xs text-ds-text-muted">
            The saved deck data needs migration or repair before editing.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-ds-sm border border-ds-border-subtle px-3 py-1.5 text-xs font-medium text-ds-text-primary hover:bg-ds-state-hover"
        >
          Close
        </button>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        <section className="w-full max-w-2xl rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-4">
          <p className="text-sm font-medium text-ds-danger-text">{error}</p>
          {diagnostics.length > 0 ? (
            <ul className="mt-3 space-y-2 text-xs text-ds-danger-text">
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${index}`}>
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : null}
          {validationErrors && validationErrors.length > 0 ? (
            <details className="mt-3 text-xs text-ds-danger-text">
              <summary className="cursor-pointer font-medium">
                Validation details
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {validationErrors.map((message, index) => (
                  <li key={`${message}-${index}`}>{message}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function SlideEditorOverlay({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="Slide editor"
      className="fixed inset-0 z-panel bg-ds-surface"
    >
      {children}
    </div>,
    document.body,
  );
}

function SlideVisualPickerOverlay({
  options,
  onPick,
  onCancel,
}: {
  options: Extract<DocumentBlock, { kind: "visual" }>[];
  onPick: (value: { visualId: string; alt?: string }) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useFocusTrap(dialogRef);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/35"
        onClick={onCancel}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Choose visual"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        className="relative w-full max-w-md rounded-ds-md border border-ds-border-subtle bg-ds-surface p-4 shadow-ds-overlay"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ds-text-primary">
            Replace visual
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
          >
            Cancel
          </button>
        </div>
        <div className="mt-3 flex max-h-80 flex-col gap-1 overflow-auto">
          {options.length > 0 ? (
            options.map((option) => (
              <button
                key={option.visualId}
                type="button"
                onClick={() =>
                  onPick({
                    visualId: option.visualId,
                    ...(option.visual.title
                      ? { alt: option.visual.title }
                      : {}),
                  })
                }
                className="rounded-ds-sm border border-ds-border-subtle px-3 py-2 text-left text-xs text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary"
              >
                <span className="font-mono">{option.visualId}</span>
              </button>
            ))
          ) : (
            <p className="text-xs text-ds-text-muted">
              No document visuals are available to choose from.
            </p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

interface SlideEditorButtonProps {
  documentId: string;
  initialDeckJson: unknown;
  deckPort: DeckActionPort;
  slideAssetPort?: SlideAssetActionPort;
  /**
   * The DB-persisted serialised Lexical state the editor seeds from. Used as a
   * non-empty fallback for AI generation when the live editor state has not
   * finished seeding yet.
   */
  initialContentJson?: string | null;
  presenceAwareness?: SlidePresenceAwareness | null;
  presenceUserId?: string;
  presenceUserName?: string;
  onOpenRightSurface?: () => void;
  onCloseRightSurface?: () => void;
  onPresentRoundtrip?: () => Promise<ActionResult>;
  onShareRoundtrip?: () => Promise<ActionResult>;
  iconOnly?: boolean;
}

export function SlideEditorButton({
  documentId,
  initialDeckJson,
  deckPort,
  slideAssetPort,
  initialContentJson = null,
  presenceAwareness = null,
  presenceUserId = "",
  presenceUserName = "Anonymous",
  onOpenRightSurface,
  onCloseRightSurface,
  onPresentRoundtrip,
  onShareRoundtrip,
  iconOnly = false,
}: SlideEditorButtonProps) {
  const {
    open,
    deck,
    deckOpenDiagnostics,
    deckOpenError,
    saveStatus,
    saveStatusLabel,
    saveErrorMessage,
    hasUnsavedWork,
    handleDeckChange,
    handleSave,
    handleUndo,
    handleRedo,
    undoRedoFocus,
    canUndo,
    canRedo,
    handleOpen,
    handleClose,
    aiEnabled,
    pendingJson,
    pendingThemePackageId,
    emptyDocument,
    handleOpenDialogApply,
    handleOpenDialogDerive,
    handleOpenDialogClose,
    aiPreview,
    handleAiPreviewApply,
    handleAiPreviewDerive,
    handleAiPreviewCancel,
    conflictState,
    handleConflictKeepMine,
    handleConflictUseTheirs,
    handleConflictDismiss,
  } = useSlideEditorOpen({
    documentId,
    initialDeckJson,
    deckPort,
    initialContentJson,
    onOpenRightSurface,
    onCloseRightSurface,
  });

  const themeResolution = deck ? resolveThemePackageForDeck(deck) : null;
  const aiPreviewThemePackage = aiPreview
    ? resolveThemePackageForDeck({
        theme: { packageId: aiPreview.themePackageId },
      }).package
    : null;
  const editorDiagnostics = [
    ...deckOpenDiagnostics,
    ...(themeResolution?.diagnostics ?? []),
  ];
  const buttonView = resolveSlideEditorButtonView({
    aiEnabled,
    pendingJson,
    aiPreview,
    open,
    deck,
    deckOpenError,
  });
  const documentBlocks = useMemo(
    () => collectDocumentBlocks(initialContentJson),
    [initialContentJson],
  );
  const sourceBlockIndex = useMemo(
    () => buildSourceBlockIndex(documentId, documentBlocks),
    [documentId, documentBlocks],
  );
  const visualBlocks = useMemo(
    () =>
      documentBlocks.filter(
        (block): block is Extract<DocumentBlock, { kind: "visual" }> =>
          block.kind === "visual",
      ),
    [documentBlocks],
  );
  const [visualPickerOpen, setVisualPickerOpen] = useState(false);
  const visualPickerResolverRef = useRef<
    ((value: { visualId?: string; alt?: string } | undefined) => void) | null
  >(null);

  const handleExportPptx = useCallback(async () => {
    if (!deck) return;
    const opened = openDeckFromJson(deck);
    if (!opened.ok) {
      throw new Error(opened.error);
    }
    const blob = await exportDeckAsPPTX(
      opened.deck,
      themeResolution?.package ??
        resolveThemePackageForDeck(opened.deck).package,
    );
    if (!blob) throw new Error("PPTX export returned empty result");
    downloadBlob(blob, "presentation.pptx");
  }, [deck, themeResolution]);

  const handleUploadImage = useCallback(
    async (file: File) => {
      if (!slideAssetPort) {
        throw new Error("Slide asset upload is not configured.");
      }
      const formData = new FormData();
      formData.append("file", file);
      const result = await slideAssetPort.uploadSlideAsset(
        documentId,
        formData,
      );
      if (!result.ok) {
        throw new Error(result.error);
      }
      return {
        src: result.data.url,
        assetId: result.data.assetId,
        ...(result.data.widthPx !== undefined
          ? { widthPx: result.data.widthPx }
          : {}),
        ...(result.data.heightPx !== undefined
          ? { heightPx: result.data.heightPx }
          : {}),
        ...(result.data.mimeType !== undefined
          ? { mimeType: result.data.mimeType }
          : {}),
        ...(result.data.contentHash !== undefined
          ? { contentHash: result.data.contentHash }
          : {}),
      };
    },
    [documentId, slideAssetPort],
  );

  const handleRefreshSource = useCallback(
    async ({
      node,
      source,
    }: Parameters<
      NonNullable<Parameters<typeof SlideEditor>[0]["onRefreshSource"]>
    >[0]) => {
      if (!initialContentJson || source.documentId !== documentId)
        return undefined;
      const block = documentBlocks.find(
        (candidate) =>
          ("blockId" in candidate && candidate.blockId === source.blockId) ||
          (candidate.kind === "visual" &&
            candidate.visualId === source.blockId),
      );
      if (!block) return undefined;
      const refreshedSource = {
        ...source,
        contentHash: hashDocumentBlock(block),
        linkedAt: new Date().toISOString(),
        unlinked: false,
      };

      if (block.kind === "visual" && node.type === "visual") {
        return {
          contentPatch: { visualId: block.visualId },
          source: { ...refreshedSource, blockKind: "visual" as const },
        };
      }
      if (block.kind === "table" && node.type === "table") {
        return {
          contentPatch: {
            columns: block.columns,
            rows: block.rows,
            ...(block.caption ? { caption: block.caption } : {}),
          },
          source: { ...refreshedSource, blockKind: "table" as const },
        };
      }
      if (block.kind === "text") {
        const paragraph = {
          id: `${node.id}-source-p-1`,
          text: block.text,
          ...(block.runs && block.runs.length > 0 ? { runs: block.runs } : {}),
        };
        if (node.type === "text") {
          return {
            contentPatch: { paragraphs: [paragraph] },
            source: { ...refreshedSource, blockKind: "text" as const },
          };
        }
        if (node.type === "shape") {
          return {
            contentPatch: { text: { paragraphs: [paragraph] } },
            source: { ...refreshedSource, blockKind: "text" as const },
          };
        }
      }
      return { source: refreshedSource };
    },
    [documentBlocks, documentId, initialContentJson],
  );

  const handlePickVisual = useCallback(async () => {
    if (visualBlocks.length === 0) return undefined;
    return await new Promise<{ visualId?: string; alt?: string } | undefined>(
      (resolve) => {
        visualPickerResolverRef.current = resolve;
        setVisualPickerOpen(true);
      },
    );
  }, [visualBlocks.length]);

  function resolveVisualPicker(
    value: { visualId?: string; alt?: string } | undefined,
  ) {
    visualPickerResolverRef.current?.(value);
    visualPickerResolverRef.current = null;
    setVisualPickerOpen(false);
  }

  return (
    <>
      <EditorToolbarButton
        label="Slides"
        tooltip="Edit slides"
        icon={<LayoutPanelLeft size={15} aria-hidden="true" />}
        iconOnly={iconOnly}
        onClick={handleOpen}
        aria-label="Open slide editor"
      />

      {buttonView.showOpenDialog && pendingJson ? (
        <SlideEditorOpenDialog
          contentJson={pendingJson}
          themePackageId={pendingThemePackageId}
          isEmptyDocument={emptyDocument}
          onApply={handleOpenDialogApply}
          onDerive={handleOpenDialogDerive}
          onClose={handleOpenDialogClose}
        />
      ) : null}

      {buttonView.showAiPreview && aiPreview ? (
        <DeckGenerationPreview
          proposedDeck={aiPreview.proposedDeck}
          baselineDeck={aiPreview.baselineDeck}
          truncated={aiPreview.truncated}
          generationDiagnostics={aiPreview.generationDiagnostics}
          contentJson={aiPreview.contentJson}
          options={aiPreview.options}
          themePackageId={aiPreview.themePackageId}
          themePackage={aiPreviewThemePackage}
          onApply={handleAiPreviewApply}
          onDerive={handleAiPreviewDerive}
          onCancel={handleAiPreviewCancel}
        />
      ) : null}

      {buttonView.showEditor && deck ? (
        <SlideEditorOverlay>
          <SlideEditor
            documentId={documentId}
            deck={deck}
            themePackage={themeResolution?.package}
            diagnostics={editorDiagnostics}
            saveStatus={saveStatus}
            saveStatusLabel={saveStatusLabel}
            saveErrorMessage={saveErrorMessage}
            hasUnsavedWork={hasUnsavedWork}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            undoRedoFocus={undoRedoFocus}
            onDeckChange={handleDeckChange}
            onUploadImage={slideAssetPort ? handleUploadImage : undefined}
            onPickVisual={handlePickVisual}
            documentBlocks={documentBlocks}
            sourceBlockIndex={sourceBlockIndex}
            onRefreshSource={handleRefreshSource}
            onSave={handleSave}
            onClose={handleClose}
            onExportPptx={handleExportPptx}
            onPresent={onPresentRoundtrip}
            onShare={onShareRoundtrip}
            presenceAwareness={presenceAwareness}
            presenceUserId={presenceUserId}
            presenceUserName={presenceUserName}
          />
        </SlideEditorOverlay>
      ) : null}

      {buttonView.showRecovery && deckOpenError ? (
        <SlideEditorOverlay>
          <SlideEditorOpenRecovery
            error={deckOpenError.error}
            diagnostics={deckOpenError.diagnostics}
            validationErrors={deckOpenError.validationErrors}
            onClose={handleClose}
          />
        </SlideEditorOverlay>
      ) : null}

      {conflictState ? (
        <ConflictRecoveryDialog
          open={true}
          localDeck={conflictState.localDeck}
          serverRevisionToken={conflictState.serverRevisionToken}
          onKeepMine={handleConflictKeepMine}
          onUseTheirs={handleConflictUseTheirs}
          onDismiss={handleConflictDismiss}
        />
      ) : null}

      {visualPickerOpen ? (
        <SlideVisualPickerOverlay
          options={visualBlocks}
          onPick={(value) => resolveVisualPicker(value)}
          onCancel={() => resolveVisualPicker(undefined)}
        />
      ) : null}
    </>
  );
}
