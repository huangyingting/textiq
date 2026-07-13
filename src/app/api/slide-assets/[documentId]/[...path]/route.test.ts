/**
 * Behavioral tests for GET /api/slide-assets/[documentId]/[...path] (#1989).
 *
 * Invokes the actual GET handler with stubbed dependencies so no real DB,
 * Auth.js session, rate-limit store, or filesystem access is required. This
 * closes the direct-coverage gap left by the route's previous test, which
 * only exercised the pure `decideSlideAssetAccess` helper (that helper's own
 * exhaustive access-matrix coverage still lives in `asset-access.test.ts`;
 * it is not duplicated here).
 *
 * Covers:
 *   - Abuse-budget gate: 429 with Retry-After when exceeded, skipped when no
 *     secret is configured, and passed through when allowed.
 *   - `documentId` + catch-all `path` segments are joined into the storage
 *     key exactly as the route reconstructs it.
 *   - `shareMode` query param validation (only "present"/"embed" accepted).
 *   - Missing asset / missing (or soft-deleted) document → privacy 404.
 *   - Authenticated capability access (owner, workspace editor/viewer,
 *     unrelated user denied).
 *   - Anonymous public present/embed access, including the passcode-gated
 *     branch and stale/mismatched share-id proof.
 *   - Success path: 200 with the asset's bytes and content type.
 *   - Storage adapter failure is absorbed into a 404 (never a 500).
 *
 * Module-hook strategy:
 *   - `@/lib/session` is replaced with a CJS-free ESM stub driven by
 *     `globalThis.__slideAssetRouteTestState`, mirroring
 *     `collab/authorize/route.test.ts`.
 *   - `@/lib/abuse-budget` is stubbed the same way so the IP rate-limit
 *     store never needs a live DB/Redis backend.
 *   - `@/lib/share-passcode-server` is stubbed because it imports
 *     `server-only` (unusable outside a Next.js server-component context)
 *     and calls `cookies()` from `next/headers`; its own unlock-token
 *     contract is covered by `share-passcode-server.test.ts`.
 *   - `@/lib/prisma` is imported directly and `prisma.asset.findFirst` is
 *     patched via `Object.defineProperty` (same pattern as
 *     `brand-assets/[ownerId]/[...path]/route.test.ts`).
 *   - `setDefaultStorageAdapter` / `resetDefaultStorageAdapter` inject a
 *     minimal in-memory adapter for the happy-path and failure-path tests.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";

import { NextRequest } from "next/server";

import {
  setDefaultStorageAdapter,
  resetDefaultStorageAdapter,
} from "@/lib/slides/asset-storage";

// ---------------------------------------------------------------------------
// Module hooks — must be registered before any handler import
// ---------------------------------------------------------------------------

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

type RouteTestState = {
  currentUser: { id: string; sessionInvalidatedAt: Date | null } | null;
  budgetSecret: string | undefined;
  budgetResult: { allowed: boolean; retryAfterSeconds?: number };
  passcodeUnlocked: boolean;
};

const globalForRoute = globalThis as typeof globalThis & {
  __slideAssetRouteTestState: RouteTestState;
};

function createDefaultState(): RouteTestState {
  return {
    currentUser: null,
    budgetSecret: undefined,
    budgetResult: { allowed: true },
    passcodeUnlocked: true,
  };
}

globalForRoute.__slideAssetRouteTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-slide-asset-route-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/session",
    `
      export async function getCurrentUser() {
        return globalThis.__slideAssetRouteTestState.currentUser;
      }
    `,
  ],
  [
    "@/lib/abuse-budget",
    `
      export function requireAbuseBudgetSecret() {
        return globalThis.__slideAssetRouteTestState.budgetSecret;
      }
      export async function checkAbuseBudget() {
        return globalThis.__slideAssetRouteTestState.budgetResult;
      }
      export function getClientSubject() {
        return "test-subject";
      }
    `,
  ],
  [
    "@/lib/share-passcode-server",
    `
      export async function isPublicSharePasscodeUnlocked() {
        return globalThis.__slideAssetRouteTestState.passcodeUnlocked;
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
        format: "module" as const,
        source: stubbedModules.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

// ---------------------------------------------------------------------------
// Prisma patch helper
// ---------------------------------------------------------------------------

type AssetDelegate = {
  findFirst: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type RouteParams = { params: Promise<{ documentId: string; path: string[] }> };

type TestContext = { after(fn: () => void): void };

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

let GET: (req: NextRequest, ctx: RouteParams) => Promise<Response>;
let prismaAsset: AssetDelegate;

before(async () => {
  const route = await import("./route");
  GET = route.GET as typeof GET;

  const { prisma } = (await import("@/lib/prisma")) as unknown as {
    prisma: { asset: AssetDelegate };
  };
  prismaAsset = prisma.asset;
});

beforeEach(() => {
  globalForRoute.__slideAssetRouteTestState = createDefaultState();
});

// ---------------------------------------------------------------------------
// Request / params / fixture helpers
// ---------------------------------------------------------------------------

const DOCUMENT_ID = "doc-1";
const OWNER_ID = "owner-1";
const STORAGE_KEY = `${DOCUMENT_ID}/abc123.png`;

const ASSET_ROW = {
  id: "asset-1",
  mimeType: "image/png",
  storageKey: STORAGE_KEY,
};

const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Builds a document row, defaulting to a private, owned, live document. */
function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: OWNER_ID,
    workspaceId: null,
    workspace: null,
    shareId: null,
    isShared: false,
    deletedAt: null,
    shareExpiresAt: null,
    shareEmbedEnabled: false,
    sharePresentEnabled: false,
    sharePasscodeHash: null,
    ...overrides,
  };
}

