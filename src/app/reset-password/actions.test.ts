/**
 * Action-boundary coverage for `resetPassword` (issue #1902).
 *
 * Module-hook strategy: `@/lib/auth/password-reset-service` is stubbed (the
 * real module pulls in Prisma transactions, token hashing, and security-audit
 * logging — `password-reset-service.test.ts` already covers the race-safe
 * consume logic and rejection-reason mapping directly against a Prisma stub).
 * `@/lib/server-action-abuse` is stubbed to control the abuse-budget outcome
 * deterministically. `@/lib/auth/form-state` is a type-only import in the
 * action and is erased at compile time, so it needs no stub.
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

type ResetPasswordActionsTestState = {
  calls: unknown[];
  resetPasswordWithToken: (
    input: unknown,
  ) => Promise<{ status: "success" } | { status: "error"; message: string }>;
  withAbuseBudget: (
    namespace: string,
    subject: string,
    action: () => Promise<unknown>,
    onBlocked: (retryAfterSecs: number | undefined) => unknown,
  ) => Promise<unknown>;
};

const globalForActions = globalThis as typeof globalThis & {
  __resetPasswordActionsTestState: ResetPasswordActionsTestState;
};

globalForActions.__resetPasswordActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-reset-password-action-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/auth/password-reset-service",
    `
      export async function resetPasswordWithToken(input) {
        globalThis.__resetPasswordActionsTestState.calls.push(["resetPasswordWithToken", input]);
        return globalThis.__resetPasswordActionsTestState.resetPasswordWithToken(input);
      }
    `,
  ],
  [
    "@/lib/server-action-abuse",
    `
      export async function withAbuseBudget(namespace, subject, action, onBlocked) {
        globalThis.__resetPasswordActionsTestState.calls.push(["withAbuseBudget", namespace, subject]);
        return globalThis.__resetPasswordActionsTestState.withAbuseBudget(
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

type ResetPasswordActions = typeof import("./actions");

let resetPasswordActions: ResetPasswordActions;

before(async () => {
  resetPasswordActions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__resetPasswordActionsTestState = createDefaultState();
});

function createDefaultState(): ResetPasswordActionsTestState {
  const calls: unknown[] = [];
  return {
    calls,
    async resetPasswordWithToken() {
      return { status: "success" };
    },
    async withAbuseBudget(_namespace, _subject, action) {
      return action();
    },
  };
}

function state(): ResetPasswordActionsTestState {
  return globalForActions.__resetPasswordActionsTestState;
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

describe("resetPassword", () => {
  it("defaults a missing token to '' and scopes the abuse budget to 'missing-token'", async () => {
    await resetPasswordActions.resetPassword(
      { status: "idle" },
      makeFormData({
        newPassword: "new-pass123",
        confirmPassword: "new-pass123",
      }),
    );

    assert.deepEqual(callsOf("withAbuseBudget"), [
      ["withAbuseBudget", "auth.password-reset.token", "missing-token"],
    ]);
    const [call] = callsOf("resetPasswordWithToken");
    assert.equal((call[1] as { token: string }).token, "");
  });

  it("passes the raw (un-defaulted) newPassword/confirmPassword FormData entries through to the service", async () => {
    const fd = makeFormData({ token: "raw-token-1" });
    // Omit newPassword/confirmPassword entirely: FormData#get returns null,
    // and the action must not coerce these before handing off to the service
    // (which owns the String()/validation boundary itself).
    await resetPasswordActions.resetPassword({ status: "idle" }, fd);

    const [call] = callsOf("resetPasswordWithToken");
    assert.deepEqual(call[1], {
      token: "raw-token-1",
      newPassword: null,
      confirmPassword: null,
    });
  });

  it("forwards token and passwords verbatim when present", async () => {
    const fd = makeFormData({
      token: "raw-token-2",
      newPassword: "new-pass123",
      confirmPassword: "new-pass123",
    });

    await resetPasswordActions.resetPassword({ status: "idle" }, fd);

    const [call] = callsOf("resetPasswordWithToken");
    assert.deepEqual(call[1], {
      token: "raw-token-2",
      newPassword: "new-pass123",
      confirmPassword: "new-pass123",
    });
  });

  it("returns the service's success result verbatim", async () => {
    const result = await resetPasswordActions.resetPassword(
      { status: "idle" },
      makeFormData({
        token: "raw-token-3",
        newPassword: "new-pass123",
        confirmPassword: "new-pass123",
      }),
    );

    assert.deepEqual(result, { status: "success" });
  });

  it("propagates a token-rejection error (expired/used/not-found) from the service verbatim", async () => {
    state().resetPasswordWithToken = async () => ({
      status: "error",
      message: "This password reset link is invalid or has expired.",
    });

    const result = await resetPasswordActions.resetPassword(
      { status: "idle" },
      makeFormData({
        token: "expired-token",
        newPassword: "new-pass123",
        confirmPassword: "new-pass123",
      }),
    );

    assert.deepEqual(result, {
      status: "error",
      message: "This password reset link is invalid or has expired.",
    });
  });

  it("returns a generic retry message and never calls the reset service when the abuse budget is exceeded", async () => {
    state().withAbuseBudget = async (_ns, _sub, _action, onBlocked) =>
      onBlocked(undefined);

    const result = await resetPasswordActions.resetPassword(
      { status: "idle" },
      makeFormData({
        token: "raw-token-4",
        newPassword: "new-pass123",
        confirmPassword: "new-pass123",
      }),
    );

    assert.equal(result.status, "error");
    assert.match(
      (result as { status: "error"; message: string }).message,
      /Too many attempts/,
    );
    assert.equal(callsOf("resetPasswordWithToken").length, 0);
  });
});
