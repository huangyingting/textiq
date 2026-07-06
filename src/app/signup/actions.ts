"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { registerCredentialsUser } from "@/lib/auth/credentials-service";
import { normalizeEmail } from "@/lib/auth/password";
import { retryMessage, withAbuseBudget } from "@/lib/server-action-abuse";

export async function register(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  return withAbuseBudget(
    "auth.signup.email",
    email || "missing-email",
    async () => {
      const registered = await registerCredentialsUser({
        name: formData.get("name"),
        email,
        password,
      });
      if (!registered.ok) {
        return registered.error;
      }

      try {
        await signIn("credentials", {
          email: registered.data.email,
          password,
          redirectTo: safeCallbackUrl(formData.get("callbackUrl")),
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return "Account created, but automatic sign-in failed. Please log in.";
        }
        throw error;
      }

      return undefined;
    },
    retryMessage,
  );
}
