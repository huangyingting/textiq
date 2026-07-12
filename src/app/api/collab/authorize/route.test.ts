/**
 * Behavioral tests for GET /api/collab/authorize (issue #1875).
 *
 * The collaboration WebSocket upgrade handler (`scripts/collab-core.mjs`)
 * cannot import the TypeScript Auth.js / Prisma stack, so it forwards the
 * upgrade request's cookies to this route to authenticate + authorize the
 * room join. These tests exercise the route handler directly rather than the
 * pure decision helpers already covered by `room-access.test.ts`, so the
 * status-code wiring, ordering (auth → abuse budget → room param → access
 * decision), and JSON response shape stay covered end to end.
 *
 * Coverage goals:
 *   - Unauthenticated caller                → 401 UNAUTHORIZED
 *   - Rate-limit budget exceeded            → 429 RATE_LIMITED with Retry-After
 *   - Budget check skipped when no secret   → falls through to access decision
 *   - Missing `room` query param            → 403 FORBIDDEN ("Missing room.")
 *   - No view access / deleted / nonexistent document → 403 FORBIDDEN
 *   - Viewer role                           → 200 { role: "viewer", readOnly: true }
 *   - Editor role                           → 200 { role: "editor", readOnly: false }
 *   - Owner role                            → 200 { role: "owner", readOnly: false }
 *
 * Module-hook approach (mirrors account/export/route.test.ts):
 *   `@/lib/session`                    — stubbed: getCurrentUser normally reads
 *                                         next-auth's request-scoped session.
 *   `@/lib/abuse-budget`               — stubbed: controls requireAbuseBudgetSecret
 *                                         + checkAbuseBudget without a live
 *                                         rate-limit store.
 *   `@/lib/auth/document-permissions`  — stubbed: getDocumentCapabilities
 *                                         normally requires a live Prisma
 *                                         document/workspace query; the route's
 *                                         own role → response mapping is what
 *                                         these tests target, and that mapping
 *                                         (`decideRoomAccess` /
 *                                         `roomAccessDecisionToAccessDecision` /
 *                                         `accessDecisionToApiResponse`) runs
 *                                         for real.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";

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

type DocumentCapabilitiesStub = {
  role: "owner" | "editor" | "viewer" | "none";
  canView: boolean;
  canEdit: boolean;
  canManage: boolean;
};

type AuthorizeTestState = {
  currentUser: { id: string } | null;
  budgetSecret: string | undefined;
  budgetResult: { allowed: boolean; retryAfterSeconds?: number };
  capabilities: DocumentCapabilitiesStub;
};

const globalForAuthorize = globalThis as typeof globalThis & {
  __collabAuthorizeTestState: AuthorizeTestState;
};

function createDefaultState(): AuthorizeTestState {
  return {
    currentUser: null,
    budgetSecret: undefined,
    budgetResult: { allowed: true },
    capabilities: {
      role: "none",
      canView: false,
      canEdit: false,
      canManage: false,
    },
  };
}

globalForAuthorize.__collabAuthorizeTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-collab-authorize-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/session",
    `
      export async function getCurrentUser() {
        return globalThis.__collabAuthorizeTestState.currentUser;
      }
    `,
  ],
  [
    "@/lib/abuse-budget",
    `
      export function requireAbuseBudgetSecret() {
        return globalThis.__collabAuthorizeTestState.budgetSecret;
      }
      export async function checkAbuseBudget() {
        return globalThis.__collabAuthorizeTestState.budgetResult;
      }
    `,
  ],
  [
    "@/lib/auth/document-permissions",
    `
      export async function getDocumentCapabilities() {
        return globalThis.__collabAuthorizeTestState.capabilities;
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
let GET: RouteModule["GET"];
let runtime: RouteModule["runtime"];

before(async () => {
  const mod = await import("./route");
  GET = mod.GET;
  runtime = mod.runtime;
});

beforeEach(() => {
  globalForAuthorize.__collabAuthorizeTestState = createDefaultState();
});

const TEST_USER = { id: "user-test-001" };
const ROOM_URL = "http://localhost/api/collab/authorize?room=doc-123";

function makeRequest(url: string = ROOM_URL): Request {
  return new Request(url);
}

// ---------------------------------------------------------------------------
// Runtime flag
// ---------------------------------------------------------------------------

test("#1875: collab authorize route opts into the Node runtime", () => {
  assert.strictEqual(runtime, "nodejs");
});

// ---------------------------------------------------------------------------
// Unauthenticated caller
// ---------------------------------------------------------------------------

test("#1875: unauthenticated request is rejected with 401", async () => {
  globalForAuthorize.__collabAuthorizeTestState.currentUser = null;
  const response = await GET(makeRequest());
  assert.strictEqual(response.status, 401);
  const body = await response.json();
  assert.strictEqual(body.code, "UNAUTHORIZED");
});

test("#1875: a session user without an id is treated as unauthenticated", async () => {
  globalForAuthorize.__collabAuthorizeTestState.currentUser = {
    id: "",
  } as unknown as { id: string };
  const response = await GET(makeRequest());
  assert.strictEqual(response.status, 401);
});

// ---------------------------------------------------------------------------
// Rate-limit budget exceeded
// ---------------------------------------------------------------------------

test("#1875: rate-limit budget exceeded returns 429 with Retry-After", async () => {
  globalForAuthorize.__collabAuthorizeTestState.currentUser = TEST_USER;
  globalForAuthorize.__collabAuthorizeTestState.budgetSecret = "test-secret";
  globalForAuthorize.__collabAuthorizeTestState.budgetResult = {
    allowed: false,
    retryAfterSeconds: 15,
  };

  const response = await GET(makeRequest());
  assert.strictEqual(response.status, 429);
  assert.strictEqual(response.headers.get("Retry-After"), "15");
  const body = await response.json();
  assert.strictEqual(body.code, "RATE_LIMITED");
});

test("#1875: no abuse-budget secret skips the rate-limit check", async () => {
  globalForAuthorize.__collabAuthorizeTestState.currentUser = TEST_USER;
  globalForAuthorize.__collabAuthorizeTestState.budgetSecret = undefined;
  // Even though the stubbed budget would deny, an unset secret must bypass
  // the check entirely (mirrors `requireAbuseBudgetSecret` returning
  // undefined in non-`AUTH_SECRET`-configured deployments).
  globalForAuthorize.__collabAuthorizeTestState.budgetResult = {
    allowed: false,
    retryAfterSeconds: 60,
  };
  globalForAuthorize.__collabAuthorizeTestState.capabilities = {
    role: "owner",
    canView: true,
    canEdit: true,
    canManage: true,
  };

  const response = await GET(makeRequest());
  assert.strictEqual(response.status, 200);
});

// ---------------------------------------------------------------------------
// Missing room query param
// ---------------------------------------------------------------------------

test("#1875: missing room query param returns 403 Missing room.", async () => {
  globalForAuthorize.__collabAuthorizeTestState.currentUser = TEST_USER;
  const response = await GET(
    makeRequest("http://localhost/api/collab/authorize"),
  );
  assert.strictEqual(response.status, 403);
  const body = await response.json();
  assert.strictEqual(body.code, "FORBIDDEN");
  assert.strictEqual(body.error, "Missing room.");
});

// ---------------------------------------------------------------------------
// No view access — unrelated user, or deleted/nonexistent document
// ---------------------------------------------------------------------------

test("#1875: no view access returns 403 without leaking document existence", async () => {
  globalForAuthorize.__collabAuthorizeTestState.currentUser = TEST_USER;
  globalForAuthorize.__collabAuthorizeTestState.capabilities = {
    role: "none",
    canView: false,
    canEdit: false,
    canManage: false,
  };

  const response = await GET(makeRequest());
  assert.strictEqual(response.status, 403);
  const body = await response.json();
  assert.strictEqual(body.code, "FORBIDDEN");
});

// ---------------------------------------------------------------------------
// Access-role mapping — successful room joins
// ---------------------------------------------------------------------------

test("#1875: viewer role returns 200 with role=viewer and readOnly=true", async () => {
  globalForAuthorize.__collabAuthorizeTestState.currentUser = TEST_USER;
  globalForAuthorize.__collabAuthorizeTestState.capabilities = {
    role: "viewer",
    canView: true,
    canEdit: false,
    canManage: false,
  };

  const response = await GET(makeRequest());
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, role: "viewer", readOnly: true });
});

test("#1875: editor role returns 200 with role=editor and readOnly=false", async () => {
  globalForAuthorize.__collabAuthorizeTestState.currentUser = TEST_USER;
  globalForAuthorize.__collabAuthorizeTestState.capabilities = {
    role: "editor",
    canView: true,
    canEdit: true,
    canManage: false,
  };

  const response = await GET(makeRequest());
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, role: "editor", readOnly: false });
});

test("#1875: owner role returns 200 with role=owner and readOnly=false", async () => {
  globalForAuthorize.__collabAuthorizeTestState.currentUser = TEST_USER;
  globalForAuthorize.__collabAuthorizeTestState.capabilities = {
    role: "owner",
    canView: true,
    canEdit: true,
    canManage: true,
  };

  const response = await GET(makeRequest());
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, role: "owner", readOnly: false });
});
