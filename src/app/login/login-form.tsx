"use client";

import Link from "next/link";
import { useActionState, useState, type ChangeEventHandler } from "react";

import {
  AuthField,
  AuthMessage,
  AuthSubmitButton,
} from "@/components/auth/auth-form";

import { authenticate } from "./actions";

// coverage-breadth: mapped-e2e ref=e2e/auth/oauth-disabled.spec.ts
export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [errorMessage, formAction, isPending] = useActionState(
    authenticate,
    undefined,
  );
  const [email, setEmail] = useState("");

  return renderLoginFormView({
    callbackUrl,
    errorMessage,
    formAction,
    isPending,
    email,
    onEmailChange: (event) => setEmail(event.currentTarget.value),
  });
}

export function renderLoginFormView({
  callbackUrl,
  errorMessage,
  formAction,
  isPending,
  email,
  onEmailChange,
}: {
  callbackUrl: string;
  errorMessage: string | undefined;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  email: string;
  onEmailChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={onEmailChange}
      />

      <AuthField
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        placeholder="••••••••"
        labelAccessory={
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-ds-accent underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        }
      />

      {errorMessage ? (
        <AuthMessage kind="error">{errorMessage}</AuthMessage>
      ) : null}

      <AuthSubmitButton isPending={isPending} pendingLabel="Signing in…">
        Log in
      </AuthSubmitButton>

      <p className="text-center text-sm text-ds-text-secondary">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-medium text-ds-accent underline-offset-4 hover:underline"
        >
          Sign up
        </Link>
      </p>
    </form>
  );
}
