/**
 * Behavioral tests for GET /api/brand (#1881).
 *
 * Invokes the actual GET handler with stubbed dependencies so no real DB or
 * Auth.js session is required. Covers:
 *   - Unauthenticated caller → 401 canonical body
 *   - Authenticated caller → 200 with `{ brands: BrandStyle[] }`, scoped to the
 *     caller's own brands, ordered ascending by creation, with asset-backed
 *     logo/font URLs resolved via the shared serializer
 *
 * Module-hook strategy: `next/headers` is stubbed to an empty cookie store so
 * `auth()` never throws outside a request scope. `@/lib/session` is replaced
 * with a CJS stub driven by `global.__testBrandListUser`, which lets each test
 * control what `getCurrentUser()` returns without touching production code
 * (same pattern as `src/app/api/user/entitlements/route.test.ts`).
 * `prisma.brand.findMany` / `prisma.asset.findMany` are replaced via
 * `Object.defineProperty` (same pattern as `upload-route-service.test.ts`).
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

const NEXT_HEADERS_STUB = "next-headers:brand-list-stub";
const SESSION_STUB = "lib-session:brand-list-stub";

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
  getCurrentUser: async () => global.__testBrandListUser ?? null,
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
  var __testBrandListUser:
    { id: string; sessionInvalidatedAt: Date | null } | null | undefined;
}

type PrismaDelegate = { [key: string]: (...args: unknown[]) => unknown };

type TestContext = { after(fn: () => void): void };

function stubPrismaMethod<T extends object, K extends keyof T>(
  t: TestContext,
  object: T,
  methodName: K,
  implementation: (...args: unknown[]) => unknown,
): { calls: unknown[][] } {
  const original = object[methodName];
  const calls: unknown[][] = [];
  Object.defineProperty(object, methodName, {
    configurable: true,
    value: (...args: unknown[]) => {
      calls.push(args);
      return implementation(...args);
    },
  });
  t.after(() => {
    Object.defineProperty(object, methodName, {
      configurable: true,
      value: original,
    });
  });
  return { calls };
}

// ---------------------------------------------------------------------------
// Handler + Prisma — loaded after hooks are in place
// ---------------------------------------------------------------------------

let GET: () => Promise<Response>;
let prismaBrand: PrismaDelegate;
let prismaAsset: PrismaDelegate;

before(async () => {
  const route = await import("./route");
  GET = route.GET as () => Promise<Response>;

  const { prisma } = (await import("@/lib/prisma")) as unknown as {
    prisma: { brand: PrismaDelegate; asset: PrismaDelegate };
  };
  prismaBrand = prisma.brand;
  prismaAsset = prisma.asset;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_ID = "owner-brand-1";
const NOW = new Date("2026-07-11T00:00:00Z");
const LATER = new Date("2026-07-11T01:00:00Z");

function brandRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "brand-1",
    name: "Acme",
    ownerId: OWNER_ID,
    palette: ["#111111", "#222222"],
    background: "#ffffff",
    nodeFill: "#eeeeee",
    nodeStroke: "#000000",
    nodeText: "#000000",
    edgeColor: "#999999",
    fontFamily: "'Inter', sans-serif",
    logoAssetId: null,
    fontAssetId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("brand list route opts into Node.js runtime", async () => {
  const { runtime } = await import("./route");
  assert.equal(runtime, "nodejs");
});

test("#1881: unauthenticated caller receives 401 with canonical error body", async (t) => {
  global.__testBrandListUser = null;

  const findMany = stubPrismaMethod(t, prismaBrand, "findMany", async () => {
    throw new Error("findMany should not run for an unauthenticated caller");
  });

  const resp = await GET();

  assert.equal(resp.status, 401);
  const body = (await resp.json()) as { error: string; code: string };
  assert.equal(body.code, "UNAUTHORIZED");
  assert.match(body.error, /Unauthorized/);
  assert.equal(findMany.calls.length, 0);
});

test("#1881: authenticated caller receives their own brands scoped by owner, oldest first", async (t) => {
  global.__testBrandListUser = { id: OWNER_ID, sessionInvalidatedAt: null };
  t.after(() => {
    global.__testBrandListUser = null;
  });

  const findMany = stubPrismaMethod(t, prismaBrand, "findMany", async () => [
    brandRow({ id: "brand-1", createdAt: NOW }),
    brandRow({ id: "brand-2", createdAt: LATER }),
  ]);
  stubPrismaMethod(t, prismaAsset, "findMany", async () => {
    throw new Error("asset lookup should not run when no brand has assets");
  });

  const resp = await GET();

  assert.equal(resp.status, 200);
  const body = (await resp.json()) as {
    brands: Array<{ id: string; ownerId: string }>;
  };
  assert.equal(body.brands.length, 2);
  assert.deepEqual(
    body.brands.map((b) => b.id),
    ["brand-1", "brand-2"],
  );
  assert.ok(body.brands.every((b) => b.ownerId === OWNER_ID));

  assert.equal(findMany.calls.length, 1);
  const [findManyArgs] = findMany.calls[0] as [
    { where: { ownerId: string }; orderBy: { createdAt: string } },
  ];
  assert.equal(findManyArgs.where.ownerId, OWNER_ID);
  assert.equal(findManyArgs.orderBy.createdAt, "asc");
});

test("#1881: response shape resolves logo/font asset ids to protected display URLs", async (t) => {
  global.__testBrandListUser = { id: OWNER_ID, sessionInvalidatedAt: null };
  t.after(() => {
    global.__testBrandListUser = null;
  });

  stubPrismaMethod(t, prismaBrand, "findMany", async () => [
    brandRow({
      id: "brand-with-assets",
      logoAssetId: "asset-logo-1",
      fontAssetId: "asset-font-1",
    }),
  ]);
  stubPrismaMethod(t, prismaAsset, "findMany", async () => [
    { id: "asset-logo-1", storageKey: `${OWNER_ID}/checksum-logo.png` },
    { id: "asset-font-1", storageKey: `${OWNER_ID}/checksum-font.woff2` },
  ]);

  const resp = await GET();

  assert.equal(resp.status, 200);
  const body = (await resp.json()) as {
    brands: Array<{
      id: string;
      logoAssetId: string | null;
      fontAssetId: string | null;
      logoAssetUrl: string | null;
      fontAssetUrl: string | null;
    }>;
  };
  const [brand] = body.brands;
  assert.equal(brand.logoAssetId, "asset-logo-1");
  assert.equal(brand.fontAssetId, "asset-font-1");
  assert.match(brand.logoAssetUrl ?? "", /\/api\/brand-assets\//);
  assert.match(brand.fontAssetUrl ?? "", /\/api\/brand-assets\//);
});

test("#1881: empty brand list returns 200 with an empty array (no asset lookup)", async (t) => {
  global.__testBrandListUser = { id: OWNER_ID, sessionInvalidatedAt: null };
  t.after(() => {
    global.__testBrandListUser = null;
  });

  stubPrismaMethod(t, prismaBrand, "findMany", async () => []);
  const findManyAsset = stubPrismaMethod(
    t,
    prismaAsset,
    "findMany",
    async () => {
      throw new Error("asset lookup should not run for an empty brand list");
    },
  );

  const resp = await GET();

  assert.equal(resp.status, 200);
  const body = (await resp.json()) as { brands: unknown[] };
  assert.deepEqual(body.brands, []);
  assert.equal(findManyAsset.calls.length, 0);
});
