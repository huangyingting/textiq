import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GoogleSignInSection } from "@/components/google-sign-in-button";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { routeProtectionPolicy } from "@/lib/auth/route-protection-policy";
import { getCurrentUser } from "@/lib/session";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Sign up — TextIQ",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[]; error?: string }>;
}) {
  if (await getCurrentUser()) {
    redirect(routeProtectionPolicy.authenticatedHome);
  }

  const { callbackUrl: rawCallbackUrl, error } = await searchParams;
  const callbackUrl = safeCallbackUrl(
    Array.isArray(rawCallbackUrl) ? rawCallbackUrl[0] : rawCallbackUrl,
  );
  const hasAuthError = typeof error === "string" && error.length > 0;

  return (
    <main className="flex flex-1 items-center justify-center bg-ds-surface-sunken px-6 py-16">
      <div className="flex w-full max-w-sm flex-col gap-8 rounded-ds-xl border border-ds-border-subtle bg-ds-surface-raised p-8 shadow-ds-overlay">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ds-text-primary">
            Create your account
          </h1>
          <p className="text-sm text-ds-text-secondary">
            Start turning text into visuals — it&apos;s free.
          </p>
        </div>
        <div className="flex flex-col gap-6">
          {hasAuthError ? (
            <p role="alert" className="text-sm text-ds-danger">
              Google sign-in failed. Please try again or use email and password.
            </p>
          ) : null}
          <SignupForm callbackUrl={callbackUrl} />
          <GoogleSignInSection
            callbackUrl={callbackUrl}
            errorRedirectPath="/signup"
          />
        </div>
      </div>
    </main>
  );
}
