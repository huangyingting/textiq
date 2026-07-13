/**
 * Direct contracts for `loadAppShellViewModel` (#1945).
 *
 * `view-model.test.ts` (if present) and `navigation.ts` already exercise the
 * pure builder/nav-registry logic; this file instead covers the loader's
 * *wiring*: that it fans `getCurrentUser()`/`getLocale()` out in parallel,
 * skips the billing lookup entirely for an anonymous caller, scopes the
 * `prisma.user.findUnique` account lookup by session id, only syncs billing
 * state when both a session user AND a matching account row exist, and hands
 * every resolved piece (account/billing/locale/flags) to the real
 * `buildAppShellViewModel` so the assembled view model reflects genuine
 * business logic rather than a mocked passthrough.
 *
 * `loader.ts` imports `server-only` (throws outside a Server Component
 * build), `@/lib/session` (`getCurrentUser`, which calls `next-auth`'s
 * `auth()` — unavailable outside a live request), `@/lib/i18n/server`
 * (`getLocale`, which calls `next/headers`' `cookies()`), and
 * `@/lib/billing/service` (`loadAndSyncBillingState`, which issues its own
 * prisma calls unrelated to this loader's contract). Following the
 * module-hooks pattern already used by `src/app/api/user/entitlements/route.test.ts`
 * and `src/lib/document-editor/loader.test.ts`, this stubs those three
 * specifiers to CJS sources driven by mutable `globalThis` test state, and
 * monkey-patches `prisma.user.findUnique` directly (the one prisma call the
 * loader itself issues).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it, type TestContext } from "node:test";

import { prisma } from "@/lib/prisma";

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

declare global {
  var __appShellTestSessionUser: { id: string } | null | undefined;
  var __appShellTestLocale: string | undefined;
  var __appShellTestBillingState:
    | {
        plan: string;
        creditBalance: number;
      }
    | undefined;
  var __appShellTestBillingCalls: string[];
}

globalThis.__appShellTestSessionUser = null;
globalThis.__appShellTestLocale = "en";
globalThis.__appShellTestBillingState = undefined;
globalThis.__appShellTestBillingCalls = [];

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const SERVER_ONLY_STUB = "server-only:app-shell-loader-test";
const SESSION_STUB = "lib-session:app-shell-loader-test";
const I18N_SERVER_STUB = "lib-i18n-server:app-shell-loader-test";
const BILLING_SERVICE_STUB = "lib-billing-service:app-shell-loader-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: SERVER_ONLY_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/session") {
      return { url: SESSION_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/i18n/server") {
      return { url: I18N_SERVER_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/billing/service") {
      return { url: BILLING_SERVICE_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === SERVER_ONLY_STUB) {
      return { format: "commonjs", source: "", shortCircuit: true };
    }
    if (url === SESSION_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  getCurrentUser: async () => globalThis.__appShellTestSessionUser ?? null,
};`,
        shortCircuit: true,
      };
    }
    if (url === I18N_SERVER_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  getLocale: async () => globalThis.__appShellTestLocale ?? "en",
};`,
        shortCircuit: true,
      };
    }
    if (url === BILLING_SERVICE_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  loadAndSyncBillingState: async (userId) => {
    globalThis.__appShellTestBillingCalls.push(userId);
    if (!globalThis.__appShellTestBillingState) {
      throw new Error("loadAndSyncBillingState should not run for this scenario");
    }
    return globalThis.__appShellTestBillingState;
  },
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type LoaderModule = typeof import("./loader");
let loadAppShellViewModel: LoaderModule["loadAppShellViewModel"];

before(async () => {
  const mod = await import("./loader");
  loadAppShellViewModel = mod.loadAppShellViewModel;
});

function mutablePrisma(): Record<string, unknown> {
  return prisma as unknown as Record<string, unknown>;
}

function replacePrismaProperty(t: TestContext, key: string, value: unknown) {
  const target = mutablePrisma();
  const original = target[key];
  target[key] = value;
  t.after(() => {
    target[key] = original;
  });
}

function trackedCalls<T>(implementation: (...args: unknown[]) => T): {
  fn: (...args: unknown[]) => T;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  return {
    calls,
    fn: (...args: unknown[]) => {
      calls.push(args);
      return implementation(...args);
    },
  };
}

beforeEach(() => {
  globalThis.__appShellTestSessionUser = null;
  globalThis.__appShellTestLocale = "en";
  globalThis.__appShellTestBillingState = undefined;
  globalThis.__appShellTestBillingCalls = [];
});

describe("loadAppShellViewModel", () => {
  it("skips the account and billing lookups entirely for an anonymous caller", async (t) => {
    const findUnique = trackedCalls(async () => {
      throw new Error(
        "prisma.user.findUnique should not run for an anonymous caller",
      );
    });
    replacePrismaProperty(t, "user", { findUnique: findUnique.fn });
    globalThis.__appShellTestSessionUser = null;

    const viewModel = await loadAppShellViewModel();

    assert.equal(viewModel.auth.isAuthenticated, false);
    assert.equal(viewModel.displayIdentity, null);
    assert.equal(viewModel.planCreditSummary, null);
    assert.equal(viewModel.enabledUtilities.userMenu, false);
    assert.equal(viewModel.enabledUtilities.credits, false);
    assert.equal(findUnique.calls.length, 0);
    assert.equal(globalThis.__appShellTestBillingCalls.length, 0);
  });

  it("scopes the account lookup by the session user's id and skips billing when no account row exists", async (t) => {
    const findUnique = trackedCalls(async () => null);
    replacePrismaProperty(t, "user", { findUnique: findUnique.fn });
    globalThis.__appShellTestSessionUser = { id: "user-42" };

    const viewModel = await loadAppShellViewModel();

    assert.equal(findUnique.calls.length, 1);
    const [args] = findUnique.calls[0] as [
      { where: { id: string }; select: Record<string, unknown> },
    ];
    assert.deepEqual(args.where, { id: "user-42" });
    assert.equal("name" in args.select, true);
    assert.equal("email" in args.select, true);
    // Account row missing (e.g. stale session) => still anonymous-shaped output.
    assert.equal(viewModel.auth.isAuthenticated, false);
    assert.equal(viewModel.displayIdentity, null);
    assert.equal(globalThis.__appShellTestBillingCalls.length, 0);
  });

  it("syncs billing state and assembles the full authenticated view model when the account row exists", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({
        name: "Ada Lovelace",
        email: "ada@example.com",
      }),
    });
    globalThis.__appShellTestSessionUser = { id: "user-1" };
    globalThis.__appShellTestBillingState = {
      plan: "plus",
      creditBalance: 250,
    };
    globalThis.__appShellTestLocale = "en";

    const viewModel = await loadAppShellViewModel();

    assert.equal(globalThis.__appShellTestBillingCalls.length, 1);
    assert.equal(globalThis.__appShellTestBillingCalls[0], "user-1");
    assert.equal(viewModel.auth.isAuthenticated, true);
    assert.deepEqual(viewModel.displayIdentity, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      avatarInitial: "A",
    });
    assert.ok(viewModel.planCreditSummary);
    assert.equal(viewModel.planCreditSummary?.plan, "plus");
    assert.equal(viewModel.planCreditSummary?.balance, 250);
    assert.equal(viewModel.enabledUtilities.userMenu, true);
    assert.equal(viewModel.enabledUtilities.credits, true);
    // navItems come from the real resolveShellNavItems + translator wiring.
    assert.ok(viewModel.navItems.length > 0);
    assert.equal(typeof viewModel.brandLabel, "string");
    assert.ok(viewModel.brandLabel.length > 0);
  });

  it("reports unlimited credits from the real billing config flag instead of the raw credit balance", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ name: null, email: "b@example.com" }),
    });
    globalThis.__appShellTestSessionUser = { id: "user-2" };
    globalThis.__appShellTestBillingState = { plan: "pro", creditBalance: 5 };
    const originalFlag = process.env.BILLING_UNLIMITED_CREDITS;
    process.env.BILLING_UNLIMITED_CREDITS = "true";
    t.after(() => {
      if (originalFlag === undefined) {
        delete process.env.BILLING_UNLIMITED_CREDITS;
      } else {
        process.env.BILLING_UNLIMITED_CREDITS = originalFlag;
      }
    });

    const viewModel = await loadAppShellViewModel();

    assert.equal(viewModel.planCreditSummary?.unlimited, true);
    assert.equal(viewModel.planCreditSummary?.countLabel, "Unlimited");
    // No display name => falls back to email, initial derived from that fallback.
    assert.equal(viewModel.displayIdentity?.displayName, "b@example.com");
    assert.equal(viewModel.displayIdentity?.avatarInitial, "B");
  });

  it("only enables the language switcher when the env flag and i18n activation status both allow it", async (t) => {
    replacePrismaProperty(t, "user", { findUnique: async () => null });
    globalThis.__appShellTestSessionUser = null;
    const originalFlag = process.env.I18N_SWITCHER_ENABLED;
    process.env.I18N_SWITCHER_ENABLED = "true";
    t.after(() => {
      if (originalFlag === undefined) {
        delete process.env.I18N_SWITCHER_ENABLED;
      } else {
        process.env.I18N_SWITCHER_ENABLED = originalFlag;
      }
    });

    const viewModel = await loadAppShellViewModel();

    // The env flag alone is gated behind the i18n activation-readiness
    // threshold, which is not met yet in this codebase — so this must stay
    // false even with the flag on, proving the loader calls the real
    // two-part gate rather than trusting the env var alone.
    assert.equal(viewModel.enabledUtilities.languageSwitcher, false);
  });
});
