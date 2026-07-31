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

type SettingsActionsTestState = {
  calls: unknown[];
  authenticated: boolean;
  changePasswordForUser: (
    input: unknown,
  ) => Promise<{ ok: boolean; error?: string; data?: undefined }>;
  deleteAccountForUser: (
    input: unknown,
  ) => Promise<{ ok: boolean; error?: string; data?: undefined }>;
  requestEmailVerificationForUser: (
    userId: string,
  ) => Promise<{ ok: boolean; data?: { status: string }; error?: string }>;
  withAbuseBudget: (
    namespace: string,
    subject: string,
    action: () => Promise<unknown>,
    onBlocked: (retryAfterSecs: number | undefined) => unknown,
  ) => Promise<unknown>;
};

const globalForActions = globalThis as typeof globalThis & {
  __settingsActionsTestState: SettingsActionsTestState;
};

globalForActions.__settingsActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-settings-action-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function redirect(url) {
        globalThis.__settingsActionsTestState.calls.push(["redirect", url]);
        throw new Error("NEXT_REDIRECT");
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(...args) {
        globalThis.__settingsActionsTestState.calls.push(["revalidatePath", ...args]);
      }
    `,
  ],
  [
    "@/auth",
    `
      export async function signOut(options) {
        globalThis.__settingsActionsTestState.calls.push(["signOut", options]);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        const state = globalThis.__settingsActionsTestState;
        if (!state.authenticated) {
          return redirect("/login");
        }
        state.calls.push(["requireUser"]);
        return { id: "user-1", email: "user@example.test" };
      }
    `,
  ],
  [
    "@/lib/prisma",
    `
      export const prisma = {
        user: {
          update(args) {
            globalThis.__settingsActionsTestState.calls.push(["prisma.user.update", args]);
            return Promise.resolve({});
          },
        },
      };
    `,
  ],
  [
    "@/lib/server-action-abuse",
    `
      export async function withAbuseBudget(namespace, subject, action, onBlocked) {
        globalThis.__settingsActionsTestState.calls.push(["withAbuseBudget", namespace, subject]);
        return globalThis.__settingsActionsTestState.withAbuseBudget(
          namespace, subject, action, onBlocked,
        );
      }
      export function retryMessage(retryAfterSecs, fallback) {
        return fallback ?? "Too many attempts. Please wait a moment and try again.";
      }
    `,
  ],
  [
    "@/lib/account/deletion-service",
    `
      export async function deleteAccountForUser(input) {
        globalThis.__settingsActionsTestState.calls.push(["deleteAccountForUser", input]);
        return globalThis.__settingsActionsTestState.deleteAccountForUser(input);
      }
    `,
  ],
  [
    "@/lib/auth/credentials-service",
    `
      export async function changePasswordForUser(input) {
        globalThis.__settingsActionsTestState.calls.push(["changePasswordForUser", input]);
        return globalThis.__settingsActionsTestState.changePasswordForUser(input);
      }
    `,
  ],
  [
    "@/lib/auth/email-verification-service",
    `
      export async function requestEmailVerificationForUser(userId) {
        globalThis.__settingsActionsTestState.calls.push(["requestEmailVerificationForUser", userId]);
        return globalThis.__settingsActionsTestState.requestEmailVerificationForUser(userId);
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

type SettingsActions = typeof import("./actions");

let settingsActions: SettingsActions;

before(async () => {
  settingsActions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__settingsActionsTestState = createDefaultState();
});

function createDefaultState(): SettingsActionsTestState {
  const calls: unknown[] = [];
  return {
    calls,
    authenticated: true,
    async changePasswordForUser() {
      return { ok: true, data: undefined };
    },
    async deleteAccountForUser() {
      return { ok: true, data: undefined };
    },
    async requestEmailVerificationForUser() {
      return { ok: true, data: { status: "sent" } };
    },
    async withAbuseBudget(_namespace, _subject, action) {
      return action();
    },
  };
}

function state(): SettingsActionsTestState {
  return globalForActions.__settingsActionsTestState;
}

function callsOf(tag: string): unknown[][] {
  return (state().calls as unknown[][]).filter((c) => c[0] === tag);
}

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    fd.append(k, v);
  }
  return fd;
}

