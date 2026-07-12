/**
 * Behavioral tests for POST /api/brand/logo (#1881).
 *
 * Invokes the actual POST handler with stubbed dependencies so no real DB,
 * Auth.js session, or filesystem access is required. Covers:
 *   - Unauthenticated caller → 401 (entitlement check and upload never run)
 *   - Authenticated but entitlement-denied caller → 403 with the exact
 *     `BRAND_STYLES_UPGRADE_MESSAGE`, and proves auth is checked before
 *     entitlements (401 short-circuits before the entitlement lookup) and
 *     entitlements are checked before upload processing (403 fires even for a
 *     request with no valid multipart body)
 *   - Malformed upload (missing `logo` field) → the route forwards the
 *     `uploadBrandLogo` validation failure's exact status/message (validation
 *     itself is owned and covered by `upload-route-service.test.ts`)
 *   - Successful upload → 200 with `{ url, assetId, mime }`, with the asset
 *     actually persisted through `storeBrandAsset`
 *
 * Module-hook strategy: `server-only` is stubbed (the route transitively
 * imports `@/lib/brand/upload-route-service`, which is `server-only`).
 * `next/headers` is stubbed to an empty cookie store. `@/lib/session` is
 * replaced with a CJS stub driven by `global.__testBrandLogoUser` (same
 * pattern as `src/app/api/user/entitlements/route.test.ts`). Prisma methods
 * are replaced via `Object.defineProperty` (same pattern as
 * `upload-route-service.test.ts`), and the storage adapter is swapped via the
 * existing `setBrandStorageAdapter` / `resetBrandStorageAdapter` DI seam.
 */

import { createRequire } from "node:module";
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  resetBrandStorageAdapter,
  setBrandStorageAdapter,
} from "@/lib/brand/asset-storage";
import { BRAND_STYLES_UPGRADE_MESSAGE } from "@/lib/billing/brand-entitlements";

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

const SERVER_ONLY_STUB = "server-only:brand-logo-stub";
const NEXT_HEADERS_STUB = "next-headers:brand-logo-stub";
const SESSION_STUB = "lib-session:brand-logo-stub";

