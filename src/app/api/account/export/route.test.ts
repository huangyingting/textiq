/**
 * Behavioral tests for GET /api/account/export (issue #1852).
 *
 * Coverage goals:
 *   - Unauthenticated caller        → 401 UNAUTHORIZED
 *   - Rate-limit budget exceeded    → 429 RATE_LIMITED with Retry-After
 *   - loadAccountExport returns null → 401 (user vanished mid-request)
 *   - loadAccountExport throws       → 500 SERVER_ERROR with safe body
 *   - Successful export              → 200 attachment with correct headers
 *   - Budget check skipped when no secret → export proceeds
 *
 * Module-hook approach (mirrors server-actions.test.ts / service.test.ts):
 *   `@/lib/session`               — stubbed: getCurrentUser uses next/auth context
 *   `@/lib/account/export-loader` — stubbed: imports `server-only`, needs live DB
 *   `@/lib/abuse-budget`          — stubbed: controls requireAbuseBudgetSecret +
 *                                    checkAbuseBudget without real rate-limit store
 *   `@/lib/log`                   — stubbed: suppress stderr noise in tests
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

type ExportTestState = {
  currentUser: { id: string; email?: string } | null;
  budgetSecret: string | undefined;
  budgetResult: { allowed: boolean; retryAfterSeconds?: number };
  exportPayload: unknown;
  exportError: Error | null;
};

const globalForExport = globalThis as typeof globalThis & {
  __accountExportTestState: ExportTestState;
};

function createDefaultState(): ExportTestState {
  return {
    currentUser: null,
    budgetSecret: undefined,
    budgetResult: { allowed: true },
    exportPayload: null,
    exportError: null,
  };
}

globalForExport.__accountExportTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-account-export-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/session",
    `
      export async function getCurrentUser() {
        return globalThis.__accountExportTestState.currentUser;
      }
    `,
  ],
  [
    "@/lib/account/export-loader",
    `
      export async function loadAccountExport(userId) {
        const state = globalThis.__accountExportTestState;
        if (state.exportError) throw state.exportError;
        return state.exportPayload;
      }
    `,
  ],
  [
    "@/lib/abuse-budget",
    `
      export function requireAbuseBudgetSecret() {
        return globalThis.__accountExportTestState.budgetSecret;
      }
      export async function checkAbuseBudget() {
        return globalThis.__accountExportTestState.budgetResult;
      }
    `,
  ],
  [
    "@/lib/log",
    `
      export function logError() {}
      export function logInfo() {}
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
  globalForExport.__accountExportTestState = createDefaultState();
});

const TEST_USER = { id: "user-test-001", email: "test@example.com" };

const MINIMAL_EXPORT_PAYLOAD = {
  version: 3,
  exportedAt: "2026-01-01T00:00:00.000Z",
  user: {
    id: TEST_USER.id,
    email: TEST_USER.email,
    name: null,
    plan: "free",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  documents: [],
  workspacesOwned: [],
  workspaceMemberships: [],
  comments: [],
  commentReads: [],
  tags: [],
  brands: [],
  assets: [],
  subscription: null,
  inviteLinkUses: [],
  usageLedger: [],
};

// ---------------------------------------------------------------------------
// Runtime flag
// ---------------------------------------------------------------------------

test("#1852: account export route opts into the Node runtime", () => {
  assert.strictEqual(runtime, "nodejs");
});

// ---------------------------------------------------------------------------
// Unauthenticated caller
// ---------------------------------------------------------------------------

test("#1852: unauthenticated request is rejected with 401", async () => {
  globalForExport.__accountExportTestState.currentUser = null;
  const response = await GET();
  assert.strictEqual(response.status, 401);
  const body = await response.json();
  assert.strictEqual(body.code, "UNAUTHORIZED");
  assert.ok(typeof body.error === "string" && body.error.length > 0);
});

// ---------------------------------------------------------------------------
// Rate-limit budget exceeded
// ---------------------------------------------------------------------------

test("#1852: rate-limit budget exceeded returns 429 with Retry-After", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.budgetSecret = "test-abuse-secret";
  globalForExport.__accountExportTestState.budgetResult = {
    allowed: false,
    retryAfterSeconds: 30,
  };

  const response = await GET();
  assert.strictEqual(response.status, 429);
  assert.strictEqual(response.headers.get("Retry-After"), "30");
  const body = await response.json();
  assert.strictEqual(body.code, "RATE_LIMITED");
});

test("#1852: rate-limit budget allowed proceeds to export", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.budgetSecret = "test-abuse-secret";
  globalForExport.__accountExportTestState.budgetResult = { allowed: true };
  globalForExport.__accountExportTestState.exportPayload =
    MINIMAL_EXPORT_PAYLOAD;

  const response = await GET();
  assert.strictEqual(response.status, 200);
});

// ---------------------------------------------------------------------------
// Budget check skipped when no secret configured
// ---------------------------------------------------------------------------

test("#1852: no abuse-budget secret skips rate-limit check and allows export", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.budgetSecret = undefined;
  globalForExport.__accountExportTestState.exportPayload =
    MINIMAL_EXPORT_PAYLOAD;

  const response = await GET();
  assert.strictEqual(response.status, 200);
});

// ---------------------------------------------------------------------------
// loadAccountExport returns null (user not in DB)
// ---------------------------------------------------------------------------

test("#1852: loadAccountExport returning null returns 401 (user vanished)", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.exportPayload = null;

  const response = await GET();
  assert.strictEqual(response.status, 401);
  const body = await response.json();
  assert.strictEqual(body.code, "UNAUTHORIZED");
});

// ---------------------------------------------------------------------------
// loadAccountExport throws (DB or downstream error)
// ---------------------------------------------------------------------------

test("#1852: loadAccountExport throwing maps to 500 with safe error body", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.exportError = new Error(
    "Simulated database connection failure",
  );

  const response = await GET();
  assert.strictEqual(response.status, 500);
  const body = await response.json();
  assert.ok(
    typeof body.error === "string" && body.error.length > 0,
    "500 response must include a user-safe error message",
  );
  assert.ok(
    !body.error.includes("database connection failure"),
    "500 response must not leak internal error details",
  );
});

// ---------------------------------------------------------------------------
// Successful export — shape and ownership
// ---------------------------------------------------------------------------

test("#1852: successful export returns 200 with JSON content-type", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.exportPayload =
    MINIMAL_EXPORT_PAYLOAD;

  const response = await GET();
  assert.strictEqual(response.status, 200);
  const contentType = response.headers.get("Content-Type") ?? "";
  assert.ok(
    contentType.includes("application/json"),
    `expected JSON content-type, got: ${contentType}`,
  );
});

test("#1852: successful export sets Content-Disposition attachment with dated filename", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.exportPayload =
    MINIMAL_EXPORT_PAYLOAD;

  const response = await GET();
  assert.strictEqual(response.status, 200);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  assert.ok(
    disposition.startsWith("attachment;"),
    `expected attachment disposition, got: ${disposition}`,
  );
  assert.ok(
    /textiq-data-export-\d{4}-\d{2}-\d{2}\.json/.test(disposition),
    `expected dated filename in disposition: ${disposition}`,
  );
});

test("#1852: successful export sets Cache-Control: no-store", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.exportPayload =
    MINIMAL_EXPORT_PAYLOAD;

  const response = await GET();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.headers.get("Cache-Control"), "no-store");
});

test("#1852: export body contains the payload from loadAccountExport", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.exportPayload =
    MINIMAL_EXPORT_PAYLOAD;

  const response = await GET();
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, MINIMAL_EXPORT_PAYLOAD);
});

test("#1852: export with empty optional data still returns 200", async () => {
  globalForExport.__accountExportTestState.currentUser = TEST_USER;
  globalForExport.__accountExportTestState.exportPayload = {
    ...MINIMAL_EXPORT_PAYLOAD,
    documents: [],
    workspacesOwned: [],
    comments: [],
    tags: [],
    brands: [],
    assets: [],
    subscription: null,
  };

  const response = await GET();
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.documents, []);
  assert.strictEqual(body.subscription, null);
});
