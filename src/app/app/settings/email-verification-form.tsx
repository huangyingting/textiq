"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import { AuthMessage, AuthSubmitButton } from "@/components/auth/auth-form";
import { useOwnedFormAction } from "@/lib/actions/use-owned-form-action";
import type { VerifyEmailResult } from "@/lib/auth/form-state";

import { requestEmailVerification } from "./actions";

const initialState: VerifyEmailResult | null = null;

export type EmailVerificationViewProps = {
  state: VerifyEmailResult | null;
  formAction: (payload: FormData) => void;
  isPending: boolean;
};

/**
 * Pure state -> markup decision for {@link EmailVerificationForm}
 * (issue #1928).
 *
 * Given the current action-result state, decides which of the "sent",
 * "already verified", or error message (if any) accompanies the submit
 * button. Extracted from the component body so the state transitions are
 * unit-testable without exercising `useActionState`, which requires a live
 * action dispatch to change state.
 */
export function renderEmailVerificationView({
  state,
  formAction,
  isPending,
}: EmailVerificationViewProps): ReactNode {
  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <div>
        <AuthSubmitButton isPending={isPending} pendingLabel="Sending…">
          Send verification email
        </AuthSubmitButton>
      </div>

      {state?.ok && state.data.status === "sent" ? (
        <AuthMessage kind="success">
          Verification email sent. Check your inbox for the link.
        </AuthMessage>
      ) : null}
      {state?.ok && state.data.status === "already_verified" ? (
        <AuthMessage kind="success">
          Your email is already verified.
        </AuthMessage>
      ) : null}
      {state && !state.ok ? (
        <AuthMessage kind="error">{state.error}</AuthMessage>
      ) : null}
    </form>
  );
}

/**
 * The "Verify email" affordance: an unverified user requests a verification
 * link via the `requestEmailVerification` server action. Rendered only when the
 * email is not yet verified (the parent shows a verified badge instead).
 */
export function EmailVerificationForm() {
  const [state, formAction, isPending] = useActionState(
    requestEmailVerification,
    initialState,
  );
  const { guardedAction } = useOwnedFormAction({
    action: formAction,
    isPending,
  });

  return renderEmailVerificationView({
    state,
    formAction: guardedAction,
    isPending,
  });
}