registerHooks({
  resolve(
    specifier: string,
    context: unknown,
    nextResolve: (s: string, c: unknown) => unknown,
  ) {
    if (specifier === "server-only") {
      return { url: SERVER_ONLY_STUB, shortCircuit: true };
    }
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
    if (url === SERVER_ONLY_STUB) {
      return { format: "commonjs" as const, source: "", shortCircuit: true };
    }
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
  getCurrentUser: async () => global.__testBrandLogoUser ?? null,
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
  var __testBrandLogoUser:
    | { id: string; sessionInvalidatedAt: Date | null }
    | null
    | undefined;
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

function memoryStorageAdapter(writes: string[]) {
  return {
    async store(key: string) {
      writes.push(key);
      return `/api/brand-assets/${key}`;
    },
    urlFor(key: string) {
      return `/api/brand-assets/${key}`;
    },
    async read() {
      return Buffer.from("");
    },
    async delete() {},
  };
}

// ---------------------------------------------------------------------------
// Handler + Prisma — loaded after hooks are in place
// ---------------------------------------------------------------------------

let POST: (request: NextRequest) => Promise<Response>;
let prismaUser: PrismaDelegate;
let prismaAsset: PrismaDelegate;
let prismaBrand: PrismaDelegate;

before(async () => {
  const route = await import("./route");
  POST = route.POST as (request: NextRequest) => Promise<Response>;

  const { prisma } = (await import("@/lib/prisma")) as unknown as {
    prisma: {
      user: PrismaDelegate;
      asset: PrismaDelegate;
      brand: PrismaDelegate;
    };
  };
  prismaUser = prisma.user;
  prismaAsset = prisma.asset;
  prismaBrand = prisma.brand;
});

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0x01, 0x00, 0, 0, 0x02, 0x00,
]);

function buildLogoRequest(): NextRequest {
  const formData = new FormData();
  formData.set(
    "logo",
    new File([Uint8Array.from(PNG_BYTES)], "logo.png", { type: "image/png" }),
  );
  return new NextRequest("http://localhost/api/brand/logo", {
    method: "POST",
    body: formData,
  });
}

function buildEmptyRequest(): NextRequest {
  return new NextRequest("http://localhost/api/brand/logo", {
    method: "POST",
    body: new FormData(),
  });
}

function stubFreePlan(t: TestContext) {
  stubPrismaMethod(t, prismaUser, "findUnique", async () => ({
    plan: "free",
  }));
}

function stubPaidPlan(t: TestContext, plan: "plus" | "pro" = "plus") {
  stubPrismaMethod(t, prismaUser, "findUnique", async () => ({ plan }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("brand logo upload route opts into Node.js runtime", async () => {
  const { runtime } = await import("./route");
  assert.equal(runtime, "nodejs");
});

test("#1881: unauthenticated caller receives 401 before any entitlement lookup", async (t) => {
  global.__testBrandLogoUser = null;

  const userFindUnique = stubPrismaMethod(
    t,
    prismaUser,
    "findUnique",
    async () => {
      throw new Error("entitlement lookup should not run when unauthenticated");
    },
  );

  const resp = await POST(buildLogoRequest());

  assert.equal(resp.status, 401);
  const body = (await resp.json()) as { error: string; code: string };
  assert.equal(body.code, "UNAUTHORIZED");
  assert.match(body.error, /Unauthorized/);
  assert.equal(userFindUnique.calls.length, 0);
});

test("#1881: entitlement-denied caller receives 403 with the exact upgrade message before upload processing", async (t) => {
  global.__testBrandLogoUser = {
    id: "user-free-1",
    sessionInvalidatedAt: null,
  };
  t.after(() => {
    global.__testBrandLogoUser = null;
  });

  stubFreePlan(t);
  const assetFindUnique = stubPrismaMethod(
    t,
    prismaAsset,
    "findUnique",
    async () => {
      throw new Error("upload processing should not run for a denied caller");
    },
  );

  // No valid multipart body at all — proves the 403 fires from the
  // entitlement gate, before the route ever attempts to read/validate the
  // upload body.
  const resp = await POST(
    new NextRequest("http://localhost/api/brand/logo", {
      method: "POST",
      body: "not-multipart",
    }),
  );

  assert.equal(resp.status, 403);
  const body = (await resp.json()) as { error: string; code: string };
  assert.equal(body.code, "FORBIDDEN");
  assert.equal(body.error, BRAND_STYLES_UPGRADE_MESSAGE);
  assert.equal(assetFindUnique.calls.length, 0);
});

test("#1881: malformed upload missing the logo field surfaces the handler's exact 400", async (t) => {
  global.__testBrandLogoUser = {
    id: "user-plus-1",
    sessionInvalidatedAt: null,
  };
  t.after(() => {
    global.__testBrandLogoUser = null;
  });

  stubPaidPlan(t, "plus");

  const resp = await POST(buildEmptyRequest());

  assert.equal(resp.status, 400);
  const body = (await resp.json()) as { error: string; code: string };
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.equal(body.error, "Missing `logo` field in form data.");
});

test("#1881: successful upload returns 200 with { url, assetId, mime } and persists the asset", async (t) => {
  global.__testBrandLogoUser = {
    id: "user-plus-2",
    sessionInvalidatedAt: null,
  };
  t.after(() => {
    global.__testBrandLogoUser = null;
    resetBrandStorageAdapter();
  });

  stubPaidPlan(t, "plus");
  const writes: string[] = [];
  setBrandStorageAdapter(memoryStorageAdapter(writes));

  stubPrismaMethod(t, prismaAsset, "findUnique", async () => null);
  const created = stubPrismaMethod(t, prismaAsset, "create", async () => ({
    id: "asset-logo-created",
  }));
  stubPrismaMethod(t, prismaBrand, "findFirst", async () => {
    throw new Error("brand lookup should not run without a brandId");
  });

  const resp = await POST(buildLogoRequest());

  assert.equal(resp.status, 200);
  const body = (await resp.json()) as {
    url: string;
    assetId: string;
    mime: string;
  };
  assert.equal(body.assetId, "asset-logo-created");
  assert.equal(body.mime, "image/png");
  assert.match(body.url, /^\/api\/brand-assets\//);
  assert.equal(created.calls.length, 1);
  assert.equal(writes.length, 1);
});
