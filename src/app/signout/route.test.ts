/**
 * Action-boundary coverage for the `/signout` route handler (`route.ts`)
 * (#1948).
 *
 * Module-hook strategy (matching `src/app/login/actions.test.ts`): `@/auth`
 * is stubbed so the full NextAuth config never loads, and `next/navigation`
 * is stubbed so `redirect` is observable instead of throwing Next's internal
 * `NEXT_REDIRECT` control-flow signal. This asserts the ordering contract
 * documented on `GET` — the session must be cleared *before* the redirect
 * fires — and that a `signOut` failure propagates instead of silently
 * clearing the cookie or still redirecting to `/login`.
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

type SignoutRouteTestState = {
  calls: string[];
  signOut: (options: { redirect: boolean }) => Promise<void>;
  redirect: (url: string) => never;
};

const globalForSignout = globalThis as typeof globalThis & {
  __signoutRouteTestState: SignoutRouteTestState;
};

function createDefaultState(): SignoutRouteTestState {
  const calls: string[] = [];
  return {
    calls,
    async signOut() {
      calls.push("signOut");
    },
    redirect(url: string): never {
      calls.push(`redirect:${url}`);
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
  };
}

globalForSignout.__signoutRouteTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-signout-route-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/auth",
    `
      export async function signOut(options) {
        return globalThis.__signoutRouteTestState.signOut(options);
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__signoutRouteTestState.redirect(url);
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

type RouteModule = typeof import("./route");

let route: RouteModule;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  globalForSignout.__signoutRouteTestState = createDefaultState();
});

function state(): SignoutRouteTestState {
  return globalForSignout.__signoutRouteTestState;
}

describe("GET /signout", () => {
  it("clears the session (redirect: false) before redirecting to /login", async () => {
    await assert.rejects(() => route.GET(), /NEXT_REDIRECT:\/login/);

    assert.deepEqual(state().calls, ["signOut", "redirect:/login"]);
  });

  it("passes { redirect: false } so NextAuth never issues its own redirect", async () => {
    let observedOptions: unknown;
    state().signOut = async (options) => {
      observedOptions = options;
      state().calls.push("signOut");
    };

    await assert.rejects(() => route.GET(), /NEXT_REDIRECT:\/login/);

    assert.deepEqual(observedOptions, { redirect: false });
  });

  it("propagates a signOut failure without redirecting", async () => {
    state().signOut = async () => {
      state().calls.push("signOut");
      throw new Error("session store unavailable");
    };

    await assert.rejects(() => route.GET(), /session store unavailable/);

    assert.deepEqual(state().calls, ["signOut"]);
  });
});