/** A document publicly shared via a present/embed link (no dash in the id,
 * so `shareIdFromParam` — which extracts a suffix after the last "-" — falls
 * back to the raw query value unchanged). */
function sharedDoc(overrides: Record<string, unknown> = {}) {
  return makeDoc({
    shareId: "shareabc",
    isShared: true,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    workspaceId: "ws-1",
    workspace: { ownerId: OWNER_ID, members: [] },
    ...overrides,
  });
}

function makeRequest(
  documentId: string,
  filename: string,
  query: Record<string, string> = {},
): NextRequest {
  const url = new URL(
    `http://localhost/api/slide-assets/${documentId}/${filename}`,
  );
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

function makeParams(documentId: string, pathSegments: string[]): RouteParams {
  return { params: Promise.resolve({ documentId, path: pathSegments }) };
}

function findFirstReturning(document: unknown) {
  return async () => ({ ...ASSET_ROW, document });
}

// ---------------------------------------------------------------------------
// Abuse-budget gate
// ---------------------------------------------------------------------------

test("#1989: rate-limit budget exceeded returns 429 with Retry-After (before any DB lookup)", async (t) => {
  globalForRoute.__slideAssetRouteTestState.budgetSecret = "test-secret";
  globalForRoute.__slideAssetRouteTestState.budgetResult = {
    allowed: false,
    retryAfterSeconds: 15,
  };
  stubPrismaMethod(t, prismaAsset, "findFirst", () => {
    throw new Error("findFirst must not be called when the budget denies");
  });

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 429);
  assert.equal(resp.headers.get("Retry-After"), "15");
  const body = await resp.json();
  assert.equal(body.code, "RATE_LIMITED");
});

test("#1989: no abuse-budget secret skips the rate-limit check entirely", async (t) => {
  globalForRoute.__slideAssetRouteTestState.budgetSecret = undefined;
  // Even though the stubbed budget would deny, an unset secret must bypass
  // the check (mirrors non-`AUTH_SECRET`-configured deployments).
  globalForRoute.__slideAssetRouteTestState.budgetResult = {
    allowed: false,
    retryAfterSeconds: 60,
  };
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: OWNER_ID,
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(t, prismaAsset, "findFirst", findFirstReturning(makeDoc()));

  setDefaultStorageAdapter({
    store: async () => `/api/slide-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/slide-assets/${key}`,
    read: async () => FAKE_PNG,
    delete: async () => {},
  });
  t.after(() => resetDefaultStorageAdapter());

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
});

test("#1989: allowed budget falls through to the access decision", async (t) => {
  globalForRoute.__slideAssetRouteTestState.budgetSecret = "test-secret";
  globalForRoute.__slideAssetRouteTestState.budgetResult = { allowed: true };
  stubPrismaMethod(t, prismaAsset, "findFirst", async () => null);

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
});

