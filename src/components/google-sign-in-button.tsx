import { redirect, unstable_rethrow } from "next/navigation";

import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { isGoogleAuthConfigured } from "@/lib/auth/google-provider";

import { GoogleSignInForm } from "./google-sign-in-form";

export type GoogleSignInPort = {
  signIn: (
    provider: "google",
    options: { redirectTo: string },
  ) => Promise<unknown>;
  rethrow: (error: unknown) => void;
  redirect: (path: string) => never;
};

const routeGoogleSignInPort: GoogleSignInPort = {
  signIn: (provider, options) => signIn(provider, options),
  rethrow: unstable_rethrow,
  redirect,
};

export async function executeGoogleSignIn(
  {
    callbackUrl,
    errorRedirectPath,
  }: { callbackUrl?: string; errorRedirectPath: string },
  port: GoogleSignInPort = routeGoogleSignInPort,
): Promise<void> {
  try {
    await port.signIn("google", {
      redirectTo: safeCallbackUrl(callbackUrl),
    });
  } catch (error) {
    port.rethrow(error);
    port.redirect(`${errorRedirectPath}?error=OAuthError`);
  }
}

// coverage-breadth: mapped-e2e ref=e2e/ui-matrix/auth-public-ui.spec.ts
export function GoogleSignInSection({
  label,
  callbackUrl,
  errorRedirectPath = "/login",
}: {
  label?: string;
  callbackUrl?: string;
  errorRedirectPath?: string;
}) {
  if (!isGoogleAuthConfigured()) {
    return null;
  }

  return (
    <>
      <OrDivider />
      <GoogleSignInButton
        label={label}
        callbackUrl={callbackUrl}
        errorRedirectPath={errorRedirectPath}
      />
    </>
  );
}

export function GoogleSignInButton({
  label = "Continue with Google",
  callbackUrl,
  errorRedirectPath = "/login",
}: {
  label?: string;
  callbackUrl?: string;
  errorRedirectPath?: string;
}) {
  return (
    <GoogleSignInForm
      label={label}
      action={async () => {
        "use server";
        await executeGoogleSignIn({ callbackUrl, errorRedirectPath });
      }}
    />
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-ds-border-subtle" />
      <span className="text-xs uppercase tracking-wide text-ds-text-muted">
        or
      </span>
      <span className="h-px flex-1 bg-ds-border-subtle" />
    </div>
  );
}
