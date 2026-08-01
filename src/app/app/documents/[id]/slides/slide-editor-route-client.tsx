"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ConflictRecoveryDialog } from "@/components/presentation/conflict-recovery-dialog";
import { SlideEditor } from "@/components/presentation/slide-editor";
import {
  createPendingVisualPickerRequest,
  settlePendingVisualPickerRequest,
  type PendingVisualPickerRequest,
} from "@/components/presentation/visual-picker-request";
import { Button } from "@/components/ui";
import type {
  BrandKitSavePort,
  SaveBrandKitDraftResult,
} from "@/lib/action-ports";
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
  createSlideSaveController,
  type SlideSaveController,
} from "@/lib/presentation/slide-save-controller";
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
  mergeThemePackageCatalogEntries,
  resolveThemePackageForDeck,
  type ThemePackageCatalogEntry,
} from "@/lib/presentation/theme-package-registry";
import { useFocusTrap } from "@/lib/a11y/use-focus-trap";
import {
  SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE,
  hasUnresolvedDeckSaveConflict,
  updateConflictLocalDeck,
  type SlideEditorConflictState,
} from "@/lib/presentation/slide-editor-collaboration-state";
import { downloadBlob } from "@/lib/visual/export";
import { structuredJsonEqual } from "@/lib/structured-json";

import { fetchDeckJson, saveDeckJson, toggleDocumentSharing } from "../actions";
import { requestSlideEditorReturnFocus } from "../slide-editor-return-focus";
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

type VisualPickerValue = { visualId?: string; alt?: string };

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
  activeCustomThemePackage?: ThemePackageV1;
  customThemeCatalogEntries?: ThemePackageCatalogEntry[];
  saveBrandKitDraftAction?: BrandKitSavePort["saveBrandKitDraft"];
}

const EMPTY_THEME_CATALOG: ThemePackageCatalogEntry[] = [];

type RoutePersistenceContext = {
  active: boolean;
  revisionTokenRef: { current: string | null };
  lastSavedRef: { current: unknown };
  aiAppliedDeckRef: { current: Deck | null };
};

