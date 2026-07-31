import { redirect, unstable_rethrow } from "next/navigation";

import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { isGoogleAuthConfigured } from "@/lib/auth/google-provider";

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
    <form
      action={async () => {
        "use server";
        await executeGoogleSignIn({ callbackUrl, errorRedirectPath });
      }}
    >
      <button
        type="submit"
        className="flex h-11 w-full items-center justify-center gap-3 rounded-ds-pill border border-ds-border-strong bg-ds-surface-base px-6 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-state-hover hover:text-ds-text-primary"
      >
        <GoogleIcon />
        {label}
      </button>
    </form>
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

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}
