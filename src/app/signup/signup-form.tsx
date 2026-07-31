"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  AuthField,
  AuthMessage,
  AuthSubmitButton,
} from "@/components/auth/auth-form";

import { register } from "./actions";

// coverage-breadth: mapped-e2e ref=e2e/ui-matrix/auth-public-ui.spec.ts
export function SignupForm({ callbackUrl }: { callbackUrl: string }) {
  const [errorMessage, formAction, isPending] = useActionState(
    register,
    undefined,
  );

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
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
        placeholder="Ada Lovelace"
      />

      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
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
