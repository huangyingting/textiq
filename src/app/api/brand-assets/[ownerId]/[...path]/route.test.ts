/**
 * Behavioral tests for GET /api/brand-assets/[ownerId]/[...path] (#1853).
 *
 * Invokes the actual GET handler with stubbed dependencies so no real DB,
 * Auth.js session, or filesystem access is required. Covers:
 *   - Missing asset (privacy 404 — existence must not leak)
 *   - Unauthenticated caller → same privacy 404 without asset lookup
 *   - Authenticated wrong-owner caller → same privacy 404 without asset lookup
 *   - Authenticated owner, happy path → 200 with bytes and cache headers
 *   - Storage adapter failure → 404 (handler absorbs the error)
 *
 * Module-hook strategy:
 *   - `next/headers` is stubbed to an empty cookie store.
 *   - `@/lib/session` is replaced with a CJS stub driven by
 *     `global.__testBrandAssetUser`.
 *   - `@/lib/abuse-budget` is partially stubbed so `requireAbuseBudgetSecret`
 *     returns `undefined`, bypassing the IP rate-limit DB call. This keeps the
 *     tests focused on handler logic and mirrors how the slide-assets test suite
 *     avoids rate-limit infrastructure.
 *   - `prisma.asset.findFirst` is replaced via Object.defineProperty (same
 *     pattern as upload-route-service.test.ts).
 *   - `setBrandStorageAdapter` / `resetBrandStorageAdapter` inject a minimal
 *     in-memory adapter for the happy-path and failure-path tests.
 */

import { createRequire } from "node:module";
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  setBrandStorageAdapter,
  resetBrandStorageAdapter,
} from "@/lib/brand/asset-storage";

// ---------------------------------------------------------------------------
// Module hooks — must be registered before handler import
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

const NEXT_HEADERS_STUB = "next-headers:brand-assets-stub";
const SESSION_STUB = "lib-session:brand-assets-stub";
const ABUSE_BUDGET_STUB = "lib-abuse-budget:brand-assets-stub";
const THEME_PERSISTENCE_STUB = "theme-persistence:brand-assets-stub";
const SHARE_PASSCODE_STUB = "share-passcode:brand-assets-stub";

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
    if (specifier === "@/lib/abuse-budget") {
      return { url: ABUSE_BUDGET_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/presentation/brand-kit/persistence") {
      return { url: THEME_PERSISTENCE_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/share-passcode-server") {
      return { url: SHARE_PASSCODE_STUB, shortCircuit: true };
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
  getCurrentUser: async () => global.__testBrandAssetUser ?? null,
};`,
        shortCircuit: true,
      };
    }
    if (url === ABUSE_BUDGET_STUB) {
      // requireAbuseBudgetSecret returns undefined → rate-limit block is skipped.
      // checkAbuseBudget and getClientSubject are exported but never called.
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  requireAbuseBudgetSecret: () => undefined,
  checkAbuseBudget: async () => { throw new Error("checkAbuseBudget should not be called in tests"); },
  getClientSubject: () => "unknown",
};`,
        shortCircuit: true,
      };
    }
    if (url === THEME_PERSISTENCE_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  loadCustomThemePackagesForDeckJson: async () => ({
    activePackage: global.__testBrandAssetThemePackage,
  }),
};`,
        shortCircuit: true,
      };
    }
    if (url === SHARE_PASSCODE_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  isPublicSharePasscodeUnlocked: async () => true,
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
  var __testBrandAssetUser:
    { id: string; sessionInvalidatedAt: Date | null } | null | undefined;
  var __testBrandAssetThemePackage: unknown;
}

type AssetDelegate = {
  findFirst: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type RouteParams = { params: Promise<{ ownerId: string; path: string[] }> };

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

let GET: (req: NextRequest, ctx: RouteParams) => Promise<Response>;
let prismaAsset: AssetDelegate;
let prismaDocument: AssetDelegate;

before(async () => {
  const route = await import("./route");
  GET = route.GET as typeof GET;

  const { prisma } = (await import("@/lib/prisma")) as unknown as {
    prisma: { asset: AssetDelegate; document: AssetDelegate };
  };
  prismaAsset = prisma.asset;
  prismaDocument = prisma.document;
});

// ---------------------------------------------------------------------------
// Request / params helpers
// ---------------------------------------------------------------------------

function makeRequest(ownerId: string, filename: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/brand-assets/${ownerId}/${filename}`,
  );
}

