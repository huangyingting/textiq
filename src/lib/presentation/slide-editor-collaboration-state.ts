import type { Deck } from "./schema";

export const SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE =
  "Save conflict: resolve the collaboration conflict before autosaving.";

export interface SlideEditorConflictState {
  localDeck: Deck;
  serverRevisionToken: string | null;
}

export function hasUnresolvedDeckSaveConflict(
  conflictState: SlideEditorConflictState | null,
): conflictState is SlideEditorConflictState {
  return conflictState !== null;
}

export function updateConflictLocalDeck(
  conflictState: SlideEditorConflictState,
  localDeck: Deck,
): SlideEditorConflictState {
  return {
    ...conflictState,
    localDeck,
  };
}
