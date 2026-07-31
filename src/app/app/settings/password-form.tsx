"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ReactNode } from "react";

import {
  AuthField,
  AuthMessage,
  AuthSubmitButton,
} from "@/components/auth/auth-form";
import type { PasswordResult } from "@/lib/auth/form-state";

import { changePassword } from "./actions";

const initialState: PasswordResult | null = null;

export type PasswordFormViewProps = {
  hasPassword: boolean;
  state: PasswordResult | null;
  formAction: (payload: FormData) => void;
  isPending: boolean;
};

/**
 * Pure state -> markup decision for {@link PasswordForm} (issue #1928).
 *
 * Given `hasPassword` and the current action-result state, decides whether
 * to render the current-password field or the Google-only explanatory note,
 * and which success/error message (if any) accompanies the form. Extracted
 * from the component body so the field wiring and state transitions are
 * unit-testable without exercising `useActionState`, which requires a live
 * action dispatch to change state. Returns only the form's interior; the
 * `<form>` element itself stays in {@link PasswordForm} so its `ref` is never
 * threaded through a plain function call (see `react-hooks/refs`).
 */
export function renderPasswordFormView({
  hasPassword,
  state,
  isPending,
}: PasswordFormViewProps): ReactNode {
  const submitLabel = hasPassword ? "Update password" : "Set password";

  return (
    <>
      {hasPassword ? (
        <AuthField
          id="settings-current-password"
          name="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          aria-label="Current password"
        />
      ) : (
        <p className="rounded-lg bg-ds-surface-sunken p-3 text-sm text-ds-text-secondary">
          You signed in with Google. Set a password to also sign in with your
          email and password.
        </p>
      )}

      <AuthField
        id="settings-new-password"
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        aria-label="New password"
        hint="Use at least 8 characters."
      />

      <AuthField
        id="settings-confirm-password"
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        aria-label="Confirm new password"
      />

      <p className="text-xs text-ds-text-secondary">
        For security, you&apos;ll be signed out after this change.
      </p>

      {state?.ok ? (
        <AuthMessage kind="success">
          {hasPassword ? "Password updated." : "Password set."}
        </AuthMessage>
      ) : null}
      {state && !state.ok ? (
        <AuthMessage kind="error">{state.error}</AuthMessage>
      ) : null}

      <div>
        <AuthSubmitButton isPending={isPending} pendingLabel="Saving…">
          {submitLabel}
        </AuthSubmitButton>
      </div>
    </>
  );
}

/**
 * The change-password form: verifies the current password and sets a new one
 * via the `changePassword` server action.
 *
 * When the account has no password yet (Google-only sign-in) it renders a
 * "set a password" variant — the current-password field is hidden and an
 * explanatory note is shown. On success the password fields are cleared so the
 * typed secrets don't linger in the DOM.
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, formAction, isPending] = useActionState(
    changePassword,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex w-full flex-col gap-4"
    >
      {renderPasswordFormView({ hasPassword, state, formAction, isPending })}
    </form>
  );
}
