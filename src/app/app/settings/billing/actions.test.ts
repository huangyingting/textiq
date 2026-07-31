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

type ChangePlanResult = {
  success: boolean;
  message: string;
  redirectUrl?: string;
};

type CancelResult = { success: boolean; message: string };

type BillingActionsTestState = {
  calls: unknown[];
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  changePlan: (userId: string, plan: string) => Promise<ChangePlanResult>;
  cancelSubscription: (userId: string) => Promise<CancelResult>;
  logError: (
    scope: string,
    error: unknown,
    context?: Record<string, unknown>,
  ) => void;
};

const globalForActions = globalThis as typeof globalThis & {
  __billingActionsTestState: BillingActionsTestState;
};

function createDefaultState(): BillingActionsTestState {
  const calls: unknown[] = [];
  return {
    calls,
    redirect(url: string): never {
      calls.push(["redirect", url]);
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
    revalidatePath(path: string) {
      calls.push(["revalidatePath", path]);
    },
    async requireUser() {
      calls.push(["requireUser"]);
      return { id: "user-1" };
    },
    async changePlan(userId, plan) {
      calls.push(["changePlan", userId, plan]);
      return {
        success: true,
        message: `Switched to the ${plan} plan.`,
        redirectUrl: undefined,
      };
    },
    async cancelSubscription(userId) {
      calls.push(["cancelSubscription", userId]);
      return { success: true, message: "Subscription canceled." };
    },
    logError(scope, error, context) {
      calls.push(["logError", scope, error, context]);
    },
  };
}

globalForActions.__billingActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-billing-action-test:";

const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__billingActionsTestState.redirect(url);
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__billingActionsTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__billingActionsTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/billing/provider",
    `
      export async function getBillingProvider() {
        return {
          async changePlan(userId, plan) {
            return globalThis.__billingActionsTestState.changePlan(userId, plan);
          },
          async cancelSubscription(userId) {
            return globalThis.__billingActionsTestState.cancelSubscription(userId);
          },
        };
      }
    `,
  ],
  [
    "@/lib/log",
    `
      export function logError(scope, error, context) {
        globalThis.__billingActionsTestState.logError(scope, error, context);
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

// The real `@/lib/billing/catalog` module is intentionally left unstubbed:
// `isPlan` is a pure, already-unit-tested predicate (see catalog.test.ts /
// billing tests), so exercising it directly here keeps the "Invalid plan"
// validation boundary authentic without re-deriving its own test matrix.

type BillingActions = typeof import("./actions");

let actions: BillingActions;

before(async () => {
  actions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__billingActionsTestState = createDefaultState();
});

function state(): BillingActionsTestState {
  return globalForActions.__billingActionsTestState;
}

function callsOf(tag: string): unknown[][] {
  return (state().calls as unknown[][]).filter((c) => c[0] === tag);
}

/** Makes requireUser simulate an unauthenticated caller by invoking the redirect. */
function denyAuth() {
  state().requireUser = async (redir) => {
    redir("/login");
    throw new Error("unreachable");
  };
}

// ---------------------------------------------------------------------------
// changePlanAction
// ---------------------------------------------------------------------------

describe("changePlanAction", () => {
  it("redirects unauthenticated callers without touching the provider", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.changePlanAction("plus"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("changePlan").length, 0);
  });

  it("rejects an unrecognized plan without calling the provider", async () => {
    const result = await actions.changePlanAction("ultra");

    assert.deepEqual(result, { ok: false, error: "Invalid plan: ultra." });
    assert.equal(callsOf("changePlan").length, 0);
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("surfaces a provider failure without revalidating", async () => {
    state().changePlan = async () => ({
      success: false,
      message: "Payment method declined.",
    });

    const result = await actions.changePlanAction("plus");

    assert.deepEqual(result, {
      ok: false,
      error: "Payment method declined.",
    });
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("maps a thrown provider error to safe feedback and logs the operation", async () => {
    const providerError = new Error("provider transport included a secret");
    state().changePlan = async () => {
      throw providerError;
    };

    const result = await actions.changePlanAction("plus");

    assert.deepEqual(result, {
      ok: false,
      error: "Could not update billing. Please try again.",
    });
    assert.deepEqual(callsOf("logError"), [
      [
        "logError",
        "billing.plan-change",
        providerError,
        { targetPlan: "plus" },
      ],
    ]);
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("changes the plan for the session user, revalidates settings pages, and returns the result payload", async () => {
    state().changePlan = async (userId, plan) => {
      state().calls.push(["changePlan", userId, plan]);
      return {
        success: true,
        message: "Switched to the plus plan.",
        redirectUrl: "/app/settings/billing?upgraded=1",
      };
    };

    const result = await actions.changePlanAction("plus");

    assert.deepEqual(result, {
      ok: true,
      data: {
        message: "Switched to the plus plan.",
        redirectUrl: "/app/settings/billing?upgraded=1",
      },
    });
    assert.deepEqual(callsOf("changePlan"), [["changePlan", "user-1", "plus"]]);
    assert.deepEqual(callsOf("revalidatePath"), [
      ["revalidatePath", "/app/settings/billing"],
      ["revalidatePath", "/app/settings"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// cancelSubscriptionAction
// ---------------------------------------------------------------------------

describe("cancelSubscriptionAction", () => {
  it("redirects unauthenticated callers without touching the provider", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.cancelSubscriptionAction(),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("cancelSubscription").length, 0);
  });

  it("surfaces a provider failure without revalidating", async () => {
    state().cancelSubscription = async () => ({
      success: false,
      message: "No active subscription to cancel.",
    });

    const result = await actions.cancelSubscriptionAction();

    assert.deepEqual(result, {
      ok: false,
      error: "No active subscription to cancel.",
    });
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("maps a thrown provider error to safe feedback and logs the operation", async () => {
    const providerError = new Error("provider cancellation failed");
    state().cancelSubscription = async () => {
      throw providerError;
    };

    const result = await actions.cancelSubscriptionAction();

    assert.deepEqual(result, {
      ok: false,
      error: "Could not update billing. Please try again.",
    });
    assert.deepEqual(callsOf("logError"), [
      ["logError", "billing.subscription-cancel", providerError, undefined],
    ]);
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("cancels the subscription for the session user and revalidates settings pages", async () => {
    const result = await actions.cancelSubscriptionAction();

    assert.deepEqual(result, {
      ok: true,
      data: { message: "Subscription canceled." },
    });
    assert.deepEqual(callsOf("cancelSubscription"), [
      ["cancelSubscription", "user-1"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [
      ["revalidatePath", "/app/settings/billing"],
      ["revalidatePath", "/app/settings"],
    ]);
  });
});
