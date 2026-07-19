/**
 * Behavioral tests for GET /api/user/entitlements (#1853).
 *
 * Invokes the actual GET handler with stubbed dependencies so no real DB or
 * Auth.js session is required. Covers:
 *   - Unauthenticated caller → 401 canonical body
 *   - Free/Plus/Pro plan → 200 with correct entitlement flags
 *   - Billing provider failure → handler propagates the error
 *
 * Module-hook strategy: `next/headers` is stubbed to an empty cookie store so
 * auth() never throws outside a request scope. `@/lib/session` is replaced
 * with a CJS stub driven by `global.__testEntitlementUser`, which lets each
 * test control what getCurrentUser() returns without touching production code.
 * Prisma methods used by loadAndSyncBillingState are replaced via
 * Object.defineProperty (same pattern as entitlement-facade.test.ts).
 */

import { createRequire } from "node:module";
import { before, test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module hooks — must be registered before any handler import
// ---------------------------------------------------------------------------

const req = createRequire(import.meta.url);

const { registerHooks } = req("node:module") as {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (s: string, c: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (u: string, c: unknown) => unknown,
    ): unknown;
  }): void;
};

const NEXT_HEADERS_STUB = "next-headers:entitlements-stub";
const SESSION_STUB = "lib-session:entitlements-stub";

