"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";

import { Button, Dialog, MENU_CHROME, MENU_ITEM, cx } from "@/components/ui";
import type { DocumentListActionPort } from "@/lib/action-ports";
import { VisualRenderer } from "@/components/visual/visual-renderer";
import type { Visual } from "@/lib/visual/schema";

import { duplicateDocument, renameDocument, toggleFavorite } from "./actions";

/** Maximum document title length (mirrors the server action's clamp). */
const MAX_TITLE_LENGTH = 200;
const documentCardActions: Pick<
  DocumentListActionPort,
  "duplicateDocument" | "renameDocument" | "toggleFavorite"
> = {
  duplicateDocument,
  renameDocument,
  toggleFavorite,
};

/** Normalizes a title the same way `renameDocument` does, for optimistic UI. */
function normalizeTitle(value: string): string {
  return value.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled";
}

export type DocumentCardData = {
  id: string;
  title: string;
  favorite: boolean;
  editedLabel: string;
  workspaceName: string | null;
  thumbnail: Visual | null;
  excerpt: string;
  readingMinutes: number;
  canEdit: boolean;
  canManage: boolean;
};

type DocumentCardProps = DocumentCardData & {
  onDelete: (data: DocumentCardData) => void;
};

/**
 * The card's preview area. When the document has a visual, it renders the first
 * one via the directive-free {@link VisualRenderer}; otherwise it falls back to
 * a generic file-icon placeholder.
 */
function DocumentThumbnail({ visual }: { visual: Visual | null }) {
  if (visual) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center overflow-hidden bg-ds-surface-sunken p-2 transition group-hover:bg-ds-border-strong/40">
        <VisualRenderer visual={visual} className="h-full w-full" />
      </div>
    );
  }
  return (
    <div className="flex aspect-[16/10] items-center justify-center bg-ds-surface-sunken transition group-hover:bg-ds-border-strong/40">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-8 w-8 text-ds-text-muted"
      >
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
        <path d="M9 13h6" />
        <path d="M9 17h4" />
      </svg>
    </div>
  );
}

/**
 * A star toggle that marks a document as a favorite. It lives in a sibling of
 * the card `<Link>` (not inside it), so clicking it never triggers navigation.
 * The filled state reflects `active`; `aria-pressed` exposes it for testing.
 */
function StarButton({
  active,
  title,
  onToggle,
  disabled,
}: {
  active: boolean;
  title: string;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={active ? `Unfavorite ${title}` : `Favorite ${title}`}
      aria-pressed={active}
      onClick={onToggle}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-full shadow-sm backdrop-blur transition disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? "bg-ds-surface-base/80 text-ds-warning hover:bg-ds-surface-base"
          : "bg-ds-surface-base/80 text-ds-text-secondary hover:bg-ds-surface-base hover:text-ds-warning"
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d="M12 17.27 6.18 21l1.64-7.03L2 9.24l7.19-.61L12 2l2.81 6.63 7.19.61-5.82 4.73L17.82 21z" />
      </svg>
    </button>
  );
}

function DeleteConfirmDialog({
  title,
  onCancel,
  onConfirm,
  restoreFocusRef,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      restoreFocusRef={restoreFocusRef}
      aria-labelledby="delete-document-title"
      className="max-w-sm"
    >
      <h2
        id="delete-document-title"
        className="text-base font-semibold text-ds-text-primary"
      >
        Delete document?
      </h2>
      <p className="mt-2 text-sm text-ds-text-secondary">
        <span className="font-medium text-ds-text-primary">
          &ldquo;{title}&rdquo;
        </span>{" "}
        will be moved to the trash. You can undo this right after.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-9 items-center justify-center rounded-full border border-ds-border-strong px-4 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex h-9 items-center justify-center rounded-full bg-ds-danger px-4 text-sm font-medium text-ds-text-on-accent transition hover:opacity-90 disabled:opacity-60"
        >
          Delete
        </button>
      </div>
    </Dialog>
  );
}

/**
 * A modal for renaming a document, pre-filled with the current title. Submits on
 * Enter or the Rename button; cancels on Escape, backdrop click, or Cancel.
 */