function VisualPickerDialog({
  visualBlocks,
  onResolve,
}: {
  visualBlocks: Extract<DocumentBlock, { kind: "visual" }>[];
  onResolve: (value: { visualId?: string; alt?: string } | undefined) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useFocusTrap(dialogRef);

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/35"
        onClick={() => onResolve(undefined)}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Choose visual"
        onKeyDown={(event) => {
          if (event.key === "Escape") onResolve(undefined);
        }}
        className="relative w-full max-w-md rounded-ds-md border border-ds-border-subtle bg-ds-surface p-4 shadow-ds-overlay"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ds-text-primary">
            Replace visual
          </h2>
          <button
            type="button"
            onClick={() => onResolve(undefined)}
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
                onResolve({
                  visualId: block.visualId,
                  ...(block.visual.title ? { alt: block.visual.title } : {}),
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
  );
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

function SlideEditorRouteClientDocument({
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
  activeCustomThemePackage,
  customThemeCatalogEntries = EMPTY_THEME_CATALOG,
  saveBrandKitDraftAction,
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
  const [customThemeCatalog, setCustomThemeCatalog] = useState<
    ThemePackageCatalogEntry[]
  >(() => customThemeCatalogEntries);
  const [activeRenderThemePackages, setActiveRenderThemePackages] = useState<
    ThemePackageV1[]
  >(() => (activeCustomThemePackage ? [activeCustomThemePackage] : []));
  const [shareState, setShareState] = useState<SlideEditorShareState>({
    isShared: initialIsShared,
    shareId: initialShareId,
    slug: initialSlug,
    presentEnabled: initialSharePresentEnabled,
  });
  const [visualPickerRequest, setVisualPickerRequest] =
    useState<PendingVisualPickerRequest<VisualPickerValue> | null>(null);
  const mountedRef = useRef(true);
  const visualPickerRequestRef =
    useRef<PendingVisualPickerRequest<VisualPickerValue> | null>(null);
  const focusTokenRef = useRef(0);
  const latestDeckRef = useRef<Deck | null>(
    initialOpenState.ok ? initialOpenState.deck : null,
  );
  const saveControllerRef = useRef<SlideSaveController<Deck> | null>(null);
  const persistenceContextRef = useRef<RoutePersistenceContext | null>(null);
  const deckPort = useMemo(() => ({ fetchDeckJson, saveDeckJson }), []);

  // Stable bootstrap for controller initialisation — captured once via the
  // lazy useState initialiser. Because SlideEditorRouteClient wraps this
  // component with key={documentId}, a different document always produces a
  // fresh mount, so these values are always correct for the current document.
  // They must NOT update when server revalidation delivers new initial props
  // during an active editing session: the live controller tracks revisionToken
  // and lastSaved internally, so re-initialising it would dispose in-flight
  // work (e.g. a debounced undo save scheduled just after the preceding write).
  const [controllerBootstrap] = useState(() => ({
    revisionToken: initialDeckRevisionToken,
    deckJson: initialDeckJson,
    openState: initialOpenState,
  }));
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const request = visualPickerRequestRef.current;
      if (request) {
        settlePendingVisualPickerRequest(
          visualPickerRequestRef,
          request,
          undefined,
        );
      }
    };
  }, []);

  useEffect(() => {
    const context: RoutePersistenceContext = {
      active: true,
      revisionTokenRef: { current: controllerBootstrap.revisionToken },
      lastSavedRef: { current: controllerBootstrap.deckJson },
      aiAppliedDeckRef: { current: null },
    };
    const controller: SlideSaveController<Deck> =
      createSlideSaveController<Deck>({
        initialPersisted:
          controllerBootstrap.deckJson !== null &&
          controllerBootstrap.openState.ok
            ? controllerBootstrap.openState.deck
            : null,
        equals: structuredJsonEqual,
        persist: (updatedDeck, isAuthoritative): Promise<ActionResult> =>
          persistDeckWithRecovery({
            updatedDeck,
            documentId,
            deckPort,
            revisionTokenRef: context.revisionTokenRef,
            lastSavedRef: context.lastSavedRef,
            aiAppliedDeckRef: context.aiAppliedDeckRef,
            setDirty: () => undefined,
            setSaving: () => undefined,
            setSaveError: () => undefined,
            setConflictState: (state) => {
              if (context.active && saveControllerRef.current === controller) {
                setConflictState(state);
              }
            },
            onAiDeckSaved: () => undefined,
            shouldApplyCompletionState: (): boolean =>
              context.active &&
              saveControllerRef.current === controller &&
              isAuthoritative(),
          }),
        onStateChange: (state) => {
          if (saveControllerRef.current !== controller) return;
          setDirty(state.dirty);
          setSaving(state.saving);
          setSaveError(state.error);
        },
      });
    saveControllerRef.current = controller;
    persistenceContextRef.current = context;
    return () => {
      context.active = false;
      controller.dispose();
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null;
      }
      if (persistenceContextRef.current === context) {
        persistenceContextRef.current = null;
      }
    };
    // controllerBootstrap is stable for the component instance lifetime
    // (useState lazy initialiser); only deckPort and documentId must
    // re-initialise the controller (port swap or key-forced remount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckPort, documentId]);

  const themeResolution = deck
    ? resolveThemePackageForDeck(deck, {
        activePackages: activeRenderThemePackages,
      })
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
    requestSlideEditorReturnFocus(documentId);
    router.push(documentHref);
  }

  function scheduleAutosave(updatedDeck: Deck) {
    saveControllerRef.current?.schedule(updatedDeck);
  }

  function setNextDeck(
    updatedDeck: Deck,
    options: { persistNow?: boolean } = {},
  ) {
    const currentDeck = latestDeckRef.current;
    const changed =
      currentDeck === null || !structuredJsonEqual(currentDeck, updatedDeck);
    if (currentDeck && changed) {
      setUndoStack((stack) => [...stack, currentDeck].slice(-50));
    }
    if (changed) {
      setRedoStack([]);
    }
    setDeck(updatedDeck);
    latestDeckRef.current = updatedDeck;
    if (options.persistNow) {
      void saveControllerRef.current?.replaceAndPersist(updatedDeck);
    } else {
      scheduleAutosave(updatedDeck);
    }
  }

  function activateCatalogThemePackage(updatedDeck: Deck) {
    const selectedCustomPackage = customThemeCatalog.find(
      (entry) =>
        entry.package.id === updatedDeck.theme.packageId &&
        entry.package.version === updatedDeck.theme.packageVersion,
    )?.package;
    if (!selectedCustomPackage) return;

    setActiveRenderThemePackages((current) =>
      current.some(
        (themePackage) =>
          themePackage.id === selectedCustomPackage.id &&
          themePackage.version === selectedCustomPackage.version,
      )
        ? current
        : [...current, selectedCustomPackage],
    );
  }

  function handleDeckChange(updatedDeck: Deck) {
    if (
      deck?.theme.packageId !== updatedDeck.theme.packageId ||
      deck.theme.packageVersion !== updatedDeck.theme.packageVersion
    ) {
      activateCatalogThemePackage(updatedDeck);
    }
    if (hasUnresolvedDeckSaveConflict(conflictState)) {
      setConflictState(updateConflictLocalDeck(conflictState, updatedDeck));
      setDeck(updatedDeck);
      latestDeckRef.current = updatedDeck;
      setDirty(true);
      setSaveError(SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE);
      return;
    }
    setNextDeck(updatedDeck);
  }

  function handleBrandKitSaved(
    result: Extract<SaveBrandKitDraftResult, { ok: true }>,
  ) {
    setCustomThemeCatalog((current) =>
      mergeThemePackageCatalogEntries([...current, result.catalogEntry]),
    );
  }

  async function handleSave(updatedDeck: Deck): Promise<ActionResult> {
    return (await saveControllerRef.current?.flush(updatedDeck)) ?? actionOk();
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
    const previous = undoStack.at(-1);
    if (!previous || !deck) return;
    setRedoStack((redo) => [...redo, deck].slice(-50));
    setUndoStack((stack) => stack.slice(0, -1));
    const focusTarget = pickUndoFocusTarget(deck, previous);
    if (focusTarget) {
      focusTokenRef.current += 1;
      setUndoRedoFocus({ nodeId: focusTarget, token: focusTokenRef.current });
    }
    setDeck(previous);
    latestDeckRef.current = previous;
    scheduleAutosave(previous);
  }

  function handleRedo() {
    if (hasUnresolvedDeckSaveConflict(conflictState)) return;
    const next = redoStack.at(-1);
    if (!next || !deck) return;
    setUndoStack((undo) => [...undo, deck].slice(-50));
    setRedoStack((stack) => stack.slice(0, -1));
    const focusTarget = pickUndoFocusTarget(deck, next);
    if (focusTarget) {
      focusTokenRef.current += 1;
      setUndoRedoFocus({ nodeId: focusTarget, token: focusTokenRef.current });
    }
    setDeck(next);
    latestDeckRef.current = next;
    scheduleAutosave(next);
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
    if (!mountedRef.current) return;
    if (result.ok === true) {
      const context = persistenceContextRef.current;
      if (context) {
        context.lastSavedRef.current = localDeck;
        context.revisionTokenRef.current = result.revisionToken;
      }
      latestDeckRef.current = localDeck;
      saveControllerRef.current?.adoptPersisted(localDeck);
      setConflictState(null);
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
    saveControllerRef.current?.cancelScheduled();
    const reload = await reloadConflictServerDeck({ deckPort, documentId });
    if (!mountedRef.current) return;
    if (!reload.ok) {
      setSaveError(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE);
      throw new Error(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE);
    }
    const context = persistenceContextRef.current;
    if (context) {
      context.revisionTokenRef.current = reload.revisionToken;
      context.lastSavedRef.current = reload.deckJson;
    }
    latestDeckRef.current = reload.deck;
    saveControllerRef.current?.adoptPersisted(reload.deck);
    setActiveRenderThemePackages(
      reload.activeCustomThemePackage ? [reload.activeCustomThemePackage] : [],
    );
    setDeck(reload.deck);
    setDeckDiagnostics(reload.diagnostics);
    setOpenError(null);
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
    if (!mountedRef.current) return;
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
    if (!mountedRef.current) return;
    downloadBlob(result.pdfBlob, `${documentTitle || "presentation"}.pdf`);
  }

  async function handleExportPng() {
    if (!deck) return;
    const result = await exportDeckRasterBrowser(
      deck,
      themeResolution?.package ?? resolveThemePackageForDeck(deck).package,
    );
    if (!mountedRef.current) return;
    const baseName = documentTitle || "presentation";
    for (const [index, png] of result.pngs.entries()) {
      const blob = await dataUrlToBlob(png.dataUrl);
      if (!mountedRef.current) return;
      downloadBlob(
        blob,
        `${baseName}-slide-${String(index + 1).padStart(2, "0")}.png`,
      );
    }
  }

  async function ensureShareState(): Promise<
    ActionResult<SlideEditorShareState>
  > {
    if (!mountedRef.current) {
      return actionError("The slide editor is no longer open.");
    }
    if (shareState.isShared && shareState.shareId && shareState.slug) {
      return actionOk(shareState);
    }
    if (!canManage) {
      return actionError(
        "Enable sharing from the document toolbar before using this action.",
      );
    }
    const result = await toggleDocumentSharing(documentId, true);
    if (!mountedRef.current) {
      return actionError("The slide editor is no longer open.");
    }
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
    if (!mountedRef.current) {
      return actionError("The slide editor is no longer open.");
    }
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
    if (!mountedRef.current) {
      return actionError("The slide editor is no longer open.");
    }
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
    const pendingRequest = visualPickerRequestRef.current;
    if (pendingRequest) return await pendingRequest.promise;
    const request = createPendingVisualPickerRequest<VisualPickerValue>();
    visualPickerRequestRef.current = request;
    setVisualPickerRequest(request);
    return await request.promise;
  }

  function resolveVisualPicker(
    request: PendingVisualPickerRequest<VisualPickerValue>,
    value: VisualPickerValue | undefined,
  ) {
    if (
      !settlePendingVisualPickerRequest(visualPickerRequestRef, request, value)
    ) {
      return;
    }
    setVisualPickerRequest((current) => (current === request ? null : current));
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
        customThemeCatalogEntries={customThemeCatalog}
        brandKitOwnerId={userId}
        saveBrandKitDraft={saveBrandKitDraftAction}
        onBrandKitSaved={handleBrandKitSaved}
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

      {visualPickerRequest ? (
        <VisualPickerDialog
          visualBlocks={visualBlocks}
          onResolve={(value) => resolveVisualPicker(visualPickerRequest, value)}
        />
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

export function SlideEditorRouteClient(props: SlideEditorRouteClientProps) {
  return <SlideEditorRouteClientDocument key={props.documentId} {...props} />;
}
