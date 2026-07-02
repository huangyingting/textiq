"use client";

/**
 * Save-conflict recovery dialog for presentation decks.
 *
 * Surfaces when a {@link Deck} autosave returns `{ ok: "conflict" }`.
 * Mirrors the v6 {@link ConflictRecoveryDialog} but carries a Deck snapshot
 * so the caller can force-save it directly without coercing to Deck.
 *
 * Recovery paths:
 * 1. **Keep mine** — re-saves the local presentation snapshot with the server's token.
 * 2. **Use theirs** — discards local changes and reloads the server deck.
 * 3. **Dismiss** — closes the dialog while leaving unsaved changes in place.
 */

import { AlertTriangle, RefreshCw, Save, Trash2 } from "lucide-react";
import { useState, useId } from "react";

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

export function ConflictRecoveryDialog({
  open,
  localDeck,
  serverRevisionToken,
  onKeepMine,
  onUseTheirs,
  onDismiss,
}: ConflictRecoveryDialogProps) {
  const headingId = useId();
  const [isSaving, setIsSaving] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isWorking = isSaving || isReloading;

  async function handleKeepMine() {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onKeepMine(localDeck, serverRevisionToken);
    } catch {
      setSaveError(
        "Couldn't save your version. Check your connection and retry.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUseTheirs() {
    setIsReloading(true);
    setSaveError(null);
    try {
      await onUseTheirs();
    } catch {
      setSaveError(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE);
    } finally {
      setIsReloading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onDismiss}
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
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400"
          >
            {saveError}
          </p>
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
            {isSaving ? "Saving…" : "Keep my version"}
          </Button>

          <Button
            variant="subtle"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => void handleUseTheirs()}
            disabled={isWorking}
          >
            <RefreshCw size={14} aria-hidden />
            {isReloading ? "Reloading…" : "Use server version"}
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
