"use client";

/**
 * Open/close/route state controller for the v7-only slide editor entry point.
 *
 * Development builds support only DeckV7 at runtime. Legacy deck JSON is not
 * migrated here; when no saved v7 deck is available, the editor derives a deck
 * from the current document content and only falls back to a native blank DeckV7
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
  type ThemePackageId,
} from "@/lib/presentation-shared/theme-packages";
import {
  SAVE_STATUS_LABEL,
  resolveSaveErrorMessage,
  resolveSaveStatus,
  type SaveStatus,
} from "@/lib/presentation-shared/save-status";
import {
  createSlideAutosaveScheduler,
  type SlideAutosaveScheduler,
} from "@/lib/presentation-shared/slide-autosave-scheduler";
import { bucketCount, emitProductTelemetry } from "@/lib/telemetry/product";
import type { PresentationDiagnostic } from "@/lib/presentation-vnext/diagnostics";
import { createBlankDeckV7 } from "@/lib/presentation-vnext/empty-deck";
import {
  CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
  reloadConflictServerDeckV7,
} from "@/lib/presentation-vnext/conflict-recovery-reload-v7";
import { openAiGeneratedDeck } from "@/lib/presentation-vnext/open-deck";
import { deriveDeckV7FromDocumentContent } from "@/lib/presentation-vnext/deck-derivation";
import { pickUndoFocusTarget } from "@/lib/presentation-vnext/deck-diff";
import {
  prepareDeckForOpenV7,
  type PreparedDeckForOpenV7,
} from "@/lib/presentation-vnext/deck-open-preparation-v7";
import type { DeckV7 } from "@/lib/presentation-vnext/schema";
import {
  dedupePresentationDiagnostics,
  mergePresentationDiagnostics,
} from "@/lib/presentation-vnext/diagnostic-handoff";
import {
  SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE,
  hasUnresolvedDeckSaveConflict,
  updateConflictLocalDeck,
  type SlideEditorConflictStateV7,
} from "@/lib/presentation-vnext/slide-editor-collaboration-state";

/** State backing the v7 AI deck preview/diff surface. */
export interface AiPreviewStateV7 {
  /** The AI-generated v7 deck under review. */
  proposedDeck: DeckV7;
  /** The v7 deck the editor would otherwise open. */
  baselineDeck: DeckV7;
  /** Whether the source outline was trimmed to fit the input budget. */
  truncated: boolean;
  /** AI repair/compile diagnostics from generation and preview regenerate. */
  generationDiagnostics: PresentationDiagnostic[];
  /** Generation options, re-sent verbatim on Regenerate. */
  options: DeckGenerationOptions;
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

export type SlideEditorOpenErrorV7 = {
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

interface PersistDeckV7WithRecoveryParams {
  updatedDeck: DeckV7;
  documentId: string;
  deckPort: Pick<DeckActionPort, "saveDeckJson">;
  revisionTokenRef: { current: string | null };
  lastSavedRef: { current: unknown };
  aiAppliedDeckRef: { current: DeckV7 | null };
  setV7Dirty: (dirty: boolean) => void;
  setV7Saving: (saving: boolean) => void;
  setV7SaveError: (error: string | null) => void;
  setConflictStateV7: (state: SlideEditorConflictStateV7 | null) => void;
  onAiDeckSaved: (savedDeck: DeckV7) => void;
  shouldApplyCompletionState?: () => boolean;
}

export async function persistDeckV7WithRecovery({
  updatedDeck,
  documentId,
  deckPort,
  revisionTokenRef,
  lastSavedRef,
  aiAppliedDeckRef,
  setV7Dirty,
  setV7Saving,
  setV7SaveError,
  setConflictStateV7,
  onAiDeckSaved,
  shouldApplyCompletionState = () => true,
}: PersistDeckV7WithRecoveryParams): Promise<ActionResult> {
  setV7Saving(true);
  setV7SaveError(null);
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
        setV7Dirty(false);
        setV7SaveError(null);
        setConflictStateV7(null);
        if (aiAppliedDeckRef.current) {
          aiAppliedDeckRef.current = null;
          onAiDeckSaved(updatedDeck);
        }
      }
      return { ok: true, data: undefined };
    }
    if (saveResult.ok === "conflict") {
      if (shouldApplyCompletion) {
        setV7SaveError(SAVE_CONFLICT_ERROR_MESSAGE);
        setConflictStateV7({
          localDeck: updatedDeck,
          serverRevisionToken: saveResult.serverRevisionToken,
        });
      }
      return { ok: false, error: SAVE_CONFLICT_ERROR_MESSAGE };
    }
    if (shouldApplyCompletion) {
      setV7SaveError(saveResult.error);
    }
    return { ok: false, error: saveResult.error };
  } catch (error) {
    const rejectionError = resolveDeckSaveRejectionError(error);
    if (shouldApplyCompletionState()) {
      setV7SaveError(rejectionError);
    }
    return { ok: false, error: rejectionError };
  } finally {
    setV7Saving(false);
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
  persistDeckV7: (deck: DeckV7) => Promise<ActionResult>;
  log: typeof logInfo;
}

