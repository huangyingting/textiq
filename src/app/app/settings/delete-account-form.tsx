"use client";

import { useActionState, useRef, useState } from "react";

import { ActionButton, FormField, ModalSurface } from "@/components/ui";
import type { ActionDescriptor } from "@/lib/actions/action-descriptor";
import type { DeleteAccountResult } from "@/lib/auth/form-state";

import { deleteAccount } from "./actions";

const initialState: DeleteAccountResult | null = null;

/** Literal keyword accepted as a confirmation alternative to the email. */
const DELETE_KEYWORD = "DELETE";

export type DeleteAccountConfirmationState = {
  /** Whether the typed confirmation matches the email (case-insensitively) or the literal DELETE keyword. */
  canSubmit: boolean;
  /** Descriptor for the dialog's "Delete account" open trigger. */
  openAction: ActionDescriptor;
  /** Descriptor for the dialog's "Cancel" button. */
  cancelAction: ActionDescriptor;
  /** Descriptor for the dialog's destructive confirm button. */
  confirmAction: ActionDescriptor;
};

/**
 * Pure confirmation-safeguard decision for {@link DeleteAccountForm}
 * (issue #1928).
 *
 * Given the account email, the currently typed confirmation text, and
 * whether a delete request is in flight, decides whether the destructive
 * confirm button may be enabled and derives the three action descriptors
 * (open/cancel/confirm) — including their labels and `disabledReason`
 * guidance — that gate the irreversible action. Extracted from the
 * component body so the confirmation-matching and pending-lockout logic is
 * unit-testable independent of the portaled `ModalSurface`, which requires a
 * live `document` to render.
 */
export function computeDeleteAccountConfirmation({
  email,
  confirmation,
  isPending,
}: {
  email: string;
  confirmation: string;
  isPending: boolean;
}): DeleteAccountConfirmationState {
  const trimmed = confirmation.trim();
  const canSubmit =
    trimmed.toLowerCase() === email.trim().toLowerCase() ||
    trimmed === DELETE_KEYWORD;

  const openAction: ActionDescriptor = {
    id: "settings.delete-account.open",
    label: "Delete account",
    description: "Open account deletion confirmation",
  };
  const cancelAction: ActionDescriptor = {
    id: "settings.delete-account.cancel",
    label: "Cancel",
    disabledReason: isPending ? "Account deletion is in progress" : undefined,
  };
  const confirmAction: ActionDescriptor = {
    id: "settings.delete-account.confirm",
    label: isPending ? "Deleting…" : "Delete account",
    disabledReason: !canSubmit
      ? "Type your email address or DELETE to confirm"
      : isPending
        ? "Account deletion is in progress"
        : undefined,
  };

  return { canSubmit, openAction, cancelAction, confirmAction };
}

/**
 * The Danger zone control: a "Delete account" button that opens a confirmation
 * dialog requiring the user to type their exact email address (or the literal
 * word "DELETE") before the account is permanently removed.
 *
 * The confirm button is guarded client-side (disabled until the typed value
 * matches), and the server action re-validates the confirmation independently.
 * Submitting calls `deleteAccount`, which signs the user out and redirects to
 * the marketing home on success (so this component simply unmounts); an error
 * keeps the dialog open with a `role="alert"` message.
 *
 * The dialog is portaled to `document.body` (per AGENTS.md) so it escapes the
 * settings card's stacking context.
 */
export function DeleteAccountForm({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [state, formAction, isPending] = useActionState(
    deleteAccount,
    initialState,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const { canSubmit, openAction, cancelAction, confirmAction } =
    computeDeleteAccountConfirmation({ email, confirmation, isPending });

  const close = () => {
    if (isPending) {
      return;
    }
    setOpen(false);
    setConfirmation("");
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ds-text-secondary">
        Permanently delete your account and everything in it — your documents,
        visuals, comments, and workspaces you own. This can&apos;t be undone.
      </p>
      <div>
        <ActionButton
          action={openAction}
          onClick={() => setOpen(true)}
          className="flex h-11 items-center justify-center rounded-full border border-ds-danger/40 px-6 text-sm font-medium text-ds-danger transition hover:bg-ds-danger/10"
        >
          Delete account
        </ActionButton>
      </div>

      <ModalSurface
        open={open}
        onClose={close}
        aria-labelledby="delete-account-title"
        className="max-w-md border-ds-border-strong"
      >
        <form action={formAction} className="flex flex-col gap-4">
          <h2
            id="delete-account-title"
            className="text-base font-semibold text-ds-text-primary"
          >
            Delete account?
          </h2>
          <p className="text-sm text-ds-text-secondary">
            This permanently deletes your account and all of your documents,
            visuals, comments, and owned workspaces. This action cannot be
            undone.
          </p>

          <FormField
            htmlFor="delete-account-confirm"
            label={
              <>
                Type{" "}
                <span className="font-semibold text-ds-text-primary">
                  {email}
                </span>{" "}
                to confirm
              </>
            }
          >
            <input
              id="delete-account-confirm"
              ref={inputRef}
              name="confirmation"
              type="text"
              autoComplete="off"
              spellCheck={false}
              aria-label="Confirm account deletion"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={email}
              className="h-11 rounded-lg border border-ds-border-strong bg-ds-surface-base px-3 text-sm text-ds-text-primary outline-none transition focus:border-ds-accent focus:ring-2 focus:ring-ds-accent/30"
            />
          </FormField>

          {state && !state.ok ? (
            <p role="alert" className="text-sm text-ds-danger">
              {state.error}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-3">
            <ActionButton
              action={cancelAction}
              onClick={close}
              disabled={isPending}
              className="flex h-9 items-center justify-center rounded-full border border-ds-border-strong px-4 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary disabled:opacity-60"
            >
              Cancel
            </ActionButton>
            <ActionButton
              action={confirmAction}
              type="submit"
              disabled={!canSubmit || isPending}
              className="flex h-9 items-center justify-center rounded-full bg-ds-danger px-4 text-sm font-medium text-ds-text-on-accent transition hover:opacity-90 disabled:opacity-60"
            >
              {isPending ? "Deleting…" : "Delete account"}
            </ActionButton>
          </div>
        </form>
      </ModalSurface>
    </div>
  );
}
