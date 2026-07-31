import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { stubModule } from "@/test/module-stub";

stubModule("@/auth", `module.exports = { signIn: async () => undefined };`);
stubModule(
  "@/lib/auth/google-provider",
  `module.exports = { isGoogleAuthConfigured: () => true };`,
);
stubModule(
  "next/navigation",
  `module.exports = {
  redirect(path) { throw new Error("redirect:" + path); },
  unstable_rethrow() {},
};`,
);

type GoogleModule = typeof import("./google-sign-in-button");
let executeGoogleSignIn: GoogleModule["executeGoogleSignIn"];

before(async () => {
  executeGoogleSignIn = (await import("./google-sign-in-button"))
    .executeGoogleSignIn;
});

describe("executeGoogleSignIn", () => {
  test("starts Google OAuth with a validated same-origin callback", async () => {
    const calls: unknown[][] = [];
    await executeGoogleSignIn(
      {
        callbackUrl: "/app/documents/doc-1?tab=slides#current",
        errorRedirectPath: "/login",
      },
      {
        async signIn(provider, options) {
          calls.push([provider, options]);
        },
        rethrow(error) {
          calls.push(["rethrow", error]);
        },
        redirect(path): never {
          throw new Error(`unexpected redirect:${path}`);
        },
      },
    );

    assert.deepEqual(calls, [
      ["google", { redirectTo: "/app/documents/doc-1?tab=slides#current" }],
    ]);
  });

  test("normalizes an unsafe callback before starting OAuth", async () => {
    let redirectTo: string | undefined;
    await executeGoogleSignIn(
      {
        callbackUrl: "https://attacker.example/phish",
        errorRedirectPath: "/login",
      },
      {
        async signIn(_provider, options) {
          redirectTo = options.redirectTo;
        },
        rethrow() {},
        redirect(path): never {
          throw new Error(`unexpected redirect:${path}`);
        },
      },
    );
    assert.equal(redirectTo, "/app");
  });

  test("ordinary provider failures redirect to generic local feedback", async () => {
    const providerError = new Error("private provider detail");
    const rethrown: unknown[] = [];
    await assert.rejects(
      () =>
        executeGoogleSignIn(
          { callbackUrl: "/app", errorRedirectPath: "/signup" },
          {
            async signIn() {
              throw providerError;
            },
            rethrow(error) {
              rethrown.push(error);
            },
            redirect(path): never {
              throw new Error(`redirect:${path}`);
            },
          },
        ),
      { message: "redirect:/signup?error=OAuthError" },
    );
    assert.deepEqual(rethrown, [providerError]);
  });

  test("Next navigation control flow escapes without an OAuth error redirect", async () => {
    const frameworkError = new Error("NEXT_REDIRECT");
    const redirects: string[] = [];
    await assert.rejects(
      () =>
        executeGoogleSignIn(
          { callbackUrl: "/app", errorRedirectPath: "/login" },
          {
            async signIn() {
              throw frameworkError;
            },
            rethrow(error) {
              throw error;
            },
            redirect(path): never {
              redirects.push(path);
              throw new Error(`redirect:${path}`);
            },
          },
        ),
      (error: unknown) => error === frameworkError,
    );
    assert.deepEqual(redirects, []);
  });
});