registerHooks({
  resolve(
    specifier: string,
    context: unknown,
    nextResolve: (s: string, c: unknown) => unknown,
  ) {
    if (specifier === "next/headers") {
      return { url: NEXT_HEADERS_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/session") {
      return { url: SESSION_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(
    url: string,
    context: unknown,
    nextLoad: (u: string, c: unknown) => unknown,
  ) {
    if (url === NEXT_HEADERS_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  headers: () => new Headers(),
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false }),
};`,
        shortCircuit: true,
      };
    }
    if (url === SESSION_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  getCurrentUser: async () => global.__testEntitlementUser ?? null,
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

declare global {
  var __testEntitlementUser:
    { id: string; sessionInvalidatedAt: Date | null } | null | undefined;
}

type PrismaUserDelegate = {
  findUniqueOrThrow: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};
type PrismaSubscriptionDelegate = {
  findUnique: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type TestContext = { after(fn: () => void): void };

/**
 * Stubs a single method on a Prisma delegate using the same
 * Object.defineProperty pattern as entitlement-facade.test.ts.
 */
function stubPrismaMethod<T extends object, K extends keyof T>(
  t: TestContext,
  object: T,
  methodName: K,
  implementation: (...args: unknown[]) => unknown,
): void {
  const original = object[methodName];
  Object.defineProperty(object, methodName, {
    configurable: true,
    value: (...args: unknown[]) => implementation(...args),
  });
  t.after(() => {
    Object.defineProperty(object, methodName, {
      configurable: true,
      value: original,
    });
  });
}

// ---------------------------------------------------------------------------
// Handler + Prisma — loaded after hooks are in place
// ---------------------------------------------------------------------------

let GET: () => Promise<Response>;
let prismaUser: PrismaUserDelegate;
let prismaSubscription: PrismaSubscriptionDelegate;

before(async () => {
  const route = await import("./route");
  GET = route.GET as () => Promise<Response>;

  const { prisma } = (await import("@/lib/prisma")) as unknown as {
    prisma: {
      user: PrismaUserDelegate;
      subscription: PrismaSubscriptionDelegate;
    };
  };
  prismaUser = prisma.user;
  prismaSubscription = prisma.subscription;
});

// ---------------------------------------------------------------------------
// Fixed billing state fixtures
// ---------------------------------------------------------------------------

const FRESH_PERIOD_START = new Date("2099-01-01T00:00:00Z");

function makePrismaUserRow(plan: string, balance: number) {
  return {
    plan,
    creditBalance: balance,
    creditPeriodStart: FRESH_PERIOD_START,
    subscription: null,
  };
}

function stubNoSubscriptionLookup(t: TestContext): void {
  stubPrismaMethod(t, prismaSubscription, "findUnique", async () => {
    throw new Error("subscription lookup should not run in entitlements route");
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("entitlements route opts into Node.js runtime", async () => {
  const { runtime } = await import("./route");
  assert.equal(runtime, "nodejs");
});

test("#1853: unauthenticated caller receives 401 with canonical error body", async () => {
  global.__testEntitlementUser = null;

  const resp = await GET();

  assert.equal(resp.status, 401);
  const body = (await resp.json()) as { error: string; code: string };
  assert.equal(body.code, "UNAUTHORIZED");
  assert.match(body.error, /Unauthorized/);
});

test("#1853: authenticated free-plan caller receives 200 with free entitlements", async (t) => {
  global.__testEntitlementUser = {
    id: "user-free-1",
    sessionInvalidatedAt: null,
  };
  t.after(() => {
    global.__testEntitlementUser = null;
  });

  stubPrismaMethod(t, prismaUser, "findUniqueOrThrow", async () =>
    makePrismaUserRow("free", 500),
  );
  stubNoSubscriptionLookup(t);

  const resp = await GET();

  assert.equal(resp.status, 200);
  const body = (await resp.json()) as {
    plan: string;
    creditBalance: number;
    entitlements: Record<string, unknown>;
  };
  assert.equal(body.plan, "free");
  assert.equal(body.creditBalance, 500);
  assert.equal(body.entitlements.svgExport, false, "free plan: no SVG export");
  assert.equal(
    body.entitlements.pptxExport,
    false,
    "free plan: no PPTX export",
  );
  assert.equal(
    body.entitlements.brandStyles,
    false,
    "free plan: no brand styles",
  );
  assert.equal(
    body.entitlements.fontUpload,
    false,
    "free plan: no font upload",
  );
});

test("#1853: authenticated plus-plan caller receives 200 with plus entitlements (font upload gated)", async (t) => {
  global.__testEntitlementUser = {
    id: "user-plus-1",
    sessionInvalidatedAt: null,
  };
  t.after(() => {
    global.__testEntitlementUser = null;
  });

  stubPrismaMethod(t, prismaUser, "findUniqueOrThrow", async () =>
    makePrismaUserRow("plus", 10_000),
  );
  stubNoSubscriptionLookup(t);

  const resp = await GET();

  assert.equal(resp.status, 200);
  const body = (await resp.json()) as {
    plan: string;
    creditBalance: number;
    entitlements: Record<string, unknown>;
  };
  assert.equal(body.plan, "plus");
  assert.equal(body.creditBalance, 10_000);
  assert.equal(
    body.entitlements.svgExport,
    true,
    "plus plan: SVG export enabled",
  );
  assert.equal(
    body.entitlements.pptxExport,
    true,
    "plus plan: PPTX export enabled",
  );
  assert.equal(
    body.entitlements.fontUpload,
    false,
    "plus plan: font upload still gated",
  );
});

test("#1853: authenticated pro-plan caller receives 200 with all paid entitlements", async (t) => {
  global.__testEntitlementUser = {
    id: "user-pro-1",
    sessionInvalidatedAt: null,
  };
  t.after(() => {
    global.__testEntitlementUser = null;
  });

  stubPrismaMethod(t, prismaUser, "findUniqueOrThrow", async () =>
    makePrismaUserRow("pro", 50_000),
  );
  stubNoSubscriptionLookup(t);

  const resp = await GET();

  assert.equal(resp.status, 200);
  const body = (await resp.json()) as {
    plan: string;
    creditBalance: number;
    entitlements: Record<string, unknown>;
  };
  assert.equal(body.plan, "pro");
  assert.equal(body.creditBalance, 50_000);
  assert.equal(
    body.entitlements.svgExport,
    true,
    "pro plan: SVG export enabled",
  );
  assert.equal(
    body.entitlements.pptxExport,
    true,
    "pro plan: PPTX export enabled",
  );
  assert.equal(
    body.entitlements.fontUpload,
    true,
    "pro plan: font upload enabled",
  );
  assert.equal(
    body.entitlements.removeWatermark,
    true,
    "pro plan: watermark removed",
  );
});

test("#1853: billing provider failure propagates out of the handler", async (t) => {
  global.__testEntitlementUser = {
    id: "user-err-1",
    sessionInvalidatedAt: null,
  };
  t.after(() => {
    global.__testEntitlementUser = null;
  });

  stubPrismaMethod(t, prismaUser, "findUniqueOrThrow", async () => {
    throw new Error("Billing DB unreachable");
  });
  stubNoSubscriptionLookup(t);

  await assert.rejects(GET(), (err: Error) => {
    assert.match(err.message, /Billing DB unreachable/);
    return true;
  });
});
