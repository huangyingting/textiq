"use client";

import { useState, useTransition } from "react";

import { Dialog } from "@/components/ui/dialog";

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

function RestoreConfirmDialog({
  title,
  onCancel,
  onConfirm,
  isPending,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      aria-labelledby="restore-document-title"
      className="max-w-sm"
    >
      <h2
        id="restore-document-title"
        className="text-base font-semibold text-ds-text-primary"
      >
        Restore document?
      </h2>
      <p className="mt-2 text-sm text-ds-text-secondary">
        <span className="font-medium text-ds-text-primary">
          &ldquo;{title}&rdquo;
        </span>{" "}
        will be moved back to your dashboard.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="flex h-9 items-center justify-center rounded-full border border-ds-border-strong px-4 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="flex h-9 items-center justify-center rounded-full bg-ds-accent px-4 text-sm font-medium text-ds-text-on-accent transition hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? "Restoring…" : "Restore"}
        </button>
      </div>
    </Dialog>
  );
}

function PermanentDeleteConfirmDialog({
  title,
  onCancel,
  onConfirm,
  isPending,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      aria-labelledby="perm-delete-document-title"
      className="max-w-sm"
    >
      <h2
        id="perm-delete-document-title"
        className="text-base font-semibold text-ds-text-primary"
      >
        Permanently delete?
      </h2>
      <p className="mt-2 text-sm text-ds-text-secondary">
        <span className="font-medium text-ds-text-primary">
          &ldquo;{title}&rdquo;
        </span>{" "}
        will be permanently removed and cannot be recovered.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="flex h-9 items-center justify-center rounded-full border border-ds-border-strong px-4 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="flex h-9 items-center justify-center rounded-full bg-ds-danger px-4 text-sm font-medium text-ds-text-on-accent transition hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
    </Dialog>
  );
}

function TrashRow({ doc }: { doc: TrashDocumentData }) {
  const [visible, setVisible] = useState(true);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!visible) return null;

  const handleRestore = () => {
    startTransition(async () => {
      await restoreDocument(doc.id);
      setRestoreOpen(false);
      setVisible(false);
    });
  };

  const handlePermanentDelete = () => {
    startTransition(async () => {
      await permanentDeleteDocument(doc.id);
      setDeleteOpen(false);
      setVisible(false);
    });
  };

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
          type="button"
          aria-label={`Restore ${doc.title}`}
          onClick={() => setRestoreOpen(true)}
          disabled={isPending}
          className="flex h-8 items-center justify-center rounded-full border border-ds-border-strong px-3 text-xs font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary disabled:opacity-60"
        >
          Restore
        </button>
        <button
          type="button"
          aria-label={`Permanently delete ${doc.title}`}
          onClick={() => setDeleteOpen(true)}
          disabled={isPending}
          className="flex h-8 items-center justify-center rounded-full border border-ds-danger/30 px-3 text-xs font-medium text-ds-danger transition hover:bg-ds-danger/10 disabled:opacity-60"
        >
          Delete permanently
        </button>
      </div>

      {restoreOpen && (
        <RestoreConfirmDialog
          title={doc.title}
          onCancel={() => setRestoreOpen(false)}
          onConfirm={handleRestore}
          isPending={isPending}
        />
      )}
      {deleteOpen && (
        <PermanentDeleteConfirmDialog
          title={doc.title}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handlePermanentDelete}
          isPending={isPending}
        />
      )}
    </li>
  );
}

export function TrashList({ documents }: { documents: TrashDocumentData[] }) {
  if (documents.length === 0) {
    return (
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
        <p className="mt-1 text-xs text-ds-text-secondary/60">
          Deleted documents appear here for 30 days.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {documents.map((doc) => (
        <TrashRow key={doc.id} doc={doc} />
      ))}
    </ul>
  );
}