// ---------------------------------------------------------------------------
// Storage-key reconstruction from documentId + catch-all path segments
// ---------------------------------------------------------------------------

test("#1989: multi-segment path is joined into the storage key with '/'", async (t) => {
  const nestedKey = `${DOCUMENT_ID}/thumbs/abc123.png`;
  let queriedWhere: unknown;
  stubPrismaMethod(t, prismaAsset, "findFirst", async (args: unknown) => {
    queriedWhere = (args as { where: unknown }).where;
    return null;
  });

  await GET(
    makeRequest(DOCUMENT_ID, "thumbs/abc123.png"),
    makeParams(DOCUMENT_ID, ["thumbs", "abc123.png"]),
  );

  assert.deepEqual(queriedWhere, {
    storageKey: nestedKey,
    documentId: DOCUMENT_ID,
    deletedAt: null,
  });
});

// ---------------------------------------------------------------------------
// Missing asset / document (privacy 404 — never leaks existence)
// ---------------------------------------------------------------------------

test("#1989: missing asset returns a privacy 404 plain-text body", async (t) => {
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: OWNER_ID,
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(t, prismaAsset, "findFirst", async () => null);

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
  assert.match(resp.headers.get("content-type") ?? "", /text/);
  assert.equal(await resp.text(), "Not found");
});

test("#1989: asset present but document relation cleared (SetNull on delete) is a privacy 404", async (t) => {
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: OWNER_ID,
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(t, prismaAsset, "findFirst", findFirstReturning(null));

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
  assert.equal(await resp.text(), "Not found");
});

test("#1989: soft-deleted document is a privacy 404 even for its owner", async (t) => {
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: OWNER_ID,
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(
      makeDoc({ deletedAt: new Date("2026-06-23T00:00:00Z") }),
    ),
  );

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
});

// ---------------------------------------------------------------------------
// Authenticated capability access
// ---------------------------------------------------------------------------

test("#1989: owner is served their own private asset (200)", async (t) => {
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: OWNER_ID,
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(t, prismaAsset, "findFirst", findFirstReturning(makeDoc()));
  setDefaultStorageAdapter({
    store: async () => `/api/slide-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/slide-assets/${key}`,
    read: async () => FAKE_PNG,
    delete: async () => {},
  });
  t.after(() => resetDefaultStorageAdapter());

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
  assert.match(resp.headers.get("content-type") ?? "", /image\/png/);
  const bytes = await resp.arrayBuffer();
  assert.equal(bytes.byteLength, FAKE_PNG.length);
});

test("#1989: workspace editor is served the asset", async (t) => {
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: "editor-1",
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(
      makeDoc({
        workspaceId: "ws-1",
        workspace: {
          ownerId: "ws-owner",
          members: [{ userId: "editor-1", role: "EDITOR" }],
        },
      }),
    ),
  );
  setDefaultStorageAdapter({
    store: async () => `/api/slide-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/slide-assets/${key}`,
    read: async () => FAKE_PNG,
    delete: async () => {},
  });
  t.after(() => resetDefaultStorageAdapter());

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
});

test("#1989: workspace viewer is served the asset (read access is enough)", async (t) => {
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: "viewer-1",
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(
      makeDoc({
        workspaceId: "ws-1",
        workspace: {
          ownerId: "ws-owner",
          members: [{ userId: "viewer-1", role: "VIEWER" }],
        },
      }),
    ),
  );
  setDefaultStorageAdapter({
    store: async () => `/api/slide-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/slide-assets/${key}`,
    read: async () => FAKE_PNG,
    delete: async () => {},
  });
  t.after(() => resetDefaultStorageAdapter());

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
});

test("#1989: unrelated authenticated user is forbidden (private asset not served)", async (t) => {
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: "stranger-1",
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(
      makeDoc({
        workspaceId: "ws-1",
        workspace: { ownerId: "ws-owner", members: [] },
      }),
    ),
  );

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 403);
  assert.equal(await resp.text(), "Forbidden");
});

// ---------------------------------------------------------------------------
// Anonymous public share access
// ---------------------------------------------------------------------------

