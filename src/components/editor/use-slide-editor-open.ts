"use client";

/**
 * Open/close/route state controller for the presentation-only slide editor entry point.
 *
 * Development builds support only Deck at runtime. Legacy deck JSON is not
 * migrated here; when no saved presentation deck is available, the editor derives a deck
 * from the current document content and only falls back to a native blank Deck
 * for genuinely empty documents.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DeckActionPort } from "@/lib/action-ports";
import { actionOk, type ActionResult } from "@/lib/action-result";
import type { SaveDeckResult } from "@/lib/document/persistence-types";
import { isAiDeckGenClientEnabled } from "@/lib/ai/ai-deck-gen-flag";
import { isEffectivelyEmptyEditorState } from "@/lib/ai/empty-content";
import type { DeckGenerationOptions } from "@/lib/ai/use-deck-generation";
import { logInfo } from "@/lib/log";
import {
  DEFAULT_THEME_PACKAGE_ID,
  resolveBuiltInThemePackageId,
  type ThemePackageId,
} from "@/lib/presentation/theme-package-ids";
import {
  SAVE_STATUS_LABEL,
  resolveSaveErrorMessage,
  resolveSaveStatus,
  type SaveStatus,
} from "@/lib/presentation/save-status";
import {
  createBrowserLocalStorageSaveQueueStorage,
  createResilientLatestSnapshotQueue,
  type ResilientLatestSnapshotQueue,
  type SaveQueueSaveResult,
  type SaveQueueStatus,
} from "@/lib/presentation/resilient-autosave-queue";
import { bucketCount, emitProductTelemetry } from "@/lib/telemetry/product";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import { createBlankDeck } from "@/lib/presentation/empty-deck";
import {
  CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
  reloadConflictServerDeck,
} from "@/lib/presentation/conflict-recovery-reload";
import { openAiGeneratedDeck } from "@/lib/presentation/open-deck";
import { deriveDeckFromDocumentContent } from "@/lib/presentation/deck-derivation";
import { pickUndoFocusTarget } from "@/lib/presentation/deck-diff";
import {
  prepareDeckForOpen,
  type PreparedDeckForOpen,
} from "@/lib/presentation/deck-open-preparation";
import type { Deck } from "@/lib/presentation/schema";
import {
  dedupePresentationDiagnostics,
  mergePresentationDiagnostics,
} from "@/lib/presentation/diagnostic-handoff";
import {
  SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE,
  hasUnresolvedDeckSaveConflict,
  updateConflictLocalDeck,
  type SlideEditorConflictState,
} from "@/lib/presentation/slide-editor-collaboration-state";

/** State backing the presentation AI deck preview/diff surface. */
export interface AiPreviewState {
  /** The AI-generated presentation deck under review. */
  proposedDeck: Deck;
  /** The presentation deck the editor would otherwise open. */
  baselineDeck: Deck;
  /** Whether the source outline was trimmed to fit the input budget. */
  truncated: boolean;
  /** AI repair/compile diagnostics from generation and preview regenerate. */
  generationDiagnostics: PresentationDiagnostic[];
  /** Generation options, re-sent verbatim on Regenerate. */
  options: DeckGenerationOptions;
  /** Theme package used for the AI generation request and preview regenerate. */
  themePackageId: ThemePackageId;
  /** The document snapshot, re-sent verbatim on Regenerate / used on apply. */
  contentJson: string;
}

export interface UseSlideEditorOpenOptions {
  documentId: string;
  initialDeckJson: unknown;
  deckPort: DeckActionPort;
  initialContentJson?: string | null;
  onOpenRightSurface?: () => void;
  onCloseRightSurface?: () => void;
}

const noop = () => undefined;
const SAVE_CONFLICT_ERROR_MESSAGE =
  "Save conflict: another session modified this deck.";
const SAVE_DECK_REJECTED_FALLBACK_MESSAGE =
  "Couldn't save your deck. Check your connection and retry.";

function resolveDeckRequestThemePackageId(deck: Pick<Deck, "theme">) {
  return (
    resolveBuiltInThemePackageId(deck.theme.packageId) ??
    DEFAULT_THEME_PACKAGE_ID
  );
}

