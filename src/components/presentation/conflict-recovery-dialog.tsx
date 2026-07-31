"use client";

/**
 * Save-conflict recovery dialog for presentation decks.
 *
 * Surfaces when a {@link Deck} autosave returns `{ ok: "conflict" }`.
 * Carries a Deck snapshot so the caller can force-save it directly.
 *
 * Recovery paths:
 * 1. **Keep mine** — re-saves the local presentation snapshot with the server's token.
 * 2. **Use theirs** — discards local changes and reloads the server deck.
 * 3. **Dismiss** — closes the dialog while leaving unsaved changes in place.
 */

import { AlertTriangle, RefreshCw, Save, Trash2 } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import { cx } from "@/components/ui/tokens";
import { CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE } from "@/lib/presentation/conflict-recovery-reload";
import type { Deck } from "@/lib/presentation/schema";

export interface ConflictRecoveryDialogProps {
  open: boolean;
  localDeck: Deck;
  serverRevisionToken: string | null;
  onKeepMine: (
    localDeck: Deck,
    serverRevisionToken: string | null,
  ) => Promise<void>;
  onUseTheirs: () => Promise<void>;
  onDismiss: () => void;
}

type ConflictOperation = "keep-mine" | "use-theirs";

export async function resolveConflictOperation(
  operation: () => Promise<void>,
  fallbackError: string,
): Promise<string | null> {
  try {
    await operation();
    return null;
  } catch (error) {
    unstable_rethrow(error);
    return fallbackError;
  }
}

export function ConflictRecoveryDialog({
  open,
  localDeck,
  serverRevisionToken,
  onKeepMine,
  onUseTheirs,
  onDismiss,
}: ConflictRecoveryDialogProps) {
  const headingId = useId();
  const operationRef = useRef<ConflictOperation | null>(null);
  const [operation, setOperation] = useState<ConflictOperation | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isWorking = operation !== null;

  async function runOperation(
    nextOperation: ConflictOperation,
    action: () => Promise<void>,
    fallbackError: string,
  ) {
    if (operationRef.current) return;
    operationRef.current = nextOperation;
    setOperation(nextOperation);
    setSaveError(null);
    try {
      const error = await resolveConflictOperation(action, fallbackError);
      if (error) setSaveError(error);
    } finally {
      operationRef.current = null;
      setOperation(null);
    }
  }

  async function handleKeepMine() {
    await runOperation(
      "keep-mine",
      () => onKeepMine(localDeck, serverRevisionToken),
      "Couldn't save your version. Check your connection and retry.",
    );
  }

  async function handleUseTheirs() {
    await runOperation(
      "use-theirs",
      onUseTheirs,
      CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
    );
  }

  return (
    <Dialog
      open={open}
      onClose={isWorking ? () => undefined : onDismiss}
      aria-labelledby={headingId}
      aria-busy={isWorking}
      className="max-w-sm"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 shrink-0 text-amber-500"
            size={20}
            aria-hidden
          />
          <div className="flex flex-col gap-1">
            <h2
              id={headingId}
              className="text-sm font-semibold leading-snug text-[--ds-text]"
            >
              Save conflict detected
            </h2>
            <p className="text-xs text-[--ds-text-subtle]">
              Another session saved this deck after you last loaded it. Choose
              how to resolve the conflict.
            </p>
          </div>
        </div>

        {saveError && (
          <div
            role="alert"
            className="flex items-start justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400"
          >
            <span>{saveError}</span>
            <button
              type="button"
              aria-label="Dismiss conflict error"
              onClick={() => setSaveError(null)}
              className="shrink-0 rounded px-1 font-medium hover:bg-red-100 dark:hover:bg-red-950/70"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button
            variant="solid"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => void handleKeepMine()}
            disabled={isWorking}
          >
            <Save size={14} aria-hidden />
            {operation === "keep-mine" ? "Saving…" : "Keep my version"}
          </Button>

          <Button
            variant="subtle"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => void handleUseTheirs()}
            disabled={isWorking}
          >
            <RefreshCw size={14} aria-hidden />
            {operation === "use-theirs" ? "Reloading…" : "Use server version"}
          </Button>

          <button
            type="button"
            className={cx(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
              "text-[--ds-text-subtle] hover:text-[--ds-text] transition-colors",
            )}
            onClick={onDismiss}
            disabled={isWorking}
          >
            <Trash2 size={12} aria-hidden className="shrink-0" />
            Dismiss — keep editing (conflict may recur)
          </button>
        </div>
      </div>
    </Dialog>
  );
}