function makeParams(ownerId: string, pathSegments: string[]): RouteParams {
  return { params: Promise.resolve({ ownerId, path: pathSegments }) };
}

// ---------------------------------------------------------------------------
// Asset fixtures
// ---------------------------------------------------------------------------

const OWNER_ID = "owner-user-1";
const OTHER_USER_ID = "other-user-2";
const STORAGE_KEY = `${OWNER_ID}/abc123.png`;

const ASSET_ROW = {
  id: "asset-1",
  mimeType: "image/png",
  storageKey: STORAGE_KEY,
  documentId: null,
  workspaceId: null,
  brand: null,
};

const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("brand-assets route opts into Node.js runtime", async () => {
  const { runtime } = await import("./route");
  assert.equal(runtime, "nodejs");
});

test("#1853: missing asset returns 404 plain-text (existence must not leak)", async (t) => {
  // Even with an authenticated user, a missing asset is a privacy 404.
  global.__testBrandAssetUser = { id: OWNER_ID, sessionInvalidatedAt: null };
  t.after(() => {
    global.__testBrandAssetUser = null;
  });

  stubPrismaMethod(t, prismaAsset, "findFirst", async () => null);

  const resp = await GET(
    makeRequest(OWNER_ID, "abc123.png"),
    makeParams(OWNER_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
  assert.match(resp.headers.get("content-type") ?? "", /text/);
  assert.equal(await resp.text(), "Not found");
});

test("#2065: unauthenticated caller receives the privacy 404 without asset lookup", async (t) => {
  global.__testBrandAssetUser = null;

  const findFirst = stubPrismaMethod(t, prismaAsset, "findFirst", async () => {
    throw new Error("asset lookup should not run before authentication");
  });

  const resp = await GET(
    makeRequest(OWNER_ID, "abc123.png"),
    makeParams(OWNER_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
  assert.match(resp.headers.get("content-type") ?? "", /text/);
  assert.equal(await resp.text(), "Not found");
  assert.equal(findFirst.calls.length, 0);
});

test("#2065: authenticated non-owner receives the privacy 404 without asset lookup", async (t) => {
  global.__testBrandAssetUser = {
    id: OTHER_USER_ID,
    sessionInvalidatedAt: null,
  };
  t.after(() => {
    global.__testBrandAssetUser = null;
  });

  const findFirst = stubPrismaMethod(t, prismaAsset, "findFirst", async () => {
    throw new Error("asset lookup should not run before owner check");
  });

  const resp = await GET(
    makeRequest(OWNER_ID, "abc123.png"),
    makeParams(OWNER_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
  assert.match(resp.headers.get("content-type") ?? "", /text/);
  assert.equal(await resp.text(), "Not found");
  assert.equal(findFirst.calls.length, 0);
});

test("#1853: authenticated owner receives 200 with asset bytes and cache headers", async (t) => {
  global.__testBrandAssetUser = { id: OWNER_ID, sessionInvalidatedAt: null };
  t.after(() => {
    global.__testBrandAssetUser = null;
    resetBrandStorageAdapter();
  });

  stubPrismaMethod(t, prismaAsset, "findFirst", async () => ASSET_ROW);

  setBrandStorageAdapter({
    store: async () => `/api/brand-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/brand-assets/${key}`,
    read: async (_key: string) => FAKE_PNG,
    delete: async () => {},
  });

  const resp = await GET(
    makeRequest(OWNER_ID, "abc123.png"),
    makeParams(OWNER_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
  assert.match(
    resp.headers.get("content-type") ?? "",
    /image\/png/,
    "Content-Type should be image/png",
  );
  assert.match(
    resp.headers.get("cache-control") ?? "",
    /private.*immutable/,
    "Cache-Control should be private and immutable",
  );
  assert.equal(
    resp.headers.get("accept-ranges"),
    "none",
    "Accept-Ranges header must be present",
  );
  const bytes = await resp.arrayBuffer();
  assert.equal(bytes.byteLength, FAKE_PNG.length);
});

test("#1853: storage adapter failure returns 404 (handler absorbs the error)", async (t) => {
  global.__testBrandAssetUser = { id: OWNER_ID, sessionInvalidatedAt: null };
  t.after(() => {
    global.__testBrandAssetUser = null;
    resetBrandStorageAdapter();
  });

  stubPrismaMethod(t, prismaAsset, "findFirst", async () => ASSET_ROW);

  setBrandStorageAdapter({
    store: async () => `/api/brand-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/brand-assets/${key}`,
    read: async (_key: string) => {
      throw new Error("Storage backend unavailable");
    },
    delete: async () => {},
  });

  const resp = await GET(
    makeRequest(OWNER_ID, "abc123.png"),
    makeParams(OWNER_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
  assert.equal(await resp.text(), "Not found");
});

test("#2148: anonymous shared presentation viewers can fetch active theme package assets", async (t) => {
  global.__testBrandAssetUser = null;
  global.__testBrandAssetThemePackage = {
    schemaVersion: 1,
    id: "brand-package",
    version: "1.0.0",
    name: "Brand package",
    assets: {
      fonts: {
        "font-1": {
          id: "font-1",
          family: "Acme Sans",
          src: `/api/brand-assets/${OWNER_ID}/abc123.png`,
        },
      },
    },
  };
  t.after(() => {
    global.__testBrandAssetUser = null;
    global.__testBrandAssetThemePackage = undefined;
    resetBrandStorageAdapter();
  });

  stubPrismaMethod(t, prismaAsset, "findFirst", async () => ASSET_ROW);
  stubPrismaMethod(t, prismaDocument, "findFirst", async () => ({
    deckJson: {},
    ownerId: OWNER_ID,
    workspaceId: null,
    isShared: true,
    shareId: "share123",
    shareExpiresAt: null,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    sharePasscodeHash: null,
    deletedAt: null,
    workspace: null,
  }));

  setBrandStorageAdapter({
    store: async () => `/api/brand-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/brand-assets/${key}`,
    read: async (_key: string) => FAKE_PNG,
    delete: async () => {},
  });

  const resp = await GET(
    new NextRequest(
      `http://localhost/api/brand-assets/${OWNER_ID}/abc123.png?shareId=share123&shareMode=present`,
    ),
    makeParams(OWNER_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
  assert.match(resp.headers.get("content-type") ?? "", /image\/png/);
});

test("#2177: shared presentations cannot expose another owner's brand asset", async (t) => {
  global.__testBrandAssetUser = null;
  global.__testBrandAssetThemePackage = {
    assets: {
      fonts: {
        "font-1": {
          id: "font-1",
          family: "Acme Sans",
          src: `/api/brand-assets/${OWNER_ID}/abc123.png`,
        },
      },
    },
  };
  t.after(() => {
    global.__testBrandAssetUser = null;
    global.__testBrandAssetThemePackage = undefined;
  });

  stubPrismaMethod(t, prismaAsset, "findFirst", async () => ASSET_ROW);
  stubPrismaMethod(t, prismaDocument, "findFirst", async () => ({
    deckJson: {},
    ownerId: OTHER_USER_ID,
    workspaceId: null,
    isShared: true,
    shareId: "share123",
    shareExpiresAt: null,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    sharePasscodeHash: null,
    deletedAt: null,
    workspace: null,
  }));

  const resp = await GET(
    new NextRequest(
      `http://localhost/api/brand-assets/${OWNER_ID}/abc123.png?shareId=share123&shareMode=present`,
    ),
    makeParams(OWNER_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
  assert.equal(await resp.text(), "Not found");
});

test("#2177: shared presentations cannot expose a brand-owned asset from another owner", async (t) => {
  global.__testBrandAssetUser = null;
  global.__testBrandAssetThemePackage = {
    assets: {
      images: {
        "logo-1": {
          id: "logo-1",
          src: `/api/brand-assets/${OWNER_ID}/abc123.png`,
        },
      },
    },
  };
  t.after(() => {
    global.__testBrandAssetUser = null;
    global.__testBrandAssetThemePackage = undefined;
  });

  stubPrismaMethod(t, prismaAsset, "findFirst", async () => ({
    ...ASSET_ROW,
    brand: { ownerId: OTHER_USER_ID },
  }));
  stubPrismaMethod(t, prismaDocument, "findFirst", async () => ({
    deckJson: {},
    ownerId: OWNER_ID,
    workspaceId: null,
    isShared: true,
    shareId: "share123",
    shareExpiresAt: null,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    sharePasscodeHash: null,
    deletedAt: null,
    workspace: null,
  }));

  const resp = await GET(
    new NextRequest(
      `http://localhost/api/brand-assets/${OWNER_ID}/abc123.png?shareId=share123&shareMode=present`,
    ),
    makeParams(OWNER_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
  assert.equal(await resp.text(), "Not found");
});
