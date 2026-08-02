"use server";

import { AuthError } from "next-auth";
import { unstable_rethrow } from "next/navigation";

import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { normalizeEmail } from "@/lib/auth/password";
import { logError } from "@/lib/log";
import { retryMessage, withAbuseBudget } from "@/lib/server-action-abuse";

const LOGIN_FAILURE_MESSAGE = "Could not log in. Please try again.";

function logLoginFailure(): void {
  const error = new Error("Could not complete login operation.");
  error.name = "LoginError";
  logError("auth.login", error, { code: "LOGIN_FAILED" });
}

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = normalizeEmail(formData.get("email"));
  try {
    return await withAbuseBudget(
      "auth.login.email",
      email || "missing-email",
      async () => {
        await signIn("credentials", {
          email,
          password: String(formData.get("password") ?? ""),
          redirectTo: safeCallbackUrl(formData.get("callbackUrl")),
        });
        return undefined;
      },
      retryMessage,
    );
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthError) {
      return "Invalid email or password.";
    }
    logLoginFailure();
    return LOGIN_FAILURE_MESSAGE;
  }
}