export type SlideEditorOpenError = {
  error: string;
  diagnostics: PresentationDiagnostic[];
  validationErrors?: string[];
};

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (typeof error === "string") {
    return error.trim();
  }
  return "";
}

export function resolveDeckSaveRejectionError(error: unknown): string {
  const details = stringifyError(error);
  if (!details) {
    return SAVE_DECK_REJECTED_FALLBACK_MESSAGE;
  }
  return `${SAVE_DECK_REJECTED_FALLBACK_MESSAGE} (${details})`;
}

interface PersistDeckWithRecoveryParams {
  updatedDeck: Deck;
  documentId: string;
  deckPort: Pick<DeckActionPort, "saveDeckJson">;
  revisionTokenRef: { current: string | null };
  lastSavedRef: { current: unknown };
  aiAppliedDeckRef: { current: Deck | null };
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
  setSaveError: (error: string | null) => void;
  setConflictState: (state: SlideEditorConflictState | null) => void;
  onAiDeckSaved: (savedDeck: Deck) => void;
  shouldApplyCompletionState?: () => boolean;
}

export async function persistDeckWithRecovery({
  updatedDeck,
  documentId,
  deckPort,
  revisionTokenRef,
  lastSavedRef,
  aiAppliedDeckRef,
  setDirty,
  setSaving,
  setSaveError,
  setConflictState,
  onAiDeckSaved,
  shouldApplyCompletionState = () => true,
}: PersistDeckWithRecoveryParams): Promise<ActionResult> {
  setSaving(true);
  setSaveError(null);
  try {
    const saveResult = await deckPort.saveDeckJson(
      documentId,
      updatedDeck,
      revisionTokenRef.current,
    );
    const shouldApplyCompletion = shouldApplyCompletionState();
    if (saveResult.ok === true) {
      lastSavedRef.current = updatedDeck;
      revisionTokenRef.current = saveResult.revisionToken;
      if (shouldApplyCompletion) {
        setDirty(false);
        setSaveError(null);
        setConflictState(null);
        if (aiAppliedDeckRef.current) {
          aiAppliedDeckRef.current = null;
          onAiDeckSaved(updatedDeck);
        }
      }
      return { ok: true, data: undefined };
    }
    if (saveResult.ok === "conflict") {
      if (shouldApplyCompletion) {
        setSaveError(SAVE_CONFLICT_ERROR_MESSAGE);
        setConflictState({
          localDeck: updatedDeck,
          serverRevisionToken: saveResult.serverRevisionToken,
        });
      }
      return { ok: false, error: SAVE_CONFLICT_ERROR_MESSAGE };
    }
    if (shouldApplyCompletion) {
      setSaveError(saveResult.error);
    }
    return { ok: false, error: saveResult.error };
  } catch (error) {
    const rejectionError = resolveDeckSaveRejectionError(error);
    if (shouldApplyCompletionState()) {
      setSaveError(rejectionError);
    }
    return { ok: false, error: rejectionError };
  } finally {
    setSaving(false);
  }
}

interface CreateSerializedDeckPersistorParams<TDeck> {
  persistDeck: (deck: TDeck) => Promise<ActionResult>;
}

export function createSerializedDeckPersistor<TDeck>({
  persistDeck,
}: CreateSerializedDeckPersistorParams<TDeck>): (
  deck: TDeck,
) => Promise<ActionResult> {
  let latestDeck: TDeck | null = null;
  let inFlightSave: Promise<ActionResult> | null = null;
  let saveAgain = false;

  return (deck: TDeck): Promise<ActionResult> => {
    latestDeck = deck;
    if (inFlightSave) {
      saveAgain = true;
      return inFlightSave;
    }

    const savePromise = (async (): Promise<ActionResult> => {
      let lastResult: ActionResult = actionOk();
      try {
        do {
          saveAgain = false;
          const deckToSave: TDeck | null = latestDeck;
          if (deckToSave === null) {
            return lastResult;
          }
          lastResult = await persistDeck(deckToSave);
          if (latestDeck !== deckToSave) {
            saveAgain = true;
          }
        } while (saveAgain);
        return lastResult;
      } finally {
        saveAgain = false;
      }
    })();

    inFlightSave = savePromise;
    void savePromise.finally(() => {
      if (inFlightSave === savePromise) {
        inFlightSave = null;
      }
    });
    return savePromise;
  };
}

