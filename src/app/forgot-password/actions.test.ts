/**
 * Action-boundary coverage for `requestPasswordReset` (issue #1902).
 *
 * Module-hook strategy: `@/lib/auth/password-reset-service` is stubbed (the
 * real module pulls in Prisma, email delivery, and security-audit logging —
 * `password-reset-service.test.ts` already covers its token-generation and
 * anti-enumeration behavior directly against a Prisma stub). `@/lib/server-
 * action-abuse` is stubbed to control the abuse-budget outcome deterministically.
 * `@/lib/auth/password` (for `normalizeEmail`) is left real since it's a pure,
 * dependency-free helper and the action's wiring to it is what this suite
 * asserts. `@/lib/auth/form-state` is a type-only import in the action and is
 * erased at compile time, so it needs no stub.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
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

const GENERIC_SENT_MESSAGE =
  "If an account exists for that email, we've sent a link to reset your password.";

type ForgotPasswordActionsTestState = {
  calls: unknown[];
  requestPasswordResetForEmail: (
    email: string,
  ) => Promise<
    { status: "sent"; message: string } | { status: "error"; message: string }
  >;
  withAbuseBudget: (
    namespace: string,
    subject: string,
    action: () => Promise<unknown>,
    onBlocked: () => unknown,
  ) => Promise<unknown>;
};

const globalForActions = globalThis as typeof globalThis & {
  __forgotPasswordActionsTestState: ForgotPasswordActionsTestState;
};

globalForActions.__forgotPasswordActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-forgot-password-action-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/auth/password-reset-service",
    `
      export const GENERIC_PASSWORD_RESET_SENT_MESSAGE = ${JSON.stringify(
        GENERIC_SENT_MESSAGE,
      )};
      export async function requestPasswordResetForEmail(email) {
        globalThis.__forgotPasswordActionsTestState.calls.push(["requestPasswordResetForEmail", email]);
        return globalThis.__forgotPasswordActionsTestState.requestPasswordResetForEmail(email);
      }
    `,
  ],
  [
    "@/lib/server-action-abuse",
    `
      export async function withAbuseBudget(namespace, subject, action, onBlocked) {
        globalThis.__forgotPasswordActionsTestState.calls.push(["withAbuseBudget", namespace, subject]);
        return globalThis.__forgotPasswordActionsTestState.withAbuseBudget(
          namespace, subject, action, onBlocked,
        );
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

type ForgotPasswordActions = typeof import("./actions");

let forgotPasswordActions: ForgotPasswordActions;

before(async () => {
  forgotPasswordActions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__forgotPasswordActionsTestState = createDefaultState();
});

function createDefaultState(): ForgotPasswordActionsTestState {
  const calls: unknown[] = [];
  return {
    calls,
    async requestPasswordResetForEmail() {
      return { status: "sent", message: GENERIC_SENT_MESSAGE };
    },
    async withAbuseBudget(_namespace, _subject, action) {
      return action();
    },
  };
}

function state(): ForgotPasswordActionsTestState {
  return globalForActions.__forgotPasswordActionsTestState;
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

describe("requestPasswordReset", () => {
  it("treats a missing email field as empty and scopes the abuse budget to 'missing-email'", async () => {
    const result = await forgotPasswordActions.requestPasswordReset(
      { status: "idle" },
      new FormData(),
    );

    assert.deepEqual(result, { status: "sent", message: GENERIC_SENT_MESSAGE });
    assert.deepEqual(callsOf("withAbuseBudget"), [
      ["withAbuseBudget", "auth.password-reset.email", "missing-email"],
    ]);
    assert.deepEqual(callsOf("requestPasswordResetForEmail"), [
      ["requestPasswordResetForEmail", ""],
    ]);
  });

  it("tolerates a non-string (File) email field without throwing", async () => {
    const fd = makeFormData({
      email: new File(["irrelevant"], "email.txt"),
    });

    const result = await forgotPasswordActions.requestPasswordReset(
      { status: "idle" },
      fd,
    );

    assert.equal(result.status, "sent");
    const [call] = callsOf("requestPasswordResetForEmail");
    assert.equal(typeof call[1], "string");
  });

  it("normalizes email casing and whitespace before scoping the budget and delegating", async () => {
    const fd = makeFormData({ email: "  User@Example.COM  " });

    await forgotPasswordActions.requestPasswordReset({ status: "idle" }, fd);

    assert.deepEqual(callsOf("withAbuseBudget"), [
      ["withAbuseBudget", "auth.password-reset.email", "user@example.com"],
    ]);
    assert.deepEqual(callsOf("requestPasswordResetForEmail"), [
      ["requestPasswordResetForEmail", "user@example.com"],
    ]);
  });

  it("returns the service result verbatim on success (known account)", async () => {
    const fd = makeFormData({ email: "known@example.com" });

    const result = await forgotPasswordActions.requestPasswordReset(
      { status: "idle" },
      fd,
    );

    assert.deepEqual(result, { status: "sent", message: GENERIC_SENT_MESSAGE });
  });

  it("returns the identical generic 'sent' message for an unknown account (anti-enumeration)", async () => {
    // The service itself enforces anti-enumeration; the action must not
    // alter or bypass that by branching on the outcome.
    state().requestPasswordResetForEmail = async () => ({
      status: "sent",
      message: GENERIC_SENT_MESSAGE,
    });

    const result = await forgotPasswordActions.requestPasswordReset(
      { status: "idle" },
      makeFormData({ email: "unknown@example.com" }),
    );

    assert.deepEqual(result, { status: "sent", message: GENERIC_SENT_MESSAGE });
  });

  it("propagates a validation error from the service (e.g. malformed email) without rewriting it", async () => {
    state().requestPasswordResetForEmail = async () => ({
      status: "error",
      message: "Enter a valid email address.",
    });

    const result = await forgotPasswordActions.requestPasswordReset(
      { status: "idle" },
      makeFormData({ email: "not-an-email" }),
    );

    assert.deepEqual(result, {
      status: "error",
      message: "Enter a valid email address.",
    });
  });

  it("preserves the anti-enumeration 'sent' response when the abuse budget is exceeded (no retry-message leak)", async () => {
    state().withAbuseBudget = async (_ns, _sub, _action, onBlocked) =>
      onBlocked();

    const result = await forgotPasswordActions.requestPasswordReset(
      { status: "idle" },
      makeFormData({ email: "user@example.com" }),
    );

    assert.deepEqual(result, { status: "sent", message: GENERIC_SENT_MESSAGE });
    assert.equal(callsOf("requestPasswordResetForEmail").length, 0);
  });
});