test("#1989: anonymous request is served when present link is enabled and shareMode=present", async (t) => {
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(sharedDoc()),
  );
  setDefaultStorageAdapter({
    store: async () => `/api/slide-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/slide-assets/${key}`,
    read: async () => FAKE_PNG,
    delete: async () => {},
  });
  t.after(() => resetDefaultStorageAdapter());

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png", {
      shareId: "shareabc",
      shareMode: "present",
    }),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
});

test("#1989: anonymous request is served via embed link when shareMode=embed", async (t) => {
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(sharedDoc({ sharePresentEnabled: false })),
  );
  setDefaultStorageAdapter({
    store: async () => `/api/slide-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/slide-assets/${key}`,
    read: async () => FAKE_PNG,
    delete: async () => {},
  });
  t.after(() => resetDefaultStorageAdapter());

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png", {
      shareId: "shareabc",
      shareMode: "embed",
    }),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
});

test("#1989: an unrecognized shareMode value is treated as no proof (403)", async (t) => {
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(sharedDoc()),
  );

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png", {
      shareId: "shareabc",
      shareMode: "download", // not "present" or "embed"
    }),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 403);
});

test("#1989: anonymous request without shareId/shareMode proof is forbidden even for a shared document", async (t) => {
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(sharedDoc()),
  );

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 403);
  assert.equal(await resp.text(), "Forbidden");
});

test("#1989: mismatched shareId proof against a shared document is forbidden", async (t) => {
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(sharedDoc()),
  );

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png", {
      shareId: "wrong-id",
      shareMode: "present",
    }),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 403);
});

test("#1989: passcode-protected share requires an unlocked passcode", async (t) => {
  globalForRoute.__slideAssetRouteTestState.passcodeUnlocked = false;
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(sharedDoc({ sharePasscodeHash: "hashed-value" })),
  );

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png", {
      shareId: "shareabc",
      shareMode: "present",
    }),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 403);
});

test("#1989: passcode-protected share is served once unlocked", async (t) => {
  globalForRoute.__slideAssetRouteTestState.passcodeUnlocked = true;
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(sharedDoc({ sharePasscodeHash: "hashed-value" })),
  );
  setDefaultStorageAdapter({
    store: async () => `/api/slide-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/slide-assets/${key}`,
    read: async () => FAKE_PNG,
    delete: async () => {},
  });
  t.after(() => resetDefaultStorageAdapter());

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png", {
      shareId: "shareabc",
      shareMode: "present",
    }),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
});

test("#1989: owner access does not require share-bound public asset proof", async (t) => {
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: OWNER_ID,
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(
    t,
    prismaAsset,
    "findFirst",
    findFirstReturning(sharedDoc()),
  );
  setDefaultStorageAdapter({
    store: async () => `/api/slide-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/slide-assets/${key}`,
    read: async () => FAKE_PNG,
    delete: async () => {},
  });
  t.after(() => resetDefaultStorageAdapter());

  // No shareId/shareMode query proof supplied at all — owner capability alone
  // must be sufficient.
  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 200);
});

// ---------------------------------------------------------------------------
// Storage failure (absorbed, never a 500)
// ---------------------------------------------------------------------------

test("#1989: storage adapter failure returns 404 (handler absorbs the error)", async (t) => {
  globalForRoute.__slideAssetRouteTestState.currentUser = {
    id: OWNER_ID,
    sessionInvalidatedAt: null,
  };
  stubPrismaMethod(t, prismaAsset, "findFirst", findFirstReturning(makeDoc()));
  setDefaultStorageAdapter({
    store: async () => `/api/slide-assets/${STORAGE_KEY}`,
    urlFor: (key: string) => `/api/slide-assets/${key}`,
    read: async () => {
      throw new Error("Storage backend unavailable");
    },
    delete: async () => {},
  });
  t.after(() => resetDefaultStorageAdapter());

  const resp = await GET(
    makeRequest(DOCUMENT_ID, "abc123.png"),
    makeParams(DOCUMENT_ID, ["abc123.png"]),
  );

  assert.equal(resp.status, 404);
  const body = await resp.json();
  assert.equal(body.code, "NOT_FOUND");
});