interface CreateDeckAutosaveOnDueParams {
  persistDeck: (deck: Deck) => Promise<ActionResult>;
  log: typeof logInfo;
}

interface QueuedPersistDeck {
  deck: Deck;
  requestId: number;
}

export function createDeckAutosaveOnDue({
  persistDeck,
  log,
}: CreateDeckAutosaveOnDueParams): (deck: Deck) => void {
  return (deck: Deck) => {
    void persistDeck(deck)
      .then((result) => {
        if (!result.ok) {
          log("editor.slide-editor", "presentation-autosave-error", {
            error: result.error,
          });
        }
      })
      .catch((error: unknown) => {
        log("editor.slide-editor", "presentation-autosave-error", {
          error: resolveDeckSaveRejectionError(error),
        });
      });
  };
}

interface ApplyAiDeckProposalParams {
  aiDeck: Deck;
  generationDiagnostics?: PresentationDiagnostic[];
  aiAppliedDeckRef: { current: Deck | null };
  enterRecovery: (info: SlideEditorOpenError) => void;
  finishOpen: (deck: Deck, diagnostics?: PresentationDiagnostic[]) => void;
  cancelAutosave: () => void;
  setDirty: (dirty: boolean) => void;
  persistDeck: (deck: Deck) => Promise<ActionResult>;
}

export function applyAiDeckProposal({
  aiDeck,
  generationDiagnostics = [],
  aiAppliedDeckRef,
  enterRecovery,
  finishOpen,
  cancelAutosave,
  setDirty,
  persistDeck,
}: ApplyAiDeckProposalParams): void {
  // Route AI proposals through the same open boundary so a malformed deck
  // surfaces recovery diagnostics instead of silently blanking the editor.
  const opened = openAiGeneratedDeck(aiDeck);
  if (!opened.ok) {
    enterRecovery({
      error: opened.error,
      diagnostics: mergePresentationDiagnostics(
        generationDiagnostics,
        opened.diagnostics,
      ),
      validationErrors: opened.errors,
    });
    return;
  }
  const mergedDiagnostics = mergePresentationDiagnostics(
    generationDiagnostics,
    opened.diagnostics,
  );
  aiAppliedDeckRef.current = opened.deck;
  emitProductTelemetry("product.ai.deck.applied", {
    editDistanceBucket: bucketCount(opened.deck.slides.length),
    slideCount: opened.deck.slides.length,
  });
  cancelAutosave();
  finishOpen(opened.deck, mergedDiagnostics);
  setDirty(true);
  void persistDeck(opened.deck);
}

