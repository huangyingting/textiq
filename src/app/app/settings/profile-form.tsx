"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import type { ProfileResult } from "@/lib/auth/form-state";
import { useOwnedFormAction } from "@/lib/actions/use-owned-form-action";

import { updateProfile } from "./actions";

const initialState: ProfileResult | null = null;

const fieldClass =
  "h-11 rounded-lg border border-ds-border-strong bg-ds-surface-base px-3 text-sm text-ds-text-primary outline-none transition focus:border-ds-accent focus:ring-2 focus:ring-ds-accent/30";

const labelClass = "text-sm font-medium text-ds-text-primary";

export type ProfileFormViewProps = {
  initialName: string;
  email: string;
  state: ProfileResult | null;
  formAction: (payload: FormData) => void;
  isPending: boolean;
};

/**
 * Pure state -> markup decision for {@link ProfileForm} (issue #1928).
 *
 * Given the read-only email, the display-name default, and the current
 * action-result state, decides which success/error message (if any)
 * accompanies the form and whether the submit button is disabled. Extracted
 * from the component body so the field wiring and state transitions are
 * unit-testable without exercising `useActionState`, which requires a live
 * action dispatch to change state.
 */
export function renderProfileFormView({
  initialName,
  email,
  state,
  formAction,
  isPending,
}: ProfileFormViewProps): ReactNode {
  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="settings-email" className={labelClass}>
          Email
        </label>
        <input
          id="settings-email"
          type="email"
          value={email}
          readOnly
          disabled
          aria-label="Email"
          className={`${fieldClass} cursor-not-allowed text-ds-text-secondary opacity-70`}
        />
        <p className="text-xs text-ds-text-secondary">
          Your email address can&apos;t be changed.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="settings-name" className={labelClass}>
          Display name
        </label>
        <input
          id="settings-name"
          name="name"
          type="text"
          maxLength={100}
          defaultValue={initialName}
          autoComplete="name"
          disabled={isPending}
          aria-label="Display name"
          placeholder="Your name"
          className={fieldClass}
        />
        <p className="text-xs text-ds-text-secondary">
          Shown in the header and across the app. Leave blank to use your email.
        </p>
      </div>

      {state?.ok ? (
        <p role="status" className="text-sm text-ds-success">
          Profile updated.
        </p>
      ) : null}
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-ds-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="flex h-11 items-center justify-center rounded-full bg-ds-accent px-6 text-sm font-medium text-ds-text-on-accent transition hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

/**
 * The account profile form: edits the current user's display name via the
 * `updateProfile` server action. The email is shown read-only (it can't be
 * changed here). The display-name input is uncontrolled (`defaultValue`) so it
 * keeps the typed value after saving; a reload re-reads the fresh name from the
 * database.
 */
export function ProfileForm({
  initialName,
  email,
}: {
  initialName: string;
  email: string;
}) {
  const [state, formAction, isPending] = useActionState(
    updateProfile,
    initialState,
  );
  const { guardedAction } = useOwnedFormAction({
    action: formAction,
    isPending,
  });

  return renderProfileFormView({
    initialName,
    email,
    state,
    formAction: guardedAction,
    isPending,
  });
}
