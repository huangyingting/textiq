"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ReactNode } from "react";

import {
  AuthField,
  AuthMessage,
  AuthSubmitButton,
} from "@/components/auth/auth-form";
import {
  initialForgotPasswordState,
  type ForgotPasswordState,
} from "@/lib/auth/form-state";

import { requestPasswordReset } from "./actions";

const initialState: ForgotPasswordState = initialForgotPasswordState;

export type ForgotPasswordViewProps = {
  state: ForgotPasswordState;
  formAction: (payload: FormData) => void;
  isPending: boolean;
};

/**
 * Pure state -> markup decision for {@link ForgotPasswordForm} (issue #1927).
 *
 * Given the current action-result state, decides whether to render the
 * "sent" confirmation panel or the request form, and which status/error
 * message (if any) accompanies it. Extracted from the component body so the
 * state transitions are unit-testable without exercising `useActionState`,
 * which requires a live action dispatch to change state.
 */
export function renderForgotPasswordView({
  state,
  formAction,
  isPending,
}: ForgotPasswordViewProps): ReactNode {
  if (state.status === "sent") {
    return (
      <div className="flex w-full flex-col gap-4">
        <AuthMessage kind="status">{state.message}</AuthMessage>
        <p className="text-center text-sm text-ds-text-secondary">
          <Link
            href="/login"
            className="font-medium text-ds-accent underline-offset-4 hover:underline"
          >
            Back to log in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
      />

      {state.status === "error" ? (
        <AuthMessage kind="error">{state.message}</AuthMessage>
      ) : null}

      <AuthSubmitButton isPending={isPending} pendingLabel="Sending…">
        Send reset link
      </AuthSubmitButton>

      <p className="text-center text-sm text-ds-text-secondary">
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-medium text-ds-accent underline-offset-4 hover:underline"
        >
          Log in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordReset,
    initialState,
  );

  return renderForgotPasswordView({ state, formAction, isPending });
}
