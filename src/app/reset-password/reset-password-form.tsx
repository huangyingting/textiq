"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ReactNode } from "react";

import {
  AuthField,
  AuthMessage,
  AuthSubmitButton,
} from "@/components/auth/auth-form";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import {
  initialResetPasswordState,
  type ResetPasswordState,
} from "@/lib/auth/form-state";
import { useOwnedFormAction } from "@/lib/actions/use-owned-form-action";

import { resetPassword } from "./actions";

const initialState: ResetPasswordState = initialResetPasswordState;

export type ResetPasswordViewProps = {
  token: string;
  state: ResetPasswordState;
  formAction: (payload: FormData) => void;
  isPending: boolean;
};

/**
 * Pure state -> markup decision for {@link ResetPasswordForm} (issue #1927).
 *
 * Given the token and current action-result state, decides whether to
 * render the success panel or the token-carrying form, and which error
 * message (if any) accompanies it. Extracted from the component body so the
 * state transitions and token wiring are unit-testable without exercising
 * `useActionState`, which requires a live action dispatch to change state.
 */
export function renderResetPasswordView({
  token,
  state,
  formAction,
  isPending,
}: ResetPasswordViewProps): ReactNode {
  if (state.status === "success") {
    return (
      <div className="flex w-full flex-col gap-4">
        <AuthMessage kind="status">
          Your password has been reset. You can now log in with your new
          password.
        </AuthMessage>
        <Link
          href="/login"
          className="flex h-11 items-center justify-center rounded-ds-pill bg-ds-accent px-6 text-sm font-medium text-ds-text-on-accent transition hover:bg-ds-accent-hover"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      <AuthField
        id="newPassword"
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
      />

      <AuthField
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        placeholder="Re-enter your new password"
      />

      {state.status === "error" ? (
        <AuthMessage kind="error">{state.message}</AuthMessage>
      ) : null}

      <AuthSubmitButton isPending={isPending} pendingLabel="Resetting…">
        Reset password
      </AuthSubmitButton>

      <p className="text-center text-sm text-ds-text-secondary">
        <Link
          href="/login"
          className="font-medium text-ds-accent underline-offset-4 hover:underline"
        >
          Back to log in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  return <ResetPasswordFormForToken key={token} token={token} />;
}

/** Owns action state and submission claims for exactly one reset token. */
function ResetPasswordFormForToken({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(
    resetPassword,
    initialState,
  );
  const { guardedAction } = useOwnedFormAction({
    action: formAction,
    isPending,
    terminal: state.status === "success",
  });

  return renderResetPasswordView({
    token,
    state,
    formAction: guardedAction,
    isPending,
  });
}