describe("updateProfile", () => {
  it("redirects unauthenticated callers without touching the database", async () => {
    state().authenticated = false;

    await assert.rejects(
      () =>
        settingsActions.updateProfile(null, makeFormData({ name: "Alice" })),
      /NEXT_REDIRECT/,
    );

    assert.deepEqual(callsOf("redirect"), [["redirect", "/login"]]);
    assert.equal(callsOf("prisma.user.update").length, 0);
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("writes the trimmed name and revalidates settings and root layout", async () => {
    const result = await settingsActions.updateProfile(
      null,
      makeFormData({ name: "Alice" }),
    );

    assert.deepEqual(result, { ok: true, data: { name: "Alice" } });

    const [updateCall] = callsOf("prisma.user.update");
    assert.deepEqual(updateCall, [
      "prisma.user.update",
      { where: { id: "user-1" }, data: { name: "Alice" } },
    ]);

    assert.deepEqual(callsOf("revalidatePath"), [
      ["revalidatePath", "/app/settings"],
      ["revalidatePath", "/", "layout"],
    ]);
  });

  it("trims surrounding whitespace before writing", async () => {
    const result = await settingsActions.updateProfile(
      null,
      makeFormData({ name: "  Bob  " }),
    );

    assert.deepEqual(result, { ok: true, data: { name: "Bob" } });
    const [updateCall] = callsOf("prisma.user.update") as [unknown[]];
    assert.deepEqual(
      (updateCall[1] as { data: { name: unknown } }).data.name,
      "Bob",
    );
  });

  it("stores null for an empty name and returns the empty string in the result", async () => {
    const result = await settingsActions.updateProfile(
      null,
      makeFormData({ name: "" }),
    );

    assert.deepEqual(result, { ok: true, data: { name: "" } });
    const [updateCall] = callsOf("prisma.user.update") as [unknown[]];
    assert.deepEqual(
      (updateCall[1] as { data: { name: unknown } }).data.name,
      null,
    );
  });

  it("clamps names exceeding 100 characters before writing", async () => {
    const longName = "A".repeat(150);
    const result = await settingsActions.updateProfile(
      null,
      makeFormData({ name: longName }),
    );

    assert.deepEqual(result, { ok: true, data: { name: "A".repeat(100) } });
    const [updateCall] = callsOf("prisma.user.update") as [unknown[]];
    const storedName = (updateCall[1] as { data: { name: string } }).data.name;
    assert.equal(storedName.length, 100);
  });
});

describe("changePassword", () => {
  it("redirects unauthenticated callers with no service or abuse-budget calls", async () => {
    state().authenticated = false;

    await assert.rejects(
      () =>
        settingsActions.changePassword(
          null,
          makeFormData({
            currentPassword: "old",
            newPassword: "newpass123",
            confirmPassword: "newpass123",
          }),
        ),
      /NEXT_REDIRECT/,
    );

    assert.equal(callsOf("withAbuseBudget").length, 0);
    assert.equal(callsOf("changePasswordForUser").length, 0);
  });

  it("passes form fields to the service and signs out after a successful rotation", async () => {
    const result = await settingsActions.changePassword(
      null,
      makeFormData({
        currentPassword: "old-pass",
        newPassword: "new-pass123",
        confirmPassword: "new-pass123",
      }),
    );

    assert.deepEqual(result, { ok: true, data: undefined });

    assert.deepEqual(callsOf("withAbuseBudget"), [
      ["withAbuseBudget", "account.change-password.user", "user-1"],
    ]);

    const [cpCall] = callsOf("changePasswordForUser") as [unknown[]];
    assert.deepEqual(cpCall[1], {
      userId: "user-1",
      currentPassword: "old-pass",
      newPassword: "new-pass123",
      confirmPassword: "new-pass123",
    });
    assert.deepEqual(callsOf("signOut"), [
      ["signOut", { redirectTo: "/login?passwordChanged=1" }],
    ]);
  });

  it("propagates a service validation error to the caller", async () => {
    state().changePasswordForUser = async () => ({
      ok: false,
      error: "New passwords don't match.",
    });

    const result = await settingsActions.changePassword(
      null,
      makeFormData({
        currentPassword: "old",
        newPassword: "new",
        confirmPassword: "different",
      }),
    );

    assert.deepEqual(result, {
      ok: false,
      error: "New passwords don't match.",
    });
    assert.equal(callsOf("signOut").length, 0);
  });

  it("returns a rate-limit error when the abuse budget is exceeded", async () => {
    state().withAbuseBudget = async (_ns, _sub, _action, onBlocked) =>
      onBlocked(undefined);

    const result = await settingsActions.changePassword(
      null,
      makeFormData({
        currentPassword: "old",
        newPassword: "new-pass123",
        confirmPassword: "new-pass123",
      }),
    );

    assert.equal(result.ok, false);
    assert.match(
      (result as { ok: false; error: string }).error,
      /Too many attempts/,
    );
    assert.equal(callsOf("changePasswordForUser").length, 0);
    assert.equal(callsOf("signOut").length, 0);
  });
});

describe("deleteAccount", () => {
  it("redirects unauthenticated callers with no deletion or sign-out calls", async () => {
    state().authenticated = false;

    await assert.rejects(
      () =>
        settingsActions.deleteAccount(
          null,
          makeFormData({ confirmation: "DELETE" }),
        ),
      /NEXT_REDIRECT/,
    );

    assert.equal(callsOf("deleteAccountForUser").length, 0);
    assert.equal(callsOf("signOut").length, 0);
  });

  it("returns the service error when confirmation fails without calling signOut", async () => {
    state().deleteAccountForUser = async () => ({
      ok: false,
      error: 'Type your email or "DELETE" to confirm.',
    });

    const result = await settingsActions.deleteAccount(
      null,
      makeFormData({ confirmation: "wrong-value" }),
    );

    assert.deepEqual(result, {
      ok: false,
      error: 'Type your email or "DELETE" to confirm.',
    });
    assert.equal(callsOf("signOut").length, 0);
  });

  it("calls signOut after successful deletion and scopes the delete to the session user", async () => {
    const result = await settingsActions.deleteAccount(
      null,
      makeFormData({ confirmation: "DELETE" }),
    );

    assert.deepEqual(result, { ok: true, data: undefined });

    const [delCall] = callsOf("deleteAccountForUser") as [unknown[]];
    assert.deepEqual(delCall[1], {
      userId: "user-1",
      confirmation: "DELETE",
    });

    assert.deepEqual(callsOf("signOut"), [["signOut", { redirectTo: "/" }]]);
  });

  it("accepts the user's email address as an alternative confirmation", async () => {
    const result = await settingsActions.deleteAccount(
      null,
      makeFormData({ confirmation: "user@example.test" }),
    );

    assert.deepEqual(result, { ok: true, data: undefined });

    const [delCall] = callsOf("deleteAccountForUser") as [unknown[]];
    assert.deepEqual(
      (delCall[1] as { confirmation: string }).confirmation,
      "user@example.test",
    );
  });
});

describe("requestEmailVerification", () => {
  it("redirects unauthenticated callers with no service or abuse-budget calls", async () => {
    state().authenticated = false;

    await assert.rejects(
      () => settingsActions.requestEmailVerification(null, makeFormData({})),
      /NEXT_REDIRECT/,
    );

    assert.equal(callsOf("withAbuseBudget").length, 0);
    assert.equal(callsOf("requestEmailVerificationForUser").length, 0);
  });

  it("delegates to the service and returns a sent result on success", async () => {
    const result = await settingsActions.requestEmailVerification(
      null,
      makeFormData({}),
    );

    assert.deepEqual(result, { ok: true, data: { status: "sent" } });

    assert.deepEqual(callsOf("withAbuseBudget"), [
      ["withAbuseBudget", "auth.email-verification.user", "user-1"],
    ]);

    const [verifyCall] = callsOf("requestEmailVerificationForUser") as [
      unknown[],
    ];
    assert.equal(verifyCall[1], "user-1");
  });

  it("returns already_verified when the service reports the address is confirmed", async () => {
    state().requestEmailVerificationForUser = async () => ({
      ok: true,
      data: { status: "already_verified" },
    });

    const result = await settingsActions.requestEmailVerification(
      null,
      makeFormData({}),
    );

    assert.deepEqual(result, {
      ok: true,
      data: { status: "already_verified" },
    });
  });

  it("returns a rate-limit error when the abuse budget is exceeded", async () => {
    state().withAbuseBudget = async (_ns, _sub, _action, onBlocked) =>
      onBlocked(undefined);

    const result = await settingsActions.requestEmailVerification(
      null,
      makeFormData({}),
    );

    assert.equal(result.ok, false);
    assert.match(
      (result as { ok: false; error: string }).error,
      /Too many attempts/,
    );
    assert.equal(callsOf("requestEmailVerificationForUser").length, 0);
  });
});
