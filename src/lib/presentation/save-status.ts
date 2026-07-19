/**
 * Pure, headless helpers for shared slide-editor save-status feedback (issue
 * #208).
 *
 * These mirror the document editor's autosave model (`SaveStatus` /
 * `STATUS_LABEL` in `lexical-editor.tsx`): a debounced autosave persists deck
 * edits a short while after the user stops editing, an explicit Save button
 * flushes immediately, and a status badge reflects the current persistence
 * state. The logic that maps the editor's `dirty` / `saving` / `error` booleans
 * to a single {@link SaveStatus}, and the decision of whether a given deck
 * change should schedule an autosave, are factored out here so legacy and presentation
 * editors can share them without DOM, React or browser dependencies.
 */

/** Save states surfaced to the user by the slide editor. */
export type SaveQueueStatus =
  "idle" | "queued" | "saving" | "retrying" | "offline" | "failed" | "conflict";

export type SaveStatus =
  | "saved"
  | "pending"
  | "queued"
  | "offline"
  | "saving"
  | "retrying"
  | "conflict"
  | "error";

/**
 * User-facing labels for each {@link SaveStatus}. Mirrors the document editor's
 * `STATUS_LABEL`; the error label doubles as the affordance for the Retry
 * action, which re-runs the same save path.
 */
export const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "All changes saved",
  pending: "Unsaved changes…",
  queued: "Saved locally — syncing soon",
  offline: "Offline — changes saved locally",
  saving: "Saving…",
  retrying: "Retrying save…",
  conflict: "Save conflict — resolve to continue",
  error: "Couldn't save — Retry",
};

/** How long to wait after the last deck edit before autosaving. */
export const SLIDE_SAVE_DEBOUNCE_MS = 1500;

/** The editor flags the status badge is derived from. */
export interface SaveStatusInputs {
  /** True once a real user edit has happened and is not yet persisted. */
  isDirty: boolean;
  /** True while a save (autosave or manual flush) is in flight. */
  isSaving: boolean;
  /** True when the last save attempt failed. */
  hasError: boolean;
  /** Durable queued-save state, when the resilient autosave queue is enabled. */
  queueStatus?: SaveQueueStatus;
}

/**
 * Resolves the editor flags into a single {@link SaveStatus}.
 *
 * Precedence mirrors the document editor: a failed save wins (so the Retry
 * affordance stays visible), then an in-flight save, then unsaved edits, and
 * finally the resting "all saved" state.
 */
export function resolveSaveStatus({
  isDirty,
  isSaving,
  hasError,
  queueStatus,
}: SaveStatusInputs): SaveStatus {
  if (queueStatus === "conflict") {
    return "conflict";
  }
  if (queueStatus === "offline") {
    return "offline";
  }
  if (queueStatus === "retrying") {
    return "retrying";
  }
  if (queueStatus === "failed") {
    return "error";
  }
  if (queueStatus === "saving") {
    return "saving";
  }
  if (queueStatus === "queued") {
    return "queued";
  }
  if (hasError) {
    return "error";
  }
  if (isSaving) {
    return "saving";
  }
  if (isDirty) {
    return "pending";
  }
  return "saved";
}

/** Inputs to the autosave scheduling decision. */
export interface AutosaveDecisionInputs<TDeck = unknown> {
  /** The deck the editor is currently showing. */
  current: TDeck;
  /**
   * The last deck the editor observed, or `null` before any has been seen.
   * `null` means this is the initial load / first render.
   */
  lastSeen: TDeck | null;
}

/**
 * Decides whether a deck change should schedule an autosave.
 *
 * The slide editor's deck only changes reference on a genuine user action
 * (mutation, undo, redo or an applied document sync) — the initial load,
 * slide rebuilding and the non-blocking staleness banner never
 * produce a new reference here. So a `null` `lastSeen` (initial render) is never
 * autosaved, and an unchanged reference is a no-op; only a new reference is a
 * real edit worth persisting.
 */
export function shouldScheduleAutosave<TDeck>({
  current,
  lastSeen,
}: AutosaveDecisionInputs<TDeck>): boolean {
  if (lastSeen === null) {
    return false;
  }
  return current !== lastSeen;
}

/**
 * Returns the user-facing message for the save-status error area.
 *
 * When the server returned a specific reason (e.g. "Deck is too large to
 * save.") that message is surfaced directly so the user knows whether Retry
 * can actually succeed. Falls back to the generic {@link SAVE_STATUS_LABEL}
 * entry when no server message is available (e.g. a network error).
 */
export function resolveSaveErrorMessage(
  serverMessage: string | null | undefined,
): string {
  const trimmed = serverMessage?.trim();
  return trimmed ? trimmed : SAVE_STATUS_LABEL.error;
}

/**
 * Decides whether a flushed save should actually hit the network.
 *
 * The deck changes reference on every action (mutation, undo, redo, applied
 * sync), but some of those produce an identical serialization to what was last
 * persisted — e.g. an edit followed by an undo back to the saved state. Because
 * autosave re-serializes and POSTs the *entire* deck (including inlined base64
 * images, issue #247), suppressing these no-op writes avoids repeated multi-MB
 * network writes that change nothing.
 *
 * Returns `true` only when `nextSerialized` differs from `prevSerialized` (the
 * last successfully saved payload). A `null` `prevSerialized` means nothing has
 * been saved yet, so the change must be persisted. This never suppresses a real
 * edit: any genuine content change alters the serialization.
 */
export function shouldPersist(
  prevSerialized: string | null,
  nextSerialized: string,
): boolean {
  return prevSerialized !== nextSerialized;
}
