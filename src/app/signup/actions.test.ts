/**
 * Action-boundary coverage for `register` (issue #1902).
 *
 * Module-hook strategy: `@/auth`, `@/lib/auth/credentials-service`, and
 * `@/lib/server-action-abuse` are stubbed (they pull in the full NextAuth
 * config, Prisma, bcrypt hashing, and onboarding seeding — none of which this
 * suite needs to exercise; `credentials-service.test.ts` already covers that
 * validation/persistence logic directly). `next-auth` (for the real
 * `AuthError` class), `@/lib/auth/callback-url`, and `@/lib/auth/password`
 * (for `normalizeEmail`) are left real since they are pure, dependency-free
 * helpers and the action's wiring to them is what this suite asserts.
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

type SignupActionsTestState = {
  calls: unknown[];
  signIn: (
    provider: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  registerCredentialsUser: (
    input: unknown,
  ) => Promise<
    | { ok: true; data: { id: string; email: string } }
    | { ok: false; error: string }
  >;
  withAbuseBudget: (
    namespace: string,
    subject: string,
    action: () => Promise<unknown>,
    onBlocked: (retryAfterSecs: number | undefined) => unknown,
  ) => Promise<unknown>;
};

const globalForActions = globalThis as typeof globalThis & {
  __signupActionsTestState: SignupActionsTestState;
};

globalForActions.__signupActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-signup-action-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/auth",
    `
      export async function signIn(provider, options) {
        globalThis.__signupActionsTestState.calls.push(["signIn", provider, options]);
        return globalThis.__signupActionsTestState.signIn(provider, options);
      }
    `,
  ],
  [
    "@/lib/auth/credentials-service",
    `
      export async function registerCredentialsUser(input) {
        globalThis.__signupActionsTestState.calls.push(["registerCredentialsUser", input]);
        return globalThis.__signupActionsTestState.registerCredentialsUser(input);
      }
    `,
  ],
  [
    "@/lib/server-action-abuse",
    `
      export async function withAbuseBudget(namespace, subject, action, onBlocked) {
        globalThis.__signupActionsTestState.calls.push(["withAbuseBudget", namespace, subject]);
        return globalThis.__signupActionsTestState.withAbuseBudget(
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

type SignupActions = typeof import("./actions");

let signupActions: SignupActions;

before(async () => {
  signupActions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__signupActionsTestState = createDefaultState();
});

function createDefaultState(): SignupActionsTestState {
  const calls: unknown[] = [];
  return {
    calls,
    async signIn() {
      return undefined;
    },
    async registerCredentialsUser(input) {
      const { email } = input as { email: string };
      return { ok: true, data: { id: "user-1", email } };
    },
    async withAbuseBudget(_namespace, _subject, action) {
      return action();
    },
  };
}

function state(): SignupActionsTestState {
  return globalForActions.__signupActionsTestState;
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

describe("register", () => {
  it("treats missing FormData fields as empty/null and scopes the abuse budget to 'missing-email'", async () => {
    await signupActions.register(undefined, new FormData());

    assert.deepEqual(callsOf("withAbuseBudget"), [
      ["withAbuseBudget", "auth.signup.email", "missing-email"],
    ]);
    const [registerCall] = callsOf("registerCredentialsUser");
    assert.deepEqual(registerCall[1], {
      name: null,
      email: "",
      password: "",
    });
  });

  it("normalizes email casing and whitespace before scoping the budget and registering", async () => {
    const fd = makeFormData({
      name: "Alice",
      email: "  Alice@Example.COM  ",
      password: "secret123",
    });

    await signupActions.register(undefined, fd);

    assert.deepEqual(callsOf("withAbuseBudget"), [
      ["withAbuseBudget", "auth.signup.email", "alice@example.com"],
    ]);
    const [registerCall] = callsOf("registerCredentialsUser");
    assert.equal(
      (registerCall[1] as { email: string }).email,
      "alice@example.com",
    );
  });

  it("returns the service's validation/duplicate-account error verbatim without signing in", async () => {
    state().registerCredentialsUser = async () => ({
      ok: false,
      error: "An account with this email already exists.",
    });

    const result = await signupActions.register(
      undefined,
      makeFormData({
        name: "Alice",
        email: "alice@example.com",
        password: "secret123",
      }),
    );

    assert.equal(result, "An account with this email already exists.");
    assert.equal(callsOf("signIn").length, 0);
  });

  it("signs in with the service's canonical email (not necessarily the raw form value) and a safe redirect target", async () => {
    state().registerCredentialsUser = async () => ({
      ok: true,
      data: { id: "user-1", email: "canonical@example.com" },
    });

    await signupActions.register(
      undefined,
      makeFormData({
        name: "Alice",
        email: "  Alice+extra@Example.com  ",
        password: "secret123",
        callbackUrl: "https://evil.example.com/steal",
      }),
    );

    const [signInCall] = callsOf("signIn");
    assert.deepEqual(signInCall[2], {
      email: "canonical@example.com",
      password: "secret123",
      redirectTo: "/app",
    });
  });

  it("maps a sign-in AuthError after successful registration to a generic message without leaking internals", async () => {
    state().signIn = async () => {
      throw new AuthError("CredentialsSignin: unexpected internal state");
    };

    const result = await signupActions.register(
      undefined,
      makeFormData({
        name: "Alice",
        email: "alice@example.com",
        password: "secret123",
      }),
    );

    assert.equal(
      result,
      "Account created, but automatic sign-in failed. Please log in.",
    );
    assert.ok(!result?.includes("internal"));
  });

  it("rethrows non-AuthError sign-in failures instead of swallowing them", async () => {
    state().signIn = async () => {
      throw new Error("database down");
    };

    await assert.rejects(
      () =>
        signupActions.register(
          undefined,
          makeFormData({
            name: "Alice",
            email: "alice@example.com",
            password: "secret123",
          }),
        ),
      /database down/,
    );
  });

  it("returns undefined on full success (register + sign-in)", async () => {
    const result = await signupActions.register(
      undefined,
      makeFormData({
        name: "Alice",
        email: "alice@example.com",
        password: "secret123",
      }),
    );

    assert.equal(result, undefined);
  });

  it("returns a generic retry message and never calls the registration service when the abuse budget is exceeded", async () => {
    state().withAbuseBudget = async (_ns, _sub, _action, onBlocked) =>
      onBlocked(undefined);

    const result = await signupActions.register(
      undefined,
      makeFormData({
        name: "Alice",
        email: "alice@example.com",
        password: "secret123",
      }),
    );

    assert.match(result ?? "", /Too many attempts/);
    assert.equal(callsOf("registerCredentialsUser").length, 0);
    assert.equal(callsOf("signIn").length, 0);
  });
});
