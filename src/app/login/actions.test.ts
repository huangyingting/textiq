/**
 * Action-boundary coverage for `authenticate` (issue #1902).
 *
 * Module-hook strategy: `@/auth` and `@/lib/server-action-abuse` are stubbed
 * (they pull in the full NextAuth config / abuse-budget storage, which need a
 * live DB and env secrets). `next-auth` (for the real `AuthError` class),
 * `@/lib/auth/callback-url`, and `@/lib/auth/password` are left real — they
 * are pure, dependency-free helpers, and the action's own wiring to them
 * (normalization, redirect-target safety) is exactly what this suite is
 * asserting.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { AuthError } from "next-auth";
import { before, beforeEach, describe, it } from "node:test";

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

type LoginActionsTestState = {
  calls: unknown[];
  signIn: (
    provider: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  withAbuseBudget: (
    namespace: string,
    subject: string,
    action: () => Promise<unknown>,
    onBlocked: (retryAfterSecs: number | undefined) => unknown,
  ) => Promise<unknown>;
};

const globalForActions = globalThis as typeof globalThis & {
  __loginActionsTestState: LoginActionsTestState;
};

globalForActions.__loginActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-login-action-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/auth",
    `
      export async function signIn(provider, options) {
        globalThis.__loginActionsTestState.calls.push(["signIn", provider, options]);
        return globalThis.__loginActionsTestState.signIn(provider, options);
      }
    `,
  ],
  [
    "@/lib/server-action-abuse",
    `
      export async function withAbuseBudget(namespace, subject, action, onBlocked) {
        globalThis.__loginActionsTestState.calls.push(["withAbuseBudget", namespace, subject]);
        return globalThis.__loginActionsTestState.withAbuseBudget(
          namespace, subject, action, onBlocked,
        );
      }
      export function retryMessage(retryAfterSecs, fallback) {
        return fallback ?? "Too many attempts. Please wait a moment and try again.";
      }
    `,
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbedModules.has(specifier)) {
      return {
        url: `${stubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(stubPrefix)) {
      const specifier = decodeURIComponent(url.slice(stubPrefix.length));
      return {
        format: "module",
        source: stubbedModules.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type LoginActions = typeof import("./actions");

let loginActions: LoginActions;

before(async () => {
  loginActions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__loginActionsTestState = createDefaultState();
});

function createDefaultState(): LoginActionsTestState {
  const calls: unknown[] = [];
  return {
    calls,
    async signIn() {
      return undefined;
    },
    async withAbuseBudget(_namespace, _subject, action) {
      return action();
    },
  };
}

function state(): LoginActionsTestState {
  return globalForActions.__loginActionsTestState;
}

function callsOf(tag: string): unknown[][] {
  return (state().calls as unknown[][]).filter((c) => c[0] === tag);
}

function makeFormData(entries: Record<string, FormDataEntryValue>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    fd.append(k, v);
  }
  return fd;
}

describe("authenticate", () => {
  it("treats missing FormData fields as empty strings and scopes the abuse budget to 'missing-email'", async () => {
    const result = await loginActions.authenticate(undefined, new FormData());

    assert.equal(result, undefined);
    assert.deepEqual(callsOf("withAbuseBudget"), [
      ["withAbuseBudget", "auth.login.email", "missing-email"],
    ]);
    const [signInCall] = callsOf("signIn");
    assert.deepEqual(signInCall[2], {
      email: "",
      password: "",
      redirectTo: "/app",
    });
  });

  it("tolerates a non-string (File) email field without throwing", async () => {
    const fd = makeFormData({
      email: new File(["irrelevant"], "email.txt"),
      password: "secret123",
    });

    const result = await loginActions.authenticate(undefined, fd);

    assert.equal(result, undefined);
    const [signInCall] = callsOf("signIn");
    assert.equal(typeof (signInCall[2] as { email: string }).email, "string");
  });

  it("normalizes email casing and whitespace before signing in and scoping the budget", async () => {
    const fd = makeFormData({
      email: "  USER@Example.COM  ",
      password: "secret123",
    });

    await loginActions.authenticate(undefined, fd);

    assert.deepEqual(callsOf("withAbuseBudget"), [
      ["withAbuseBudget", "auth.login.email", "user@example.com"],
    ]);
    const [signInCall] = callsOf("signIn");
    assert.equal(
      (signInCall[2] as { email: string }).email,
      "user@example.com",
    );
  });

  it("falls back to the default callback URL for an open-redirect attempt, but preserves a safe root-relative target", async () => {
    const maliciousFd = makeFormData({
      email: "user@example.com",
      password: "secret123",
      callbackUrl: "https://evil.example.com/steal",
    });
    await loginActions.authenticate(undefined, maliciousFd);
    assert.equal(
      (callsOf("signIn")[0][2] as { redirectTo: string }).redirectTo,
      "/app",
    );

    const safeFd = makeFormData({
      email: "user@example.com",
      password: "secret123",
      callbackUrl: "/app/documents/doc-1",
    });
    await loginActions.authenticate(undefined, safeFd);
    assert.equal(
      (callsOf("signIn")[1][2] as { redirectTo: string }).redirectTo,
      "/app/documents/doc-1",
    );
  });

  it("maps a credentials AuthError to a generic message without leaking its internal text", async () => {
    state().signIn = async () => {
      throw new AuthError(
        "CredentialsSignin: password hash mismatch for internal user record",
      );
    };

    const result = await loginActions.authenticate(
      undefined,
      makeFormData({ email: "user@example.com", password: "wrong" }),
    );

    assert.equal(result, "Invalid email or password.");
    assert.ok(!result?.includes("hash"));
    assert.ok(!result?.includes("internal"));
  });

  it("rethrows non-AuthError failures instead of swallowing them", async () => {
    state().signIn = async () => {
      throw new Error("database down");
    };

    await assert.rejects(
      () =>
        loginActions.authenticate(
          undefined,
          makeFormData({ email: "user@example.com", password: "secret123" }),
        ),
      /database down/,
    );
  });

  it("returns undefined (no redirect thrown here — signIn performs it) on success", async () => {
    const result = await loginActions.authenticate(
      undefined,
      makeFormData({ email: "user@example.com", password: "secret123" }),
    );

    assert.equal(result, undefined);
  });

  it("returns a generic retry message and never calls signIn when the abuse budget is exceeded", async () => {
    state().withAbuseBudget = async (_ns, _sub, _action, onBlocked) =>
      onBlocked(undefined);

    const result = await loginActions.authenticate(
      undefined,
      makeFormData({ email: "user@example.com", password: "secret123" }),
    );

    assert.match(result ?? "", /Too many attempts/);
    assert.equal(callsOf("signIn").length, 0);
  });
});
