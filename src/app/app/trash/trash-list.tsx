"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";

import { Button, Dialog } from "@/components/ui";

import { restoreDocument } from "../actions";
import { permanentDeleteDocument } from "./actions";

export type TrashDocumentData = {
  id: string;
  title: string;
  deletedAtMs: number;
  remainingMs: number;
};

const deletedAtFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Formats milliseconds remaining as a human-readable string. */
function formatRemaining(ms: number): string {
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h remaining`;
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

type TrashActionKind = "restore" | "permanent-delete";

const ACTION_COPY = {
  restore: {
    title: "Restore document?",
    description: "will be moved back to your dashboard.",
    confirm: "Restore",
    pending: "Restoring…",
    retry: "Try restore again",
    error: "Could not restore the document. Please try again.",
    variant: "solid",
  },
  "permanent-delete": {
    title: "Permanently delete?",
    description: "will be permanently removed and cannot be recovered.",
    confirm: "Delete permanently",
    pending: "Deleting…",
    retry: "Try delete again",
    error: "Could not permanently delete the document. Please try again.",
    variant: "danger",
  },
} as const;

function TrashConfirmDialog({
  kind,
  title,
  onCancel,
  onConfirm,
  onDismissError,
  isPending,
  error,
  restoreFocusRef,
}: {
  kind: TrashActionKind;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  onDismissError: () => void;
  isPending: boolean;
  error: string | null;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  const copy = ACTION_COPY[kind];
  const titleId = `trash-${kind}-title`;

  return (
    <Dialog
      open
      onClose={onCancel}
      restoreFocusRef={restoreFocusRef}
      aria-labelledby={titleId}
      aria-busy={isPending}
      className="max-w-sm"
    >
      <h2 id={titleId} className="text-base font-semibold text-ds-text-primary">
        {copy.title}
      </h2>
      <p className="mt-2 text-sm text-ds-text-secondary">
        <span className="font-medium text-ds-text-primary">
          &ldquo;{title}&rdquo;
        </span>{" "}
        {copy.description}
      </p>
      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
        >
          <p>{error}</p>
          <Button
            variant="plain"
            size="sm"
            onClick={onDismissError}
            className="mt-2"
          >
            Dismiss error
          </Button>
        </div>
      ) : null}
      <div className="mt-6 flex justify-end gap-3">
        <Button
          variant="subtle"
          size="lg"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          variant={copy.variant}
          size="lg"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? copy.pending : error ? copy.retry : copy.confirm}
        </Button>
      </div>
    </Dialog>
  );
}

function TrashRow({
  doc,
  onRemoved,
}: {
  doc: TrashDocumentData;
  onRemoved: (id: string) => void;
}) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<{
    kind: TrashActionKind;
    message: string;
  } | null>(null);
  const [isPending, setIsPending] = useState(false);
  const mountedRef = useRef(true);
  const actionOperationIdRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const restoreTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionOperationIdRef.current += 1;
      actionInFlightRef.current = false;
    };
  }, []);

  const closeDialog = (kind: TrashActionKind) => {
    if (actionInFlightRef.current) return;
    setActionError(null);
    if (kind === "restore") setRestoreOpen(false);
    else setDeleteOpen(false);
  };

  const runAction = async (
    kind: TrashActionKind,
    action: () => Promise<void>,
  ): Promise<void> => {
    if (actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    const operationId = ++actionOperationIdRef.current;
    setActionError(null);
    setIsPending(true);
    try {
      await action();
      if (!mountedRef.current || actionOperationIdRef.current !== operationId) {
        return;
      }
      if (kind === "restore") setRestoreOpen(false);
      else setDeleteOpen(false);
      onRemoved(doc.id);
    } catch (error) {
      unstable_rethrow(error);
      if (!mountedRef.current || actionOperationIdRef.current !== operationId) {
        return;
      }
      setActionError({ kind, message: ACTION_COPY[kind].error });
    } finally {
      if (mountedRef.current && actionOperationIdRef.current === operationId) {
        actionInFlightRef.current = false;
        setIsPending(false);
      }
    }
  };

  const handleRestore = () =>
    runAction("restore", () => restoreDocument(doc.id));
  const handlePermanentDelete = () =>
    runAction("permanent-delete", () => permanentDeleteDocument(doc.id));

  return (
    <li className="flex items-center justify-between gap-4 rounded-xl border border-ds-border-strong bg-ds-surface-base px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ds-text-primary">
          {doc.title}
        </p>
        <p className="mt-0.5 text-xs text-ds-text-secondary">
          Deleted {deletedAtFormatter.format(new Date(doc.deletedAtMs))}
          <span className="mx-1.5 text-ds-text-secondary/40">·</span>
          <span
            className={
              doc.remainingMs <= 24 * 60 * 60 * 1000
                ? "text-ds-danger"
                : "text-ds-text-secondary"
            }
          >
            {formatRemaining(doc.remainingMs)}
          </span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          ref={restoreTriggerRef}
          type="button"
          aria-label={`Restore ${doc.title}`}
          onClick={() => {
            setActionError(null);
            setRestoreOpen(true);
          }}
          disabled={isPending}
          className="flex h-8 items-center justify-center rounded-full border border-ds-border-strong px-3 text-xs font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary disabled:opacity-60"
        >
          Restore
        </button>
        <button
          ref={deleteTriggerRef}
          type="button"
          aria-label={`Permanently delete ${doc.title}`}
          onClick={() => {
            setActionError(null);
            setDeleteOpen(true);
          }}
          disabled={isPending}
          className="flex h-8 items-center justify-center rounded-full border border-ds-danger/30 px-3 text-xs font-medium text-ds-danger transition hover:bg-ds-danger/10 disabled:opacity-60"
        >
          Delete permanently
        </button>
      </div>

      {restoreOpen && (
        <TrashConfirmDialog
          kind="restore"
          title={doc.title}
          onCancel={() => closeDialog("restore")}
          onConfirm={handleRestore}
          onDismissError={() => setActionError(null)}
          isPending={isPending}
          error={actionError?.kind === "restore" ? actionError.message : null}
          restoreFocusRef={restoreTriggerRef}
        />
      )}
      {deleteOpen && (
        <TrashConfirmDialog
          kind="permanent-delete"
          title={doc.title}
          onCancel={() => closeDialog("permanent-delete")}
          onConfirm={handlePermanentDelete}
          onDismissError={() => setActionError(null)}
          isPending={isPending}
          error={
            actionError?.kind === "permanent-delete"
              ? actionError.message
              : null
          }
          restoreFocusRef={deleteTriggerRef}
        />
      )}
    </li>
  );
}

export function TrashList({ documents }: { documents: TrashDocumentData[] }) {
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const regionRef = useRef<HTMLDivElement>(null);
  const visibleDocuments = documents.filter((doc) => !removedIds.has(doc.id));

  const handleRemoved = (id: string) => {
    setRemovedIds((current) => new Set(current).add(id));
    window.requestAnimationFrame(() => regionRef.current?.focus());
  };

  return (
    <div
      ref={regionRef}
      tabIndex={-1}
      aria-label="Trash documents"
      aria-live="polite"
      className="outline-none"
    >
      {visibleDocuments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ds-border-strong bg-ds-surface-base py-16 text-center">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mb-3 h-10 w-10 text-ds-text-secondary/40"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
          <p className="text-sm font-medium text-ds-text-secondary">
            Trash is empty
          </p>
          <p className="mt-1 text-xs text-ds-text-muted">
            Deleted documents appear here for 30 days.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleDocuments.map((doc) => (
            <TrashRow key={doc.id} doc={doc} onRemoved={handleRemoved} />
          ))}
        </ul>
      )}
    </div>
  );
}
