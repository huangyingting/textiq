import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/test/react-render-harness";
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
let GoogleSignInButton: GoogleModule["GoogleSignInButton"];

before(async () => {
  const mod = await import("./google-sign-in-button");
  executeGoogleSignIn = mod.executeGoogleSignIn;
  GoogleSignInButton = mod.GoogleSignInButton;
});

test("Google sign-in claims submission synchronously and exposes pending ownership", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<GoogleSignInButton />);
  });

  try {
    const form = renderer.root.findByType("form");
    const onSubmit = form.props.onSubmit as
      ((event: { preventDefault(): void }) => void) | undefined;
    assert.ok(onSubmit, "the OAuth form needs a synchronous client boundary");

    let firstPrevented = 0;
    let repeatedPrevented = 0;
    act(() => {
      onSubmit({ preventDefault: () => (firstPrevented += 1) });
      onSubmit({ preventDefault: () => (repeatedPrevented += 1) });
    });

    assert.equal(firstPrevented, 0);
    assert.equal(repeatedPrevented, 1);
    assert.equal(form.props["aria-busy"], true);
    const button = renderer.root.findByType("button");
    assert.equal(button.props.disabled, true);
    assert.equal(button.children.at(-1), "Connecting…");
  } finally {
    act(() => renderer.unmount());
  }
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
