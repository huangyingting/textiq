import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";

type BillingPageRuntimeTestState = {
  loaderError: Error;
  redirects: string[];
};

const globalForTest = globalThis as typeof globalThis & {
  __billingPageRuntimeTestState: BillingPageRuntimeTestState;
};

function resetState() {
  globalForTest.__billingPageRuntimeTestState = {
    loaderError: new Error("billing state unavailable"),
    redirects: [],
  };
}

resetState();

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

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const stubPrefix = "textiq-billing-page-runtime-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function redirect(url) {
        globalThis.__billingPageRuntimeTestState.redirects.push(url);
        throw new Error(\`NEXT_REDIRECT:\${url}\`);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser() {
        return { id: "user-1", email: "user@example.test" };
      }
    `,
  ],
  [
    "@/lib/billing/service",
    `
      export async function loadAndSyncBillingState() {
        throw globalThis.__billingPageRuntimeTestState.loaderError;
      }
    `,
  ],
  [
    "./billing-actions",
    `
      export function BillingActions() { return null; }
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

type BillingPageModule = typeof import("./page");
let BillingPage: BillingPageModule["default"];

before(async () => {
  ({ default: BillingPage } = await import("./page"));
});

beforeEach(resetState);

test("authenticated billing load failures reach the app error boundary instead of redirecting to login", async () => {
  const state = globalForTest.__billingPageRuntimeTestState;

  await assert.rejects(
    () => BillingPage(),
    (error) => {
      assert.equal(error, state.loaderError);
      return true;
    },
  );
  assert.deepEqual(state.redirects, []);
});
