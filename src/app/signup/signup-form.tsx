"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  AuthField,
  AuthMessage,
  AuthSubmitButton,
} from "@/components/auth/auth-form";
import { useOwnedFormAction } from "@/lib/actions/use-owned-form-action";

import { register } from "./actions";

// coverage-breadth: mapped-e2e ref=e2e/ui-matrix/auth-public-ui.spec.ts
export function SignupForm({ callbackUrl }: { callbackUrl: string }) {
  return <SignupFormForCallback key={callbackUrl} callbackUrl={callbackUrl} />;
}

function SignupFormForCallback({ callbackUrl }: { callbackUrl: string }) {
  const [errorMessage, formAction, isPending] = useActionState(
    register,
    undefined,
  );
  const { guardedAction } = useOwnedFormAction({
    action: formAction,
    isPending,
  });

  return (
    <form action={guardedAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <AuthField
        id="name"
        name="name"
        label={
          <>
            Name <span className="text-ds-text-muted">(optional)</span>
          </>
        }
        type="text"
        autoComplete="name"
        disabled={isPending}
        placeholder="Ada Lovelace"
      />

      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        disabled={isPending}
        placeholder="you@example.com"
      />

      <AuthField
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        disabled={isPending}
        placeholder="At least 8 characters"
      />

      {errorMessage ? (
        <AuthMessage kind="error">{errorMessage}</AuthMessage>
      ) : null}

      <AuthSubmitButton isPending={isPending} pendingLabel="Creating account…">
        Create account
      </AuthSubmitButton>

      <p className="text-center text-sm text-ds-text-secondary">
        Already have an account?{" "}
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
