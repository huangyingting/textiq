"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ConflictRecoveryDialog } from "@/components/presentation/conflict-recovery-dialog";
import { SlideEditor } from "@/components/presentation/slide-editor";
import { Button } from "@/components/ui";
import { actionError, actionOk, type ActionResult } from "@/lib/action-result";
import { isEffectivelyEmptyEditorState } from "@/lib/ai/empty-content";
import { collectDocumentBlocks } from "@/lib/content/document-blocks";
import type { DocumentBlock } from "@/lib/content/document-blocks";
import type { ShareSettings } from "@/lib/document/persistence-types";
import type { SaveDeckResult } from "@/lib/document/persistence-types";
import {
  buildDocumentShareUrl,
  toPresentShareUrl,
} from "@/lib/document/share-routes";
import { hashDocumentBlock } from "@/lib/presentation/document-block-hash";
import {
  SAVE_STATUS_LABEL,
  resolveSaveErrorMessage,
  resolveSaveStatus,
  type SaveStatus,
} from "@/lib/presentation/save-status";
import {
  createSlideAutosaveScheduler,
  type SlideAutosaveScheduler,
} from "@/lib/presentation/slide-autosave-scheduler";
import { DEFAULT_THEME_PACKAGE_ID } from "@/lib/presentation/theme-package-ids";
import { buildSourceBlockIndex } from "@/lib/presentation/block-index";
import {
  CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
  reloadConflictServerDeck,
} from "@/lib/presentation/conflict-recovery-reload";
import { deriveDeckFromDocumentContent } from "@/lib/presentation/deck-derivation";
import { pickUndoFocusTarget } from "@/lib/presentation/deck-diff";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import { createBlankDeck } from "@/lib/presentation/empty-deck";
import { decideDeckOpen } from "@/lib/presentation/open-deck";
import { exportDeckAsPPTX } from "@/lib/presentation/pptx-apply";
import { exportDeckRasterBrowser } from "@/lib/presentation/raster-browser-export";
import type { Deck } from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import {
  SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE,
  hasUnresolvedDeckSaveConflict,
  updateConflictLocalDeck,
  type SlideEditorConflictState,
} from "@/lib/presentation/slide-editor-collaboration-state";
import { resolveThemePackageForDeck } from "@/lib/presentation/theme-package-registry";
import { downloadBlob } from "@/lib/visual/export";

import { fetchDeckJson, saveDeckJson, toggleDocumentSharing } from "../actions";
import { uploadSlideAsset } from "../slide-asset-actions";
import { persistDeckWithRecovery } from "@/components/editor/use-slide-editor-open";

type SlideEditorShareState = Pick<
  ShareSettings,
  "isShared" | "shareId" | "slug" | "presentEnabled"
>;

type SlideRouteOpenState =
  | {
      ok: true;
      deck: Deck;
      diagnostics: PresentationDiagnostic[];
    }
  | {
      ok: false;
      error: string;
      diagnostics: PresentationDiagnostic[];
      validationErrors?: string[];
    };

export interface SlideEditorRouteClientProps {
  documentId: string;
  documentTitle: string;
  initialDeckJson: unknown;
  initialDeckRevisionToken: string | null;
  initialContentJson: string | null;
  initialIsShared: boolean;
  initialShareId: string | null;
  initialSlug: string | null;
  initialSharePresentEnabled: boolean;
  canManage: boolean;
  userId: string;
  userName: string;
  customThemePackages?: ThemePackageV1[];
}

function openInitialDeck({
  documentId,
  initialDeckJson,
  initialContentJson,
}: {
  documentId: string;
  initialDeckJson: unknown;
  initialContentJson: string | null;
}): SlideRouteOpenState {
  const decision = decideDeckOpen(initialDeckJson ?? null);
  if (decision.mode === "open") {
    return { ok: true, deck: decision.deck, diagnostics: decision.diagnostics };
  }
  if (decision.mode === "recovery") {
    return {
      ok: false,
      error: decision.error,
      diagnostics: decision.diagnostics,
      validationErrors: decision.errors,
    };
  }
  if (
    initialContentJson &&
    !isEffectivelyEmptyEditorState(initialContentJson)
  ) {
    const derived = deriveDeckFromDocumentContent({
      contentJson: initialContentJson,
      documentId,
      themePackageId: DEFAULT_THEME_PACKAGE_ID,
    });
    if (derived.ok) {
      return { ok: true, deck: derived.deck, diagnostics: derived.diagnostics };
    }
    return {
      ok: false,
      error: derived.error,
      diagnostics: derived.diagnostics,
      validationErrors: derived.validationErrors,
    };
  }
  return { ok: true, deck: createBlankDeck({ documentId }), diagnostics: [] };
}