interface QueuedPersistDeckV7 {
  deck: DeckV7;
  requestId: number;
}

export function createDeckAutosaveOnDue({
  persistDeckV7,
  log,
}: CreateDeckAutosaveOnDueParams): (deck: DeckV7) => void {
  return (deck: DeckV7) => {
    void persistDeckV7(deck)
      .then((result) => {
        if (!result.ok) {
          log("editor.slide-editor", "v7-autosave-error", {
            error: result.error,
          });
        }
      })
      .catch((error: unknown) => {
        log("editor.slide-editor", "v7-autosave-error", {
          error: resolveDeckSaveRejectionError(error),
        });
      });
  };
}

interface ApplyAiDeckProposalV7Params {
  aiDeck: DeckV7;
  generationDiagnostics?: PresentationDiagnostic[];
  aiAppliedDeckRef: { current: DeckV7 | null };
  enterRecoveryV7: (info: SlideEditorOpenErrorV7) => void;
  finishOpenV7: (deck: DeckV7, diagnostics?: PresentationDiagnostic[]) => void;
  cancelAutosaveV7: () => void;
  setV7Dirty: (dirty: boolean) => void;
  persistDeckV7: (deck: DeckV7) => Promise<ActionResult>;
}

export function applyAiDeckProposalV7({
  aiDeck,
  generationDiagnostics = [],
  aiAppliedDeckRef,
  enterRecoveryV7,
  finishOpenV7,
  cancelAutosaveV7,
  setV7Dirty,
  persistDeckV7,
}: ApplyAiDeckProposalV7Params): void {
  // Route AI proposals through the same open boundary so a malformed deck
  // surfaces recovery diagnostics instead of silently blanking the editor.
  const opened = openAiGeneratedDeck(aiDeck);
  if (!opened.ok) {
    enterRecoveryV7({
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
  cancelAutosaveV7();
  finishOpenV7(opened.deck, mergedDiagnostics);
  setV7Dirty(true);
  void persistDeckV7(opened.deck);
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
  const [aiPreviewV7, setAiPreviewV7] = useState<AiPreviewStateV7 | null>(null);
  const [deckV7, setDeckV7] = useState<DeckV7 | null>(null);
  const [deckOpenDiagnosticsV7, setDeckOpenDiagnosticsV7] = useState<
    PresentationDiagnostic[]
  >([]);
  const [deckOpenErrorV7, setDeckOpenErrorV7] =
    useState<SlideEditorOpenErrorV7 | null>(null);
  const [v7Dirty, setV7Dirty] = useState(false);
  const [v7Saving, setV7Saving] = useState(false);
  const [v7SaveError, setV7SaveError] = useState<string | null>(null);
  const [undoStackV7, setUndoStackV7] = useState<DeckV7[]>([]);
  const [redoStackV7, setRedoStackV7] = useState<DeckV7[]>([]);
  const [conflictStateV7, setConflictStateV7] =
    useState<SlideEditorConflictStateV7 | null>(null);
  const [undoRedoFocusV7, setUndoRedoFocusV7] = useState<{
    nodeId: string;
    token: number;
  } | null>(null);

  const aiEnabled = isAiDeckGenClientEnabled();
  const lastSavedRef = useRef<unknown>(initialDeckJson);
  const revisionTokenRef = useRef<string | null>(null);
  const aiAppliedDeckRef = useRef<DeckV7 | null>(null);
  const focusTokenRef = useRef(0);
  const autosaveSchedulerRef = useRef<SlideAutosaveScheduler<DeckV7> | null>(
    null,
  );
  const inFlightPersistV7Ref = useRef<Promise<ActionResult> | null>(null);
  const latestPersistDeckV7Ref = useRef<QueuedPersistDeckV7 | null>(null);
  const latestPersistRequestIdRef = useRef(0);
  const saveAgainPersistV7Ref = useRef(false);

  const persistDeckV7WithSingleWrite = useCallback(
    async (updatedDeck: DeckV7, requestId: number): Promise<ActionResult> => {
      return persistDeckV7WithRecovery({
        updatedDeck,
        documentId,
        deckPort,
        revisionTokenRef,
        lastSavedRef,
        aiAppliedDeckRef,
        setV7Dirty,
        setV7Saving,
        setV7SaveError,
        setConflictStateV7,
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
  const persistDeckV7 = useCallback(
    (updatedDeck: DeckV7): Promise<ActionResult> => {
      latestPersistRequestIdRef.current += 1;
      const requestId = latestPersistRequestIdRef.current;
      latestPersistDeckV7Ref.current = { deck: updatedDeck, requestId };
      if (inFlightPersistV7Ref.current) {
        saveAgainPersistV7Ref.current = true;
        return inFlightPersistV7Ref.current;
      }
      const savePromise = (async (): Promise<ActionResult> => {
        let lastResult: ActionResult = actionOk();
        try {
          do {
            saveAgainPersistV7Ref.current = false;
            const queuedDeck = latestPersistDeckV7Ref.current;
            if (queuedDeck === null) {
              return lastResult;
            }
            lastResult = await persistDeckV7WithSingleWrite(
              queuedDeck.deck,
              queuedDeck.requestId,
            );
            if (
              latestPersistDeckV7Ref.current?.requestId !== queuedDeck.requestId
            ) {
              saveAgainPersistV7Ref.current = true;
            }
          } while (saveAgainPersistV7Ref.current);
          return lastResult;
        } finally {
          saveAgainPersistV7Ref.current = false;
        }
      })();
      inFlightPersistV7Ref.current = savePromise;
      void savePromise.finally(() => {
        if (inFlightPersistV7Ref.current === savePromise) {
          inFlightPersistV7Ref.current = null;
        }
      });
      return savePromise;
    },
    [persistDeckV7WithSingleWrite],
  );

  useEffect(() => {
    const onDue = createDeckAutosaveOnDue({
      persistDeckV7,
      log: logInfo,
    });
    const scheduler = createSlideAutosaveScheduler<DeckV7>({
      onDue,
    });
    autosaveSchedulerRef.current = scheduler;
    return () => {
      scheduler.cancel();
      if (autosaveSchedulerRef.current === scheduler) {
        autosaveSchedulerRef.current = null;
      }
    };
  }, [persistDeckV7]);

  const cancelAutosaveV7 = useCallback(() => {
    autosaveSchedulerRef.current?.cancel();
  }, []);

  const fallbackDeck = useCallback(
    (contentJson?: string | null) => {
      if (contentJson && !isEffectivelyEmptyEditorState(contentJson)) {
        const derived = deriveDeckV7FromDocumentContent({
          contentJson,
          documentId,
          themePackageId: pendingThemePackageId,
        });
        if (derived.ok) {
          return { deck: derived.deck, diagnostics: derived.diagnostics };
        }
      }
      return createBlankDeckV7({ documentId });
    },
    [documentId, pendingThemePackageId],
  );

  const finishOpenV7 = useCallback(
    (startDeck: DeckV7, diagnostics: PresentationDiagnostic[] = []) => {
      setDeckV7(startDeck);
      setDeckOpenDiagnosticsV7(diagnostics);
      setDeckOpenErrorV7(null);
      setV7Dirty(false);
      setV7Saving(false);
      setV7SaveError(null);
      setUndoStackV7([]);
      setRedoStackV7([]);
      setUndoRedoFocusV7(null);
      setPendingJson(null);
      setAiPreviewV7(null);
      setOpen(true);
      onOpenRightSurface();
    },
    [onOpenRightSurface],
  );

  const enterRecoveryV7 = useCallback(
    (info: SlideEditorOpenErrorV7) => {
      aiAppliedDeckRef.current = null;
      cancelAutosaveV7();
      setDeckV7(null);
      setDeckOpenDiagnosticsV7(info.diagnostics);
      setDeckOpenErrorV7(info);
      setPendingJson(null);
      setAiPreviewV7(null);
      setV7Dirty(false);
      setV7Saving(false);
      setV7SaveError(info.error);
      setUndoStackV7([]);
      setRedoStackV7([]);
      setUndoRedoFocusV7(null);
      setOpen(true);
      onOpenRightSurface();
    },
    [cancelAutosaveV7, onOpenRightSurface],
  );

  const prepareOpenV7 = useCallback(
    async (contentJson?: string | null): Promise<PreparedDeckForOpenV7> => {
      return await prepareDeckForOpenV7({
        documentId,
        deckPort,
        fallbackDeck: () => fallbackDeck(contentJson),
        onFetchFailure: ({ reason, error }) => {
          logInfo("editor.slide-editor", "v7-open-fetch-failed", {
            documentId,
            reason,
            error,
          });
        },
      });
    },
    [deckPort, documentId, fallbackDeck],
  );

  const openSavedV7 = useCallback(
    async (contentJson?: string | null) => {
      aiAppliedDeckRef.current = null;
      const prepared = await prepareOpenV7(contentJson);
      if (prepared.ok) {
        revisionTokenRef.current = prepared.revisionToken;
        finishOpenV7(prepared.deck, prepared.diagnostics);
        return;
      }
      enterRecoveryV7({
        error: prepared.error,
        diagnostics: prepared.diagnostics,
        validationErrors: prepared.validationErrors,
      });
    },
    [enterRecoveryV7, finishOpenV7, prepareOpenV7],
  );

  const openDerivedV7 = useCallback(
    async (contentJson: string) => {
      aiAppliedDeckRef.current = null;
      const derived = deriveDeckV7FromDocumentContent({
        contentJson,
        documentId,
        themePackageId: pendingThemePackageId,
      });
      if (derived.ok) {
        finishOpenV7(derived.deck, derived.diagnostics);
        return;
      }
      enterRecoveryV7({
        error: derived.error,
        diagnostics: derived.diagnostics,
        validationErrors: derived.validationErrors,
      });
    },
    [documentId, enterRecoveryV7, finishOpenV7, pendingThemePackageId],
  );

  const openWithAiDeckV7 = useCallback(
    (aiDeck: DeckV7, generationDiagnostics: PresentationDiagnostic[] = []) => {
      applyAiDeckProposalV7({
        aiDeck,
        generationDiagnostics,
        aiAppliedDeckRef,
        enterRecoveryV7,
        finishOpenV7,
        cancelAutosaveV7,
        setV7Dirty,
        persistDeckV7,
      });
    },
    [
      cancelAutosaveV7,
      enterRecoveryV7,
      finishOpenV7,
      persistDeckV7,
      setV7Dirty,
    ],
  );

  const showAiPreviewV7 = useCallback(
    async (
      proposedDeck: DeckV7,
      truncated: boolean,
      generationDiagnostics: PresentationDiagnostic[],
      options: DeckGenerationOptions,
      json: string,
    ) => {
      const preparedBaseline = await prepareOpenV7(json);
      if (!preparedBaseline.ok) {
        enterRecoveryV7({
          error: preparedBaseline.error,
          diagnostics: preparedBaseline.diagnostics,
          validationErrors: preparedBaseline.validationErrors,
        });
        return;
      }
      setPendingJson(null);
      setAiPreviewV7({
        proposedDeck,
        baselineDeck: preparedBaseline.deck,
        truncated,
        generationDiagnostics: dedupePresentationDiagnostics(
          generationDiagnostics,
        ),
        options,
        contentJson: json,
      });
    },
    [enterRecoveryV7, prepareOpenV7],
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
      setEmptyDocument(isEffectivelyEmptyEditorState(contentJson));
      setPendingThemePackageId(DEFAULT_THEME_PACKAGE_ID);
      setPendingJson(contentJson);
      return;
    }

    await openSavedV7(contentJson);
  }, [aiEnabled, editor, effectiveContentJson, openSavedV7]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setDeckV7(null);
    setDeckOpenDiagnosticsV7([]);
    setDeckOpenErrorV7(null);
    setV7Dirty(false);
    setV7Saving(false);
    setV7SaveError(null);
    setUndoStackV7([]);
    setRedoStackV7([]);
    setUndoRedoFocusV7(null);
    setPendingJson(null);
    setPendingThemePackageId(DEFAULT_THEME_PACKAGE_ID);
    setEmptyDocument(false);
    setAiPreviewV7(null);
    setConflictStateV7(null);
    aiAppliedDeckRef.current = null;
    cancelAutosaveV7();
    onCloseRightSurface();
  }, [cancelAutosaveV7, onCloseRightSurface]);

  const handleSaveV7 = useCallback(
    async (updatedDeck: DeckV7): Promise<ActionResult> => {
      // Manual save supersedes any debounced autosave: drop the pending timer so
      // a stale autosave can't fire after we report success (V7-008).
      cancelAutosaveV7();
      return persistDeckV7(updatedDeck);
    },
    [cancelAutosaveV7, persistDeckV7],
  );

  const scheduleAutosaveV7 = useCallback((updatedDeck: DeckV7) => {
    autosaveSchedulerRef.current?.schedule(updatedDeck);
  }, []);

  const focusAfterHistoryV7 = useCallback(
    (fromDeck: DeckV7, toDeck: DeckV7) => {
      const target = pickUndoFocusTarget(fromDeck, toDeck);
      if (target) {
        focusTokenRef.current += 1;
        setUndoRedoFocusV7({ nodeId: target, token: focusTokenRef.current });
      }
    },
    [],
  );

  const handleDeckV7Change = useCallback(
    (updatedDeck: DeckV7) => {
      if (hasUnresolvedDeckSaveConflict(conflictStateV7)) {
        setConflictStateV7(
          updateConflictLocalDeck(conflictStateV7, updatedDeck),
        );
        setDeckV7(updatedDeck);
        setV7Dirty(true);
        setV7SaveError(SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE);
        return;
      }
      setUndoStackV7((stack) =>
        deckV7 ? [...stack, deckV7].slice(-50) : stack,
      );
      setRedoStackV7([]);
      setDeckV7(updatedDeck);
      setV7Dirty(true);
      setV7SaveError(null);
      if (inFlightPersistV7Ref.current) {
        void persistDeckV7(updatedDeck);
      } else {
        scheduleAutosaveV7(updatedDeck);
      }
    },
    [conflictStateV7, deckV7, persistDeckV7, scheduleAutosaveV7],
  );

  const handleUndoV7 = useCallback(() => {
    if (hasUnresolvedDeckSaveConflict(conflictStateV7)) return;
    setUndoStackV7((stack) => {
      const previous = stack.at(-1);
      if (!previous || !deckV7) return stack;
      setRedoStackV7((redoStack) => [...redoStack, deckV7].slice(-50));
      focusAfterHistoryV7(deckV7, previous);
      setDeckV7(previous);
      setV7Dirty(true);
      setV7SaveError(null);
      if (inFlightPersistV7Ref.current) {
        void persistDeckV7(previous);
      } else {
        scheduleAutosaveV7(previous);
      }
      return stack.slice(0, -1);
    });
  }, [
    conflictStateV7,
    deckV7,
    focusAfterHistoryV7,
    persistDeckV7,
    scheduleAutosaveV7,
  ]);

  const handleRedoV7 = useCallback(() => {
    if (hasUnresolvedDeckSaveConflict(conflictStateV7)) return;
    setRedoStackV7((stack) => {
      const next = stack.at(-1);
      if (!next || !deckV7) return stack;
      setUndoStackV7((undoStack) => [...undoStack, deckV7].slice(-50));
      focusAfterHistoryV7(deckV7, next);
      setDeckV7(next);
      setV7Dirty(true);
      setV7SaveError(null);
      if (inFlightPersistV7Ref.current) {
        void persistDeckV7(next);
      } else {
        scheduleAutosaveV7(next);
      }
      return stack.slice(0, -1);
    });
  }, [
    conflictStateV7,
    deckV7,
    focusAfterHistoryV7,
    persistDeckV7,
    scheduleAutosaveV7,
  ]);

  const handleOpenDialogApply = useCallback(
    ({
      deckV7: generatedV7,
      truncated,
      diagnostics,
      options,
    }: {
      deckV7: DeckV7;
      truncated: boolean;
      diagnostics: PresentationDiagnostic[];
      options: DeckGenerationOptions;
    }) => {
      if (!pendingJson) return;
      void showAiPreviewV7(
        generatedV7,
        truncated,
        diagnostics,
        options,
        pendingJson,
      );
    },
    [pendingJson, showAiPreviewV7],
  );

  const handleOpenDialogDerive = useCallback(() => {
    if (!pendingJson) return;
    void openDerivedV7(pendingJson);
  }, [openDerivedV7, pendingJson]);

  const handleOpenDialogClose = useCallback(() => {
    setPendingJson(null);
    setPendingThemePackageId(DEFAULT_THEME_PACKAGE_ID);
    setEmptyDocument(false);
  }, []);

  const handleAiPreviewV7Apply = useCallback(
    (applied: DeckV7, generationDiagnostics: PresentationDiagnostic[]) => {
      if (aiPreviewV7) {
        openWithAiDeckV7(applied, generationDiagnostics);
      }
    },
    [aiPreviewV7, openWithAiDeckV7],
  );

  const handleAiPreviewV7Derive = useCallback(() => {
    if (aiPreviewV7) {
      void openDerivedV7(aiPreviewV7.contentJson);
    }
  }, [aiPreviewV7, openDerivedV7]);

  const handleAiPreviewV7Cancel = useCallback(() => {
    setAiPreviewV7(null);
  }, []);

  const handleConflictKeepMineV7 = useCallback(
    async (localDeck: DeckV7, serverToken: string | null) => {
      const res: SaveDeckResult = await deckPort.saveDeckJson(
        documentId,
        localDeck,
        serverToken,
      );
      if (res.ok === true) {
        lastSavedRef.current = localDeck;
        revisionTokenRef.current = res.revisionToken;
        setConflictStateV7(null);
        setV7Dirty(false);
        setV7Saving(false);
        setV7SaveError(null);
      } else if (res.ok === "conflict") {
        setConflictStateV7({
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

  const handleConflictUseTheirsV7 = useCallback(async () => {
    const reloadResult = await reloadConflictServerDeckV7({
      deckPort,
      documentId,
    });
    if (!reloadResult.ok) {
      logInfo("editor.slide-editor", "v7-conflict-use-server-reload-failed", {
        reason: reloadResult.reason,
      });
      setV7SaveError(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE);
      throw new Error(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE);
    }
    revisionTokenRef.current = reloadResult.revisionToken;
    lastSavedRef.current = reloadResult.deckJson;
    setDeckV7(reloadResult.deck);
    setDeckOpenDiagnosticsV7(reloadResult.diagnostics);
    setDeckOpenErrorV7(null);
    setV7Dirty(false);
    setV7Saving(false);
    setV7SaveError(null);
    setUndoStackV7([]);
    setRedoStackV7([]);
    setUndoRedoFocusV7(null);
    setConflictStateV7(null);
  }, [deckPort, documentId]);

  const handleConflictDismissV7 = useCallback(() => {
    setConflictStateV7(null);
  }, []);

  const saveStatus: SaveStatus = resolveSaveStatus({
    isDirty: v7Dirty,
    isSaving: v7Saving,
    hasError: v7SaveError !== null,
  });

  return {
    open,
    deckV7,
    deckOpenDiagnosticsV7,
    deckOpenErrorV7,
    saveStatus,
    saveStatusLabel: SAVE_STATUS_LABEL[saveStatus],
    saveErrorMessage: resolveSaveErrorMessage(v7SaveError),
    hasUnsavedWork: v7Dirty || v7Saving || v7SaveError !== null,
    setDeckV7,
    handleDeckV7Change,
    handleSaveV7,
    handleUndoV7,
    handleRedoV7,
    undoRedoFocusV7,
    canUndoV7:
      !hasUnresolvedDeckSaveConflict(conflictStateV7) && undoStackV7.length > 0,
    canRedoV7:
      !hasUnresolvedDeckSaveConflict(conflictStateV7) && redoStackV7.length > 0,
    handleOpen,
    handleClose,
    aiEnabled,
    pendingJson,
    pendingThemePackageId,
    emptyDocument,
    handleOpenDialogApply,
    handleOpenDialogDerive,
    handleOpenDialogClose,
    aiPreviewV7,
    handleAiPreviewV7Apply,
    handleAiPreviewV7Derive,
    handleAiPreviewV7Cancel,
    conflictStateV7,
    handleConflictKeepMineV7,
    handleConflictUseTheirsV7,
    handleConflictDismissV7,
  };
}
