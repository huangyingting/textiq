"use client";

import { useRef, useState, type FormEvent } from "react";

import {
  MAX_SHARE_PASSCODE_LENGTH,
  MIN_SHARE_PASSCODE_LENGTH,
} from "@/lib/share-passcode-policy";

type PasscodeGateMode = "view" | "embed" | "present";

export function SharePasscodeGate({
  shareId,
  mode,
  returnTo,
  error,
}: {
  shareId: string;
  mode: PasscodeGateMode;
  returnTo: string;
  error?: "invalid" | "limited";
}) {
  const submissionClaimedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submissionClaimedRef.current) {
      event.preventDefault();
      return;
    }

    submissionClaimedRef.current = true;
    setSubmitting(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ds-surface-sunken px-4 py-10">
      <section className="w-full max-w-sm rounded-lg border border-ds-border-subtle bg-ds-surface-base p-6 shadow-ds-raised">
        <h1 className="text-lg font-semibold text-ds-text-primary">
          Passcode required
        </h1>
        <p className="mt-2 text-sm text-ds-text-secondary">
          Enter the passcode from the link owner to open this shared document.
        </p>
        <form
          method="post"
          action="/api/share-passcode/unlock"
          aria-busy={submitting}
          onSubmit={handleSubmit}
          className="mt-5 space-y-3"
        >
          <input type="hidden" name="shareId" value={shareId} />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="block text-sm font-medium text-ds-text-secondary">
            Passcode
            <input
              name="passcode"
              type="password"
              required
              minLength={MIN_SHARE_PASSCODE_LENGTH}
              maxLength={MAX_SHARE_PASSCODE_LENGTH}
              autoComplete="current-password"
              readOnly={submitting}
              className="mt-1 w-full rounded-md border border-ds-border-subtle bg-ds-surface-sunken px-3 py-2 text-sm text-ds-text-primary outline-none focus:border-ds-border-strong"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-ds-danger">
              {error === "limited"
                ? "Too many attempts. Please wait and try again."
                : "Incorrect passcode. Please try again."}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-ds-accent px-3 py-2 text-sm font-semibold text-ds-text-on-accent hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </section>
    </main>
  );
}