function SlideRouteRecovery({
  error,
  diagnostics,
  validationErrors,
  onBack,
}: {
  error: string;
  diagnostics: readonly PresentationDiagnostic[];
  validationErrors?: readonly string[];
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-ds-surface">
      <header className="flex shrink-0 items-center justify-between border-b border-ds-border-subtle bg-ds-surface-chrome px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-ds-text-primary">
            Slides could not be opened
          </h1>
          <p className="mt-0.5 text-xs text-ds-text-muted">
            The saved deck data needs repair before editing.
          </p>
        </div>
        <Button variant="subtle" size="sm" onClick={onBack}>
          Back to document
        </Button>
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

export function SlideEditorRouteClient({
  documentId,
  documentTitle,
  initialDeckJson,
  initialDeckRevisionToken,
  initialContentJson,
  initialIsShared,
  initialShareId,
  initialSlug,
  initialSharePresentEnabled,
  canManage,
  userId,
  userName,
  customThemePackages = [],
}: SlideEditorRouteClientProps) {
  const router = useRouter();
  const initialOpenState = useMemo(
    () => openInitialDeck({ documentId, initialDeckJson, initialContentJson }),
    [documentId, initialContentJson, initialDeckJson],
  );
  const [deck, setDeck] = useState<Deck | null>(
    initialOpenState.ok ? initialOpenState.deck : null,
  );
  const [openError, setOpenError] = useState<Extract<
    SlideRouteOpenState,
    { ok: false }
  > | null>(initialOpenState.ok ? null : initialOpenState);
  const [deckDiagnostics, setDeckDiagnostics] = useState<
    PresentationDiagnostic[]
  >(
    initialOpenState.ok
      ? initialOpenState.diagnostics
      : initialOpenState.diagnostics,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<Deck[]>([]);
  const [redoStack, setRedoStack] = useState<Deck[]>([]);
  const [undoRedoFocus, setUndoRedoFocus] = useState<{
    nodeId: string;
    token: number;
  } | null>(null);
  const [conflictState, setConflictState] =
    useState<SlideEditorConflictState | null>(null);
  const [shareState, setShareState] = useState<SlideEditorShareState>({
    isShared: initialIsShared,
    shareId: initialShareId,
    slug: initialSlug,
    presentEnabled: initialSharePresentEnabled,
  });
  const [visualPickerOpen, setVisualPickerOpen] = useState(false);
  const visualPickerResolverRef = useRef<
    ((value: { visualId?: string; alt?: string } | undefined) => void) | null
  >(null);
  const revisionTokenRef = useRef<string | null>(initialDeckRevisionToken);
  const lastSavedRef = useRef<unknown>(initialDeckJson);
  const noopAiAppliedDeckRef = useRef<Deck | null>(null);
  const focusTokenRef = useRef(0);
  const autosaveSchedulerRef = useRef<SlideAutosaveScheduler<Deck> | null>(
    null,
  );
  const deckPort = useMemo(() => ({ fetchDeckJson, saveDeckJson }), []);
  const documentBlocks = useMemo(
    () => collectDocumentBlocks(initialContentJson),
    [initialContentJson],
  );
  const sourceBlockIndex = useMemo(
    () => buildSourceBlockIndex(documentId, documentBlocks),
    [documentBlocks, documentId],
  );
  const visualBlocks = useMemo(
    () =>
      documentBlocks.filter(
        (block): block is Extract<DocumentBlock, { kind: "visual" }> =>
          block.kind === "visual",
      ),
    [documentBlocks],
  );

  const persistDeck = useCallback(
    (updatedDeck: Deck) =>
      persistDeckWithRecovery({
        updatedDeck,
        documentId,
        deckPort,
        revisionTokenRef,
        lastSavedRef,
        aiAppliedDeckRef: noopAiAppliedDeckRef,
        setDirty: setDirty,
        setSaving: setSaving,
        setSaveError: setSaveError,
        setConflictState: setConflictState,
        onAiDeckSaved: () => undefined,
      }),
    [deckPort, documentId],
  );

  useEffect(() => {
    const scheduler = createSlideAutosaveScheduler<Deck>({
      onDue: (updatedDeck) => {
        void persistDeck(updatedDeck);
      },
    });
    autosaveSchedulerRef.current = scheduler;
    return () => {
      scheduler.cancel();
      if (autosaveSchedulerRef.current === scheduler) {
        autosaveSchedulerRef.current = null;
      }
    };
  }, [persistDeck]);

  const themeResolution = deck
    ? resolveThemePackageForDeck(deck, { customPackages: customThemePackages })
    : null;
  const editorDiagnostics = [
    ...deckDiagnostics,
    ...(themeResolution?.diagnostics ?? []),
  ];
  const saveStatus: SaveStatus = resolveSaveStatus({
    isDirty: dirty,
    isSaving: saving,
    hasError: saveError !== null,
  });
  const documentHref = `/app/documents/${documentId}`;

  function goBackToDocument() {
    router.push(documentHref);
  }

  function scheduleAutosave(updatedDeck: Deck) {
    autosaveSchedulerRef.current?.schedule(updatedDeck);
  }

  function setNextDeck(
    updatedDeck: Deck,
    options: { persistNow?: boolean } = {},
  ) {
    setDeck((current) => {
      if (current) {
        setUndoStack((stack) => [...stack, current].slice(-50));
      }
      return updatedDeck;
    });
    setRedoStack([]);
    setDirty(true);
    setSaveError(null);
    if (options.persistNow) {
      void persistDeck(updatedDeck);
    } else {
      scheduleAutosave(updatedDeck);
    }
  }

  function handleDeckChange(updatedDeck: Deck) {
    if (hasUnresolvedDeckSaveConflict(conflictState)) {
      setConflictState(updateConflictLocalDeck(conflictState, updatedDeck));
      setDeck(updatedDeck);
      setDirty(true);
      setSaveError(SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE);
      return;
    }
    setNextDeck(updatedDeck);
  }

  async function handleSave(updatedDeck: Deck): Promise<ActionResult> {
    autosaveSchedulerRef.current?.cancel();
    return await persistDeck(updatedDeck);
  }

  async function handleRegenerate(): Promise<ActionResult> {
    if (hasUnresolvedDeckSaveConflict(conflictState)) {
      return actionError(
        "Resolve the save conflict before regenerating slides.",
      );
    }
    if (
      !initialContentJson ||
      isEffectivelyEmptyEditorState(initialContentJson)
    ) {
      const blankDeck = createBlankDeck({ documentId });
      setNextDeck(blankDeck, { persistNow: true });
      setDeckDiagnostics([]);
      return actionOk();
    }
    const derived = deriveDeckFromDocumentContent({
      contentJson: initialContentJson,
      documentId,
      themePackageId: deck?.theme.packageId ?? DEFAULT_THEME_PACKAGE_ID,
    });
    if (!derived.ok) {
      return actionError(derived.error);
    }
    setDeckDiagnostics(derived.diagnostics);
    setNextDeck(derived.deck, { persistNow: true });
    return actionOk();
  }

  function handleUndo() {
    if (hasUnresolvedDeckSaveConflict(conflictState)) return;
    setUndoStack((stack) => {
      const previous = stack.at(-1);
      if (!previous || !deck) return stack;
      setRedoStack((redo) => [...redo, deck].slice(-50));
      const focusTarget = pickUndoFocusTarget(deck, previous);
      if (focusTarget) {
        focusTokenRef.current += 1;
        setUndoRedoFocus({ nodeId: focusTarget, token: focusTokenRef.current });
      }
      setDeck(previous);
      setDirty(true);
      setSaveError(null);
      scheduleAutosave(previous);
      return stack.slice(0, -1);
    });
  }

  function handleRedo() {
    if (hasUnresolvedDeckSaveConflict(conflictState)) return;
    setRedoStack((stack) => {
      const next = stack.at(-1);
      if (!next || !deck) return stack;
      setUndoStack((undo) => [...undo, deck].slice(-50));
      const focusTarget = pickUndoFocusTarget(deck, next);
      if (focusTarget) {
        focusTokenRef.current += 1;
        setUndoRedoFocus({ nodeId: focusTarget, token: focusTokenRef.current });
      }
      setDeck(next);
      setDirty(true);
      setSaveError(null);
      scheduleAutosave(next);
      return stack.slice(0, -1);
    });
  }

  async function handleConflictKeepMine(
    localDeck: Deck,
    serverToken: string | null,
  ) {
    const result: SaveDeckResult = await saveDeckJson(
      documentId,
      localDeck,
      serverToken,
    );
    if (result.ok === true) {
      lastSavedRef.current = localDeck;
      revisionTokenRef.current = result.revisionToken;
      setConflictState(null);
      setDirty(false);
      setSaving(false);
      setSaveError(null);
      return;
    }
    if (result.ok === "conflict") {
      setConflictState({
        localDeck,
        serverRevisionToken: result.serverRevisionToken,
      });
      throw new Error("Still conflicted - try again.");
    }
    throw new Error(result.error);
  }

  async function handleConflictUseTheirs() {
    const reload = await reloadConflictServerDeck({ deckPort, documentId });
    if (!reload.ok) {
      setSaveError(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE);
      throw new Error(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE);
    }
    revisionTokenRef.current = reload.revisionToken;
    lastSavedRef.current = reload.deckJson;
    setDeck(reload.deck);
    setDeckDiagnostics(reload.diagnostics);
    setOpenError(null);
    setDirty(false);
    setSaving(false);
    setSaveError(null);
    setUndoStack([]);
    setRedoStack([]);
    setUndoRedoFocus(null);
    setConflictState(null);
  }

  async function handleUploadImage(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadSlideAsset(documentId, formData);
    if (!result.ok) throw new Error(result.error);
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
  }

  async function handleExportPptx() {
    if (!deck) return;
    const blob = await exportDeckAsPPTX(
      deck,
      themeResolution?.package ?? resolveThemePackageForDeck(deck).package,
    );
    if (!blob) throw new Error("PPTX export returned empty result");
    downloadBlob(blob, `${documentTitle || "presentation"}.pptx`);
  }

  async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    return fetch(dataUrl).then((response) => response.blob());
  }

  async function handleExportPdf() {
    if (!deck) return;
    const result = await exportDeckRasterBrowser(
      deck,
      themeResolution?.package ?? resolveThemePackageForDeck(deck).package,
    );
    downloadBlob(result.pdfBlob, `${documentTitle || "presentation"}.pdf`);
  }

  async function handleExportPng() {
    if (!deck) return;
    const result = await exportDeckRasterBrowser(
      deck,
      themeResolution?.package ?? resolveThemePackageForDeck(deck).package,
    );
    const baseName = documentTitle || "presentation";
    for (const [index, png] of result.pngs.entries()) {
      downloadBlob(
        await dataUrlToBlob(png.dataUrl),
        `${baseName}-slide-${String(index + 1).padStart(2, "0")}.png`,
      );
    }
  }

  async function ensureShareState(): Promise<
    ActionResult<SlideEditorShareState>
  > {
    if (shareState.isShared && shareState.shareId && shareState.slug) {
      return actionOk(shareState);
    }
    if (!canManage) {
      return actionError(
        "Enable sharing from the document toolbar before using this action.",
      );
    }
    const result = await toggleDocumentSharing(documentId, true);
    if (!result.ok) return actionError(result.error);
    const nextState: SlideEditorShareState = {
      isShared: result.data.isShared,
      shareId: result.data.shareId,
      slug: result.data.slug,
      presentEnabled: result.data.presentEnabled,
    };
    setShareState(nextState);
    return actionOk(nextState);
  }

  function openPublicRoute(url: string): ActionResult {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      return actionError("Allow pop-ups to open share links from the editor.");
    }
    return actionOk();
  }

  async function handleShare(): Promise<ActionResult> {
    const result = await ensureShareState();
    if (!result.ok) return actionError(result.error);
    const shareUrl = buildDocumentShareUrl(
      window.location.origin,
      result.data.shareId,
      result.data.slug,
    );
    if (!shareUrl)
      return actionError("Share link is unavailable. Please try again.");
    return openPublicRoute(shareUrl);
  }

  async function handlePresent(): Promise<ActionResult> {
    const result = await ensureShareState();
    if (!result.ok) return actionError(result.error);
    if (!result.data.presentEnabled) {
      return actionError(
        "Presentation links are disabled in share settings for this document.",
      );
    }
    const shareUrl = buildDocumentShareUrl(
      window.location.origin,
      result.data.shareId,
      result.data.slug,
    );
    if (!shareUrl) {
      return actionError("Presentation link is unavailable. Please try again.");
    }
    return openPublicRoute(toPresentShareUrl(shareUrl));
  }

  async function handleRefreshSource({
    node,
    source,
  }: Parameters<
    NonNullable<Parameters<typeof SlideEditor>[0]["onRefreshSource"]>
  >[0]) {
    if (!initialContentJson || source.documentId !== documentId)
      return undefined;
    const block = documentBlocks.find(
      (candidate) =>
        ("blockId" in candidate && candidate.blockId === source.blockId) ||
        (candidate.kind === "visual" && candidate.visualId === source.blockId),
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
    if (block.kind === "text" && node.type === "text") {
      return {
        contentPatch: {
          paragraphs: [
            {
              id: `${node.id}-source-p-1`,
              text: block.text,
              ...(block.runs && block.runs.length > 0
                ? { runs: block.runs }
                : {}),
            },
          ],
        },
        source: { ...refreshedSource, blockKind: "text" as const },
      };
    }
    return { source: refreshedSource };
  }

  async function handlePickVisual() {
    if (visualBlocks.length === 0) return undefined;
    return await new Promise<{ visualId?: string; alt?: string } | undefined>(
      (resolve) => {
        visualPickerResolverRef.current = resolve;
        setVisualPickerOpen(true);
      },
    );
  }

  function resolveVisualPicker(
    value: { visualId?: string; alt?: string } | undefined,
  ) {
    visualPickerResolverRef.current?.(value);
    visualPickerResolverRef.current = null;
    setVisualPickerOpen(false);
  }

  if (openError) {
    return (
      <main className="fixed inset-0 overflow-hidden bg-ds-surface">
        <SlideRouteRecovery
          error={openError.error}
          diagnostics={openError.diagnostics}
          validationErrors={openError.validationErrors}
          onBack={goBackToDocument}
        />
      </main>
    );
  }

  if (!deck) {
    return (
      <main className="fixed inset-0 flex items-center justify-center overflow-hidden bg-ds-surface text-sm text-ds-text-secondary">
        Loading slides…
      </main>
    );
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-ds-surface">
      <SlideEditor
        documentId={documentId}
        deck={deck}
        themePackage={themeResolution?.package}
        diagnostics={editorDiagnostics}
        saveStatus={saveStatus}
        saveStatusLabel={SAVE_STATUS_LABEL[saveStatus]}
        saveErrorMessage={resolveSaveErrorMessage(saveError)}
        hasUnsavedWork={dirty || saving || saveError !== null}
        canUndo={
          !hasUnresolvedDeckSaveConflict(conflictState) && undoStack.length > 0
        }
        canRedo={
          !hasUnresolvedDeckSaveConflict(conflictState) && redoStack.length > 0
        }
        onUndo={handleUndo}
        onRedo={handleRedo}
        undoRedoFocus={undoRedoFocus}
        onDeckChange={handleDeckChange}
        onSave={handleSave}
        onRegenerate={handleRegenerate}
        onClose={goBackToDocument}
        onUploadImage={handleUploadImage}
        onPickVisual={handlePickVisual}
        documentBlocks={documentBlocks}
        sourceBlockIndex={sourceBlockIndex}
        onRefreshSource={handleRefreshSource}
        onExportPptx={handleExportPptx}
        onExportPdf={handleExportPdf}
        onExportPng={handleExportPng}
        onPresent={handlePresent}
        onShare={handleShare}
        presenceAwareness={null}
        presenceUserId={userId}
        presenceUserName={userName}
      />

      {visualPickerOpen ? (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/35"
            onClick={() => resolveVisualPicker(undefined)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Choose visual"
            className="relative w-full max-w-md rounded-ds-md border border-ds-border-subtle bg-ds-surface p-4 shadow-ds-overlay"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ds-text-primary">
                Replace visual
              </h2>
              <button
                type="button"
                onClick={() => resolveVisualPicker(undefined)}
                className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
              >
                Cancel
              </button>
            </div>
            <div className="mt-3 flex max-h-80 flex-col gap-1 overflow-auto">
              {visualBlocks.map((block) => (
                <button
                  key={block.visualId}
                  type="button"
                  onClick={() =>
                    resolveVisualPicker({
                      visualId: block.visualId,
                      ...(block.visual.title
                        ? { alt: block.visual.title }
                        : {}),
                    })
                  }
                  className="rounded-ds-sm border border-ds-border-subtle px-3 py-2 text-left text-xs text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary"
                >
                  <span className="font-mono">{block.visualId}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {conflictState ? (
        <ConflictRecoveryDialog
          open={true}
          localDeck={conflictState.localDeck}
          serverRevisionToken={conflictState.serverRevisionToken}
          onKeepMine={handleConflictKeepMine}
          onUseTheirs={handleConflictUseTheirs}
          onDismiss={() => setConflictState(null)}
        />
      ) : null}
    </main>
  );
}
