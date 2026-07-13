/**
 * Direct contract coverage for `publicShareBudgetExceeded` and
 * `publicSharePasscodeBudgetExceeded` (#1945).
 *
 * Both functions are thin wiring around `@/lib/abuse-budget` (already
 * covered end-to-end against a real rate-limit store in
 * `src/lib/abuse-budget.test.ts`): they resolve the abuse-budget secret,
 * derive a namespace-scoped subject, and invert `allowed` into an
 * "exceeded" boolean. This file stubs `@/lib/abuse-budget` via a module
 * hook so the namespace/subject/secret wiring and the allow/deny boundary
 * are asserted without touching the real rate-limit store, and stubs
 * `next/headers`'s `headers()` (used only by `publicShareBudgetExceeded`,
 * which reads the request headers itself) since it throws outside a live
 * Next.js request context — the same pattern used by
 * `src/app/api/share-passcode/unlock/route.test.ts`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, before, test } from "node:test";

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

type CheckAbuseBudgetCall = {
  namespace: string;
  subject: string;
  secret: string;
};

type AbuseTestState = {
  secret: string | undefined;
  allowed: boolean;
  clientSubject: string;
  checkCalls: CheckAbuseBudgetCall[];
  getClientSubjectCalls: unknown[];
};

const globalForAbuse = globalThis as typeof globalThis & {
  __publicAbuseTestState: AbuseTestState;
  __publicAbuseHeaders: Headers;
};

function createDefaultState(): AbuseTestState {
  return {
    secret: "test-secret",
    allowed: true,
    clientSubject: "203.0.113.5",
    checkCalls: [],
    getClientSubjectCalls: [],
  };
}

globalForAbuse.__publicAbuseTestState = createDefaultState();
globalForAbuse.__publicAbuseHeaders = new Headers({
  "x-forwarded-for": "203.0.113.5",
});

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-public-abuse-test:";

const stubbedModules = new Map<string, string>([
  [
    "next/headers",
    `
      export async function headers() {
        return globalThis.__publicAbuseHeaders;
      }
    `,
  ],
  [
    "@/lib/abuse-budget",
    `
      export function requireAbuseBudgetSecret() {
        return globalThis.__publicAbuseTestState.secret;
      }
      export function getClientSubject(headers) {
        globalThis.__publicAbuseTestState.getClientSubjectCalls.push(headers);
        return globalThis.__publicAbuseTestState.clientSubject;
      }
      export async function checkAbuseBudget({ namespace, subject, secret }) {
        globalThis.__publicAbuseTestState.checkCalls.push({ namespace, subject, secret });
        return { allowed: globalThis.__publicAbuseTestState.allowed };
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

type PublicAbuseModule = typeof import("./public-abuse");
let publicShareBudgetExceeded: PublicAbuseModule["publicShareBudgetExceeded"];
let publicSharePasscodeBudgetExceeded: PublicAbuseModule["publicSharePasscodeBudgetExceeded"];

before(async () => {
  const mod = await import("./public-abuse");
  publicShareBudgetExceeded = mod.publicShareBudgetExceeded;
  publicSharePasscodeBudgetExceeded = mod.publicSharePasscodeBudgetExceeded;
});

afterEach(() => {
  globalForAbuse.__publicAbuseTestState = createDefaultState();
});

function state(): AbuseTestState {
  return globalForAbuse.__publicAbuseTestState;
}

// ---------------------------------------------------------------------------
// publicShareBudgetExceeded
// ---------------------------------------------------------------------------

test("publicShareBudgetExceeded returns false without checking the budget when no abuse-budget secret is configured", async () => {
  state().secret = undefined;

  const exceeded = await publicShareBudgetExceeded();

  assert.equal(exceeded, false);
  assert.equal(state().checkCalls.length, 0);
  assert.equal(state().getClientSubjectCalls.length, 0);
});

test("publicShareBudgetExceeded checks the public.share.ip namespace with the request-header client subject", async () => {
  state().allowed = true;

  const exceeded = await publicShareBudgetExceeded();

  assert.equal(exceeded, false);
  assert.equal(state().checkCalls.length, 1);
  assert.deepEqual(state().checkCalls[0], {
    namespace: "public.share.ip",
    subject: "203.0.113.5",
    secret: "test-secret",
  });
  assert.equal(state().getClientSubjectCalls.length, 1);
  assert.equal(
    state().getClientSubjectCalls[0],
    globalForAbuse.__publicAbuseHeaders,
  );
});

test("publicShareBudgetExceeded returns true once the budget denies the request", async () => {
  state().allowed = false;

  const exceeded = await publicShareBudgetExceeded();

  assert.equal(exceeded, true);
});

// ---------------------------------------------------------------------------
// publicSharePasscodeBudgetExceeded
// ---------------------------------------------------------------------------

test("publicSharePasscodeBudgetExceeded returns false without checking the budget when no secret is configured", async () => {
  state().secret = undefined;

  const exceeded = await publicSharePasscodeBudgetExceeded(
    "share-123",
    new Headers(),
  );

  assert.equal(exceeded, false);
  assert.equal(state().checkCalls.length, 0);
});

test("publicSharePasscodeBudgetExceeded scopes the public.share-passcode.ip namespace's subject to the client subject and shareId", async () => {
  state().allowed = true;
  const requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.9" });
  state().clientSubject = "198.51.100.9";

  const exceeded = await publicSharePasscodeBudgetExceeded(
    "share-xyz",
    requestHeaders,
  );

  assert.equal(exceeded, false);
  assert.equal(state().checkCalls.length, 1);
  assert.deepEqual(state().checkCalls[0], {
    namespace: "public.share-passcode.ip",
    subject: "198.51.100.9:share-xyz",
    secret: "test-secret",
  });
  assert.equal(state().getClientSubjectCalls[0], requestHeaders);
});

test("publicSharePasscodeBudgetExceeded returns true once the budget denies the request", async () => {
  state().allowed = false;

  const exceeded = await publicSharePasscodeBudgetExceeded(
    "share-abc",
    new Headers(),
  );

  assert.equal(exceeded, true);
});