function RenameDialog({
  initialTitle,
  onCancel,
  onSubmit,
  onDismissError,
  isPending,
  error,
  restoreFocusRef,
}: {
  initialTitle: string;
  onCancel: () => void;
  onSubmit: (title: string) => void;
  onDismissError: () => void;
  isPending: boolean;
  error: string | null;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  const [value, setValue] = useState(initialTitle);
  const isEmpty = value.trim().length === 0;

  return (
    <Dialog
      open
      onClose={onCancel}
      restoreFocusRef={restoreFocusRef}
      aria-labelledby="rename-document-title"
      aria-busy={isPending}
      className="max-w-sm"
    >
      <h2
        id="rename-document-title"
        className="text-base font-semibold text-ds-text-primary"
      >
        Rename document
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (isEmpty) {
            return;
          }
          onSubmit(value);
        }}
      >
        <label
          htmlFor="rename-document-input"
          className="mt-4 block text-sm font-medium text-ds-text-primary"
        >
          Title
        </label>
        <input
          id="rename-document-input"
          type="text"
          value={value}
          maxLength={MAX_TITLE_LENGTH}
          aria-label="Document title"
          disabled={isPending}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) onDismissError();
          }}
          className="mt-1.5 w-full rounded-lg border border-ds-border-strong bg-ds-surface-base px-3 py-2 text-sm text-ds-text-primary outline-none transition focus:border-ds-accent focus:ring-2 focus:ring-ds-accent/30"
        />
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
            variant="solid"
            size="lg"
            type="submit"
            disabled={isEmpty || isPending}
          >
            {isPending ? "Renaming…" : error ? "Try rename again" : "Rename"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type DocumentCardActionAttempt =
  | { kind: "favorite"; target: boolean }
  | { kind: "rename"; title: string }
  | { kind: "duplicate" };

const CARD_ACTION_COPY = {
  favorite: {
    error: "Could not update the favorite. Please try again.",
    retry: "Try favorite again",
  },
  rename: {
    error: "Could not rename the document. Please try again.",
    retry: "Try rename again",
  },
  duplicate: {
    error: "Could not duplicate the document. Please try again.",
    retry: "Try duplicate again",
  },
} as const;

/**
 * A dashboard document card: a navigable link plus an overflow (kebab) menu for
 * per-document actions. The kebab button and its dropdown live in a sibling of
 * the `<Link>` (not inside it) so opening the menu never triggers navigation.
 *
 * The menu uses the ref-containment click-outside pattern (per AGENTS.md): the
 * toggle button and the dropdown are both wrapped in `menuRef`, and a document
 * listener closes the menu only for clicks outside that container — no
 * `stopPropagation`, which would be unreliable under the App Router's delegated
 * events.
 *
 * Favorite, Rename, and Duplicate are owned here. One synchronous in-flight
 * guard prevents repeated activation before React commits disabled state;
 * ordinary failures remain local with generic retry/dismiss UI, while Next
 * control-flow errors are rethrown. The dashboard reconciles successful writes
 * via `revalidatePath("/app")`. Deletion is owned by the parent `DocumentList`
 * (which manages optimistic removal and the transient undo affordance):
 * confirming the dialog calls the `onDelete(data)` callback rather than
 * deleting here.
 */
export function DocumentCard({
  id,
  title,
  favorite,
  editedLabel,
  workspaceName,
  thumbnail,
  excerpt,
  readingMinutes,
  canEdit,
  canManage,
  onDelete,
}: DocumentCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [actionError, setActionError] =
    useState<DocumentCardActionAttempt | null>(null);
  const [pendingKind, setPendingKind] = useState<
    DocumentCardActionAttempt["kind"] | null
  >(null);
  const [optimisticTitle, setOptimisticTitle] = useOptimistic(title);
  const [optimisticFavorite, setOptimisticFavorite] = useOptimistic(favorite);
  const [isPending, startTransition] = useTransition();
  const actionInFlightRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpen]);

  const handleConfirmDelete = () => {
    setConfirmOpen(false);
    onDelete({
      id,
      title: optimisticTitle,
      favorite: optimisticFavorite,
      editedLabel,
      workspaceName,
      thumbnail,
      excerpt,
      readingMinutes,
      canEdit,
      canManage,
    });
  };

  const runAction = (
    attempt: DocumentCardActionAttempt,
    action: () => Promise<void>,
    onSuccess?: () => void,
  ) => {
    if (actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    setActionError(null);
    setPendingKind(attempt.kind);
    startTransition(async () => {
      try {
        await action();
        onSuccess?.();
      } catch (error) {
        unstable_rethrow(error);
        setActionError(attempt);
      } finally {
        actionInFlightRef.current = false;
        setPendingKind(null);
      }
    });
  };

  const runFavorite = (target: boolean) => {
    runAction({ kind: "favorite", target }, async () => {
      setOptimisticFavorite(target);
      await documentCardActions.toggleFavorite(id);
    });
  };

  const handleToggleFavorite = () => {
    runFavorite(!optimisticFavorite);
  };

  const runRename = (nextTitle: string) => {
    const normalized = normalizeTitle(nextTitle);
    if (normalized === optimisticTitle) {
      setRenameOpen(false);
      setActionError(null);
      return;
    }

    runAction(
      { kind: "rename", title: nextTitle },
      async () => {
        setOptimisticTitle(normalized);
        await documentCardActions.renameDocument(id, nextTitle);
      },
      () => setRenameOpen(false),
    );
  };

  const runDuplicate = () => {
    setMenuOpen(false);
    runAction({ kind: "duplicate" }, async () => {
      await documentCardActions.duplicateDocument(id);
    });
  };

  const retryAction = () => {
    if (!actionError) return;
    if (actionError.kind === "favorite") {
      runFavorite(actionError.target);
    } else if (actionError.kind === "rename") {
      runRename(actionError.title);
    } else {
      runDuplicate();
    }
  };

  const closeRename = () => {
    if (actionInFlightRef.current) return;
    setActionError(null);
    setRenameOpen(false);
  };

  return (
    <li className="relative">
      <Link
        href={`/app/documents/${id}`}
        className="group flex flex-col overflow-hidden rounded-xl border border-ds-border-strong bg-ds-surface-base transition hover:border-ds-accent/40 hover:shadow-sm"
      >
        <DocumentThumbnail visual={thumbnail} />
        <div className="flex flex-col gap-1 p-4">
          <span className="truncate pr-7 text-sm font-medium text-ds-text-primary">
            {optimisticTitle}
          </span>
          {excerpt ? (
            <p className="line-clamp-2 text-xs text-ds-text-secondary">
              {excerpt}
            </p>
          ) : (
            <p className="text-xs italic text-ds-text-muted">No content yet</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ds-text-secondary">
              Edited {editedLabel}
            </span>
            {readingMinutes > 0 && (
              <>
                <span className="text-xs text-ds-text-muted">·</span>
                <span className="text-xs text-ds-text-secondary">
                  {readingMinutes} min read
                </span>
              </>
            )}
            {workspaceName && (
              <>
                <span className="text-xs text-ds-text-muted">·</span>
                <span className="truncate text-xs text-ds-text-secondary">
                  {workspaceName}
                </span>
              </>
            )}
          </div>
        </div>
      </Link>

      <div className="absolute left-2 top-2 z-raised">
        {canEdit && (
          <StarButton
            active={optimisticFavorite}
            title={optimisticTitle}
            onToggle={handleToggleFavorite}
            disabled={isPending}
          />
        )}
      </div>

      <div ref={menuRef} className="absolute right-2 top-2 z-raised">
        <button
          ref={menuTriggerRef}
          type="button"
          aria-label={`Actions for ${optimisticTitle}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={isPending}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-ds-surface-base/80 text-ds-text-secondary shadow-sm backdrop-blur transition hover:bg-ds-surface-base hover:text-ds-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4"
          >
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </button>

        {menuOpen && (
          <div
            role="menu"
            className={cx(
              "absolute right-0 top-full z-dropdown mt-1 w-40",
              MENU_CHROME,
            )}
          >
            {canEdit && (
              <button
                type="button"
                role="menuitem"
                disabled={isPending}
                onClick={() => {
                  setMenuOpen(false);
                  setActionError(null);
                  setRenameOpen(true);
                }}
                className={MENU_ITEM}
              >
                Rename
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              disabled={isPending}
              onClick={runDuplicate}
              className={MENU_ITEM}
            >
              Duplicate
            </button>
            {canManage && (
              <button
                type="button"
                role="menuitem"
                disabled={isPending}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmOpen(true);
                }}
                className={cx(
                  MENU_ITEM,
                  "text-ds-danger hover:bg-ds-danger-surface hover:text-ds-danger-text",
                )}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {actionError && actionError.kind !== "rename" ? (
        <div
          role="alert"
          className="mt-2 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
        >
          <p>{CARD_ACTION_COPY[actionError.kind].error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="subtle"
              size="sm"
              onClick={retryAction}
              disabled={isPending}
            >
              {CARD_ACTION_COPY[actionError.kind].retry}
            </Button>
            <Button
              variant="plain"
              size="sm"
              onClick={() => setActionError(null)}
              disabled={isPending}
            >
              Dismiss error
            </Button>
          </div>
        </div>
      ) : null}

      {renameOpen && (
        <RenameDialog
          initialTitle={optimisticTitle}
          onCancel={closeRename}
          onSubmit={runRename}
          onDismissError={() => setActionError(null)}
          isPending={pendingKind === "rename"}
          error={
            actionError?.kind === "rename"
              ? CARD_ACTION_COPY.rename.error
              : null
          }
          restoreFocusRef={menuTriggerRef}
        />
      )}

      {confirmOpen && (
        <DeleteConfirmDialog
          title={optimisticTitle}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleConfirmDelete}
          restoreFocusRef={menuTriggerRef}
        />
      )}
    </li>
  );
}