export function useSlideEditorOpen({
  documentId,
  initialDeckJson,
  deckPort,
  initialContentJson = null,
  onOpenRightSurface = noop,
  onCloseRightSurface = noop,
}: UseSlideEditorOpenOptions) {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [pendingJson, setPendingJson] = useState<string | null>(null);
  const [pendingThemePackageId, setPendingThemePackageId] =
    useState<ThemePackageId>(DEFAULT_THEME_PACKAGE_ID);
  const [emptyDocument, setEmptyDocument] = useState(false);
  const [aiPreview, setAiPreview] = useState<AiPreviewState | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [deckOpenDiagnostics, setDeckOpenDiagnostics] = useState<
    PresentationDiagnostic[]
  >([]);
  const [deckOpenError, setDeckOpenError] =
    useState<SlideEditorOpenError | null>(null);
  const [presentationDirty, setDirty] = useState(false);
  const [presentationSaving, setSaving] = useState(false);
  const [presentationSaveError, setSaveError] = useState<string | null>(null);
  const [presentationQueueStatus, setQueueStatus] =
    useState<SaveQueueStatus>("idle");
  const [undoStack, setUndoStack] = useState<Deck[]>([]);
  const [redoStack, setRedoStack] = useState<Deck[]>([]);
  const [conflictState, setConflictState] =
    useState<SlideEditorConflictState | null>(null);
  const [undoRedoFocus, setUndoRedoFocus] = useState<{
    nodeId: string;
    token: number;
  } | null>(null);

  const aiEnabled = isAiDeckGenClientEnabled();
  const lastSavedRef = useRef<unknown>(initialDeckJson);
  const revisionTokenRef = useRef<string | null>(null);
  const aiAppliedDeckRef = useRef<Deck | null>(null);
  const focusTokenRef = useRef(0);
  const autosaveQueueRef = useRef<ResilientLatestSnapshotQueue<Deck> | null>(
    null,
  );
  const inFlightPersistRef = useRef<Promise<ActionResult> | null>(null);
  const latestPersistDeckRef = useRef<QueuedPersistDeck | null>(null);
  const latestPersistRequestIdRef = useRef(0);
  const saveAgainPersistRef = useRef(false);

  const persistDeckWithSingleWrite = useCallback(
    async (updatedDeck: Deck, requestId: number): Promise<ActionResult> => {
      return persistDeckWithRecovery({
        updatedDeck,
        documentId,
        deckPort,
        revisionTokenRef,
        lastSavedRef,
        aiAppliedDeckRef,
        setDirty,
        setSaving,
        setSaveError,
        setConflictState,
        onAiDeckSaved: (savedDeck) => {
          emitProductTelemetry("product.ai.deck.saved", {
            editDistanceBucket: bucketCount(savedDeck.slides.length),
            slideCount: savedDeck.slides.length,
          });
        },
        shouldApplyCompletionState: () =>
          latestPersistRequestIdRef.current === requestId,
      });
    },
    [deckPort, documentId],
  );
  const persistDeck = useCallback(
    (updatedDeck: Deck): Promise<ActionResult> => {
      const queue = autosaveQueueRef.current;
      if (queue) {
        return queue.enqueue(updatedDeck, revisionTokenRef.current, {
          flush: true,
        });
      }
      latestPersistRequestIdRef.current += 1;
      const requestId = latestPersistRequestIdRef.current;
      latestPersistDeckRef.current = { deck: updatedDeck, requestId };
      if (inFlightPersistRef.current) {
        saveAgainPersistRef.current = true;
        return inFlightPersistRef.current;
      }
      const savePromise = (async (): Promise<ActionResult> => {
        let lastResult: ActionResult = actionOk();
        try {
          do {
            saveAgainPersistRef.current = false;
            const queuedDeck = latestPersistDeckRef.current;
            if (queuedDeck === null) {
              return lastResult;
            }
            lastResult = await persistDeckWithSingleWrite(
              queuedDeck.deck,
              queuedDeck.requestId,
            );
            if (
              latestPersistDeckRef.current?.requestId !== queuedDeck.requestId
            ) {
              saveAgainPersistRef.current = true;
            }
          } while (saveAgainPersistRef.current);
          return lastResult;
        } finally {
          saveAgainPersistRef.current = false;
        }
      })();
      inFlightPersistRef.current = savePromise;
      void savePromise.finally(() => {
        if (inFlightPersistRef.current === savePromise) {
          inFlightPersistRef.current = null;
        }
      });
      return savePromise;
    },
    [persistDeckWithSingleWrite],
  );

  useEffect(() => {
    const queue = createResilientLatestSnapshotQueue<Deck>({
      documentId,
      storage: createBrowserLocalStorageSaveQueueStorage<Deck>({
        documentId,
      }),
      isOnline: () =>
        typeof navigator === "undefined" ? true : navigator.onLine !== false,
      onStatusChange: setQueueStatus,
      onSaved: (savedDeck, revisionToken) => {
        lastSavedRef.current = savedDeck;
        revisionTokenRef.current = revisionToken;
        setDirty(false);
        setSaveError(null);
        setConflictState(null);
        if (aiAppliedDeckRef.current) {
          aiAppliedDeckRef.current = null;
          emitProductTelemetry("product.ai.deck.saved", {
            editDistanceBucket: bucketCount(savedDeck.slides.length),
            slideCount: savedDeck.slides.length,
          });
        }
      },
      save: async (
        queuedDeck,
        baseRevisionToken,
      ): Promise<SaveQueueSaveResult> => {
        setSaving(true);
        setSaveError(null);
        try {
          const saveResult = await deckPort.saveDeckJson(
            documentId,
            queuedDeck,
            baseRevisionToken,
          );
          if (saveResult.ok === true) {
            return {
              ok: true,
              revisionToken: saveResult.revisionToken,
            };
          }
          if (saveResult.ok === "conflict") {
            setSaveError(SAVE_CONFLICT_ERROR_MESSAGE);
            setConflictState({
              localDeck: queuedDeck,
              serverRevisionToken: saveResult.serverRevisionToken,
            });
            return saveResult;
          }
          setSaveError(saveResult.error);
          return {
            ok: false,
            error: saveResult.error,
            retryable: saveResult.failure.retryable,
          };
        } catch (error) {
          const rejectionError = resolveDeckSaveRejectionError(error);
          setSaveError(rejectionError);
          return { ok: false, error: rejectionError, retryable: true };
        } finally {
          setSaving(false);
        }
      },
    });
    autosaveQueueRef.current = queue;

    const retryQueuedSave = () => {
      void queue.flushNow();
    };
    /* node:coverage ignore next 11 */
    if (typeof window !== "undefined") {
      window.addEventListener("online", retryQueuedSave);
      window.addEventListener("focus", retryQueuedSave);
      document.addEventListener("visibilitychange", retryQueuedSave);
    }
    return () => {
      queue.destroy();
      if (autosaveQueueRef.current === queue) {
        autosaveQueueRef.current = null;
      }
      /* node:coverage ignore next 6 */
      if (typeof window !== "undefined") {
        window.removeEventListener("online", retryQueuedSave);
        window.removeEventListener("focus", retryQueuedSave);
        document.removeEventListener("visibilitychange", retryQueuedSave);
      }
    };
  }, [deckPort, documentId]);

  const cancelAutosave = useCallback(() => {
    autosaveQueueRef.current?.cancelScheduledFlush();
  }, []);

  const fallbackDeck = useCallback(
    (contentJson?: string | null) => {
      if (contentJson && !isEffectivelyEmptyEditorState(contentJson)) {
        const derived = deriveDeckFromDocumentContent({
          contentJson,
          documentId,
          themePackageId: pendingThemePackageId,
        });
        if (derived.ok) {
          return { deck: derived.deck, diagnostics: derived.diagnostics };
        }
      }
      return createBlankDeck({ documentId });
    },
    [documentId, pendingThemePackageId],
  );

  const finishOpen = useCallback(
    (startDeck: Deck, diagnostics: PresentationDiagnostic[] = []) => {
      setDeck(startDeck);
      setDeckOpenDiagnostics(diagnostics);
      setDeckOpenError(null);
      setDirty(false);
      setSaving(false);
      setSaveError(null);
      setUndoStack([]);
      setRedoStack([]);
      setUndoRedoFocus(null);
      setPendingJson(null);
      setAiPreview(null);
      setOpen(true);
      onOpenRightSurface();
    },
    [onOpenRightSurface],
  );

  const enterRecovery = useCallback(
    (info: SlideEditorOpenError) => {
      aiAppliedDeckRef.current = null;
      cancelAutosave();
      setDeck(null);
      setDeckOpenDiagnostics(info.diagnostics);
      setDeckOpenError(info);
      setPendingJson(null);
      setAiPreview(null);
      setDirty(false);
      setSaving(false);
      setSaveError(info.error);
      setUndoStack([]);
      setRedoStack([]);
      setUndoRedoFocus(null);
      setOpen(true);
      onOpenRightSurface();
    },
    [cancelAutosave, onOpenRightSurface],
  );

  const prepareOpen = useCallback(
    async (contentJson?: string | null): Promise<PreparedDeckForOpen> => {
      return await prepareDeckForOpen({
        documentId,
        deckPort,
        fallbackDeck: () => fallbackDeck(contentJson),
        onFetchFailure: ({ reason, error }) => {
          logInfo("editor.slide-editor", "presentation-open-fetch-failed", {
            documentId,
            reason,
            error,
          });
        },
      });
    },
    [deckPort, documentId, fallbackDeck],
  );

  const openSaved = useCallback(
    async (contentJson?: string | null) => {
      aiAppliedDeckRef.current = null;
      const prepared = await prepareOpen(contentJson);
      if (prepared.ok) {
        revisionTokenRef.current = prepared.revisionToken;
        finishOpen(prepared.deck, prepared.diagnostics);
        const recovered = await autosaveQueueRef.current?.recover();
        if (recovered) {
          setDeck(recovered.snapshot);
          setDirty(true);
          setSaveError(null);
          void autosaveQueueRef.current?.flushNow();
        }
        return;
      }
      enterRecovery({
        error: prepared.error,
        diagnostics: prepared.diagnostics,
        validationErrors: prepared.validationErrors,
      });
    },
    [enterRecovery, finishOpen, prepareOpen],
  );

  const openDerived = useCallback(
    async (
      contentJson: string,
      themePackageId: ThemePackageId = pendingThemePackageId,
    ) => {
      aiAppliedDeckRef.current = null;
      const derived = deriveDeckFromDocumentContent({
        contentJson,
        documentId,
        themePackageId,
      });
      if (derived.ok) {
        finishOpen(derived.deck, derived.diagnostics);
        return;
      }
      enterRecovery({
        error: derived.error,
        diagnostics: derived.diagnostics,
        validationErrors: derived.validationErrors,
      });
    },
    [documentId, enterRecovery, finishOpen, pendingThemePackageId],
  );

  const openWithAiDeck = useCallback(
    (aiDeck: Deck, generationDiagnostics: PresentationDiagnostic[] = []) => {
      applyAiDeckProposal({
        aiDeck,
        generationDiagnostics,
        aiAppliedDeckRef,
        enterRecovery,
        finishOpen,
        cancelAutosave,
        setDirty,
        persistDeck,
      });
    },
    [cancelAutosave, enterRecovery, finishOpen, persistDeck, setDirty],
  );

  const showAiPreview = useCallback(
    async (
      proposedDeck: Deck,
      truncated: boolean,
      generationDiagnostics: PresentationDiagnostic[],
      options: DeckGenerationOptions,
      themePackageId: ThemePackageId,
      json: string,
    ) => {
      const preparedBaseline = await prepareOpen(json);
      if (!preparedBaseline.ok) {
        enterRecovery({
          error: preparedBaseline.error,
          diagnostics: preparedBaseline.diagnostics,
          validationErrors: preparedBaseline.validationErrors,
        });
        return;
      }
      revisionTokenRef.current = preparedBaseline.revisionToken;
      setPendingJson(null);
      setAiPreview({
        proposedDeck,
        baselineDeck: preparedBaseline.deck,
        truncated,
        generationDiagnostics: dedupePresentationDiagnostics(
          generationDiagnostics,
        ),
        options,
        themePackageId,
        contentJson: json,
      });
    },
    [enterRecovery, prepareOpen],
  );

  const effectiveContentJson = useCallback(
    (liveJson: string) => {
      if (
        isEffectivelyEmptyEditorState(liveJson) &&
        initialContentJson &&
        !isEffectivelyEmptyEditorState(initialContentJson)
      ) {
        return initialContentJson;
      }
      return liveJson;
    },
    [initialContentJson],
  );

  const handleOpen = useCallback(async () => {
    const liveJson = JSON.stringify(editor.getEditorState().toJSON());
    const contentJson = effectiveContentJson(liveJson);

    if (aiEnabled) {
      const prepared = await prepareOpen(contentJson);
      if (!prepared.ok) {
        enterRecovery({
          error: prepared.error,
          diagnostics: prepared.diagnostics,
          validationErrors: prepared.validationErrors,
        });
        return;
      }
      revisionTokenRef.current = prepared.revisionToken;
      setEmptyDocument(isEffectivelyEmptyEditorState(contentJson));
      setPendingThemePackageId(resolveDeckRequestThemePackageId(prepared.deck));
      setPendingJson(contentJson);
      return;
    }

    await openSaved(contentJson);
  }, [
    aiEnabled,
    editor,
    effectiveContentJson,
    enterRecovery,
    openSaved,
    prepareOpen,
  ]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setDeck(null);
    setDeckOpenDiagnostics([]);
    setDeckOpenError(null);
    setDirty(false);
    setSaving(false);
    setSaveError(null);
    setUndoStack([]);
    setRedoStack([]);
    setUndoRedoFocus(null);
    setPendingJson(null);
    setPendingThemePackageId(DEFAULT_THEME_PACKAGE_ID);
    setEmptyDocument(false);
    setAiPreview(null);
    setConflictState(null);
    aiAppliedDeckRef.current = null;
    cancelAutosave();
    onCloseRightSurface();
  }, [cancelAutosave, onCloseRightSurface]);

  const handleSave = useCallback(
    async (updatedDeck: Deck): Promise<ActionResult> => {
      // Manual save supersedes any debounced autosave: drop the pending timer so
      // a stale autosave can't fire after we report success (-008).
      cancelAutosave();
      return persistDeck(updatedDeck);
    },
    [cancelAutosave, persistDeck],
  );

  const scheduleAutosave = useCallback((updatedDeck: Deck) => {
    const queue = autosaveQueueRef.current;
    if (queue) {
      void queue
        .enqueue(updatedDeck, revisionTokenRef.current, {
          flush: queue.isFlushing(),
        })
        .then((result) => {
          if (!result.ok) {
            logInfo("editor.slide-editor", "presentation-autosave-error", {
              error: result.error,
            });
          }
        });
      return;
    }
  }, []);

  const focusAfterHistory = useCallback((fromDeck: Deck, toDeck: Deck) => {
    const target = pickUndoFocusTarget(fromDeck, toDeck);
    if (target) {
      focusTokenRef.current += 1;
      setUndoRedoFocus({ nodeId: target, token: focusTokenRef.current });
    }
  }, []);

  const persistOrScheduleDeckChange = useCallback(
    (updatedDeck: Deck) => {
      if (inFlightPersistRef.current) {
        void persistDeck(updatedDeck);
        return;
      }
      scheduleAutosave(updatedDeck);
    },
    [persistDeck, scheduleAutosave],
  );

  const handleDeckChange = useCallback(
    (updatedDeck: Deck) => {
      if (hasUnresolvedDeckSaveConflict(conflictState)) {
        setConflictState(updateConflictLocalDeck(conflictState, updatedDeck));
        setDeck(updatedDeck);
        setDirty(true);
        setSaveError(SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE);
        return;
      }
      setUndoStack((stack) => (deck ? [...stack, deck].slice(-50) : stack));
      setRedoStack([]);
      setDeck(updatedDeck);
      setDirty(true);
      setSaveError(null);
      persistOrScheduleDeckChange(updatedDeck);
    },
    [conflictState, deck, persistOrScheduleDeckChange],
  );

  const handleUndo = useCallback(() => {
    if (hasUnresolvedDeckSaveConflict(conflictState)) return;
    setUndoStack((stack) => {
      const previous = stack.at(-1);
      if (!previous || !deck) return stack;
      setRedoStack((redoStack) => [...redoStack, deck].slice(-50));
      focusAfterHistory(deck, previous);
      setDeck(previous);
      setDirty(true);
      setSaveError(null);
      persistOrScheduleDeckChange(previous);
      return stack.slice(0, -1);
    });
  }, [conflictState, deck, focusAfterHistory, persistOrScheduleDeckChange]);

  const handleRedo = useCallback(() => {
    if (hasUnresolvedDeckSaveConflict(conflictState)) return;
    setRedoStack((stack) => {
      const next = stack.at(-1);
      if (!next || !deck) return stack;
      setUndoStack((undoStack) => [...undoStack, deck].slice(-50));
      focusAfterHistory(deck, next);
      setDeck(next);
      setDirty(true);
      setSaveError(null);
      persistOrScheduleDeckChange(next);
      return stack.slice(0, -1);
    });
  }, [conflictState, deck, focusAfterHistory, persistOrScheduleDeckChange]);

  const handleOpenDialogApply = useCallback(
    ({
      deck: generated,
      truncated,
      diagnostics,
      options,
    }: {
      deck: Deck;
      truncated: boolean;
      diagnostics: PresentationDiagnostic[];
      options: DeckGenerationOptions;
    }) => {
      if (!pendingJson) return;
      void showAiPreview(
        generated,
        truncated,
        diagnostics,
        options,
        pendingThemePackageId,
        pendingJson,
      );
    },
    [pendingJson, pendingThemePackageId, showAiPreview],
  );

  const handleOpenDialogDerive = useCallback(() => {
    if (!pendingJson) return;
    void openDerived(pendingJson);
  }, [openDerived, pendingJson]);

  const handleOpenDialogClose = useCallback(() => {
    setPendingJson(null);
    setPendingThemePackageId(DEFAULT_THEME_PACKAGE_ID);
    setEmptyDocument(false);
  }, []);

  const handleAiPreviewApply = useCallback(
    (applied: Deck, generationDiagnostics: PresentationDiagnostic[]) => {
      if (aiPreview) {
        openWithAiDeck(applied, generationDiagnostics);
      }
    },
    [aiPreview, openWithAiDeck],
  );

  const handleAiPreviewDerive = useCallback(() => {
    if (aiPreview) {
      void openDerived(aiPreview.contentJson, aiPreview.themePackageId);
    }
  }, [aiPreview, openDerived]);

  const handleAiPreviewCancel = useCallback(() => {
    setAiPreview(null);
  }, []);

  const handleConflictKeepMine = useCallback(
    async (localDeck: Deck, serverToken: string | null) => {
      const res: SaveDeckResult = await deckPort.saveDeckJson(
        documentId,
        localDeck,
        serverToken,
      );
      if (res.ok === true) {
        await autosaveQueueRef.current?.clear();
        lastSavedRef.current = localDeck;
        revisionTokenRef.current = res.revisionToken;
        setConflictState(null);
        setDirty(false);
        setSaving(false);
        setSaveError(null);
      } else if (res.ok === "conflict") {
        setConflictState({
          localDeck,
          serverRevisionToken: res.serverRevisionToken,
        });
        throw new Error("Still conflicted - try again.");
      } else {
        throw new Error(res.error);
      }
    },
    [deckPort, documentId],
  );

  const handleConflictUseTheirs = useCallback(async () => {
    const reloadResult = await reloadConflictServerDeck({
      deckPort,
      documentId,
    });
    if (!reloadResult.ok) {
      logInfo(
        "editor.slide-editor",
        "presentation-conflict-use-server-reload-failed",
        {
          reason: reloadResult.reason,
        },
      );
      setSaveError(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE);
      throw new Error(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE);
    }
    revisionTokenRef.current = reloadResult.revisionToken;
    lastSavedRef.current = reloadResult.deckJson;
    setDeck(reloadResult.deck);
    setDeckOpenDiagnostics(reloadResult.diagnostics);
    setDeckOpenError(null);
    setDirty(false);
    setSaving(false);
    setSaveError(null);
    setUndoStack([]);
    setRedoStack([]);
    setUndoRedoFocus(null);
    setConflictState(null);
    await autosaveQueueRef.current?.clear();
  }, [deckPort, documentId]);

  const handleConflictDismiss = useCallback(() => {
    setConflictState(null);
  }, []);

  const saveStatus: SaveStatus = resolveSaveStatus({
    isDirty: presentationDirty,
    isSaving: presentationSaving,
    hasError: presentationSaveError !== null,
    queueStatus: presentationQueueStatus,
  });
  const hasDurableQueuedWork =
    presentationQueueStatus === "queued" ||
    presentationQueueStatus === "offline" ||
    presentationQueueStatus === "retrying" ||
    presentationQueueStatus === "saving" ||
    presentationQueueStatus === "conflict";

  return {
    open,
    deck,
    deckOpenDiagnostics,
    deckOpenError,
    saveStatus,
    saveStatusLabel: SAVE_STATUS_LABEL[saveStatus],
    saveErrorMessage: resolveSaveErrorMessage(presentationSaveError),
    hasUnsavedWork:
      !hasDurableQueuedWork &&
      (presentationDirty ||
        presentationSaving ||
        presentationSaveError !== null ||
        presentationQueueStatus === "failed"),
    setDeck,
    handleDeckChange,
    handleSave,
    handleUndo,
    handleRedo,
    undoRedoFocus,
    canUndo:
      !hasUnresolvedDeckSaveConflict(conflictState) && undoStack.length > 0,
    canRedo:
      !hasUnresolvedDeckSaveConflict(conflictState) && redoStack.length > 0,
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
  };
}
