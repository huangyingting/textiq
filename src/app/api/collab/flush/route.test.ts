/**
 * Behavioral tests for POST /api/collab/flush (issue #1875, #497).
 *
 * The collaboration server (`scripts/collab-core.mjs`) cannot import the
 * TypeScript Prisma stack, so it POSTs a dirty room's Yjs update here via
 * `scripts/collab-flush.mjs` when the room is evicted. These tests exercise
 * the route handler directly to cover the internal-secret gate, body
 * validation, rate limiting, and — most importantly — that persistence is
 * strictly a best-effort recovery *snapshot* on an existing `Document` row:
 * the route must never create a document and must never touch `contentJson`.
 *
 * Coverage goals:
 *   - No `COLLAB_INTERNAL_SECRET` configured        → 503 FEATURE_DISABLED
 *   - Missing `x-collab-internal-secret` header     → 401 UNAUTHORIZED
 *   - Wrong secret (including length mismatch)      → 401 UNAUTHORIZED
 *   - Oversized body (Content-Length preflight)     → 413 VALIDATION_ERROR
 *   - Malformed JSON body                           → 400 VALIDATION_ERROR
 *   - Payload failing parser validation             → 400 VALIDATION_ERROR
 *   - Rate-limit budget exceeded                    → 429 RATE_LIMITED with Retry-After
 *   - Document does not exist                       → 404 NOT_FOUND (never creates rows)
 *   - Prisma update failure                         → 500 SERVER_ERROR, safe body
 *   - Successful flush                              → 200 { ok: true }, snapshot-only write
 *
 * Module-hook approach (mirrors account/export/route.test.ts):
 *   `@/lib/abuse-budget` — stubbed: controls checkAbuseBudget without a live
 *                           rate-limit store.
 *   `@/lib/log`           — stubbed: suppress stderr/stdout noise in tests.
 *   `@/lib/prisma`        — imported directly and patched per-test (matches
 *                           the pattern in share-passcode/unlock/route.test.ts),
 *                           so the update payload passed to Prisma can be
 *                           asserted directly.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";

import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

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

type FlushTestState = {
  budgetResult: { allowed: boolean; retryAfterSeconds?: number };
};

const globalForFlush = globalThis as typeof globalThis & {
  __collabFlushTestState: FlushTestState;
};

function createDefaultState(): FlushTestState {
  return { budgetResult: { allowed: true } };
}

globalForFlush.__collabFlushTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-collab-flush-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/abuse-budget",
    `
      export async function checkAbuseBudget() {
        return globalThis.__collabFlushTestState.budgetResult;
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
let POST: RouteModule["POST"];
let runtime: RouteModule["runtime"];

before(async () => {
  const mod = await import("./route");
  POST = mod.POST;
  runtime = mod.runtime;
});

const SECRET = "test-collab-internal-secret";
const DOCUMENT_ID = "doc-flush-001";
const VALID_UPDATE = Buffer.from("yjs-update-bytes").toString("base64");

let savedSecretEnv: string | undefined;

beforeEach(() => {
  globalForFlush.__collabFlushTestState = createDefaultState();
  savedSecretEnv = process.env.COLLAB_INTERNAL_SECRET;
  process.env.COLLAB_INTERNAL_SECRET = SECRET;
});

function mutablePrisma(): Record<string, unknown> {
  return prisma as unknown as Record<string, unknown>;
}

function replacePrismaDocument(
  t: { after(callback: () => void): void },
  impl: {
    findUnique?: (args: unknown) => Promise<unknown>;
    update?: (args: unknown) => Promise<unknown>;
  },
) {
  const target = mutablePrisma();
  const original = target["document"];
  target["document"] = {
    ...(original as object),
    async findUnique(args: unknown) {
      return (impl.findUnique ?? (async () => null))(args);
    },
    async update(args: unknown) {
      return (impl.update ?? (async () => ({})))(args);
    },
  };
  t.after(() => {
    target["document"] = original;
    if (savedSecretEnv === undefined) {
      delete process.env.COLLAB_INTERNAL_SECRET;
    } else {
      process.env.COLLAB_INTERNAL_SECRET = savedSecretEnv;
    }
  });
}

function makeRequest(
  options: {
    secret?: string | null;
    body?: unknown;
    rawBody?: string;
    contentLength?: string;
    noBody?: boolean;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.secret !== null) {
    headers["x-collab-internal-secret"] = options.secret ?? SECRET;
  }
  if (options.contentLength !== undefined) {
    headers["content-length"] = options.contentLength;
  }
  const requestInit = options.noBody
    ? { method: "POST", headers }
    : {
        method: "POST",
        headers,
        body:
          options.rawBody ??
          JSON.stringify(
            options.body ?? {
              documentId: DOCUMENT_ID,
              update: VALID_UPDATE,
            },
          ),
      };
  return new NextRequest("http://localhost/api/collab/flush", requestInit);
}

// ---------------------------------------------------------------------------
// Runtime flag
// ---------------------------------------------------------------------------

test("#1875: collab flush route opts into the Node runtime", () => {
  assert.strictEqual(runtime, "nodejs");
});

// ---------------------------------------------------------------------------
// Feature disabled — no server secret configured
// ---------------------------------------------------------------------------

test("#1875: missing COLLAB_INTERNAL_SECRET returns 503 (feature disabled)", async (t) => {
  delete process.env.COLLAB_INTERNAL_SECRET;
  t.after(() => {
    process.env.COLLAB_INTERNAL_SECRET = SECRET;
  });
  replacePrismaDocument(t, {});

  const response = await POST(makeRequest());
  assert.strictEqual(response.status, 503);
  const body = await response.json();
  assert.strictEqual(body.code, "FEATURE_DISABLED");
});

test("#1875: blank COLLAB_INTERNAL_SECRET (whitespace-only) returns 503", async (t) => {
  process.env.COLLAB_INTERNAL_SECRET = "   ";
  replacePrismaDocument(t, {});

  const response = await POST(makeRequest());
  assert.strictEqual(response.status, 503);
});

// ---------------------------------------------------------------------------
// Internal-secret handling — missing / mismatched header
// ---------------------------------------------------------------------------

test("#1875: missing x-collab-internal-secret header returns 401", async (t) => {
  replacePrismaDocument(t, {});
  const response = await POST(makeRequest({ secret: null }));
  assert.strictEqual(response.status, 401);
  const body = await response.json();
  assert.strictEqual(body.code, "UNAUTHORIZED");
});

test("#1875: wrong secret of the same length returns 401", async (t) => {
  replacePrismaDocument(t, {});
  const wrongSameLength = "x".repeat(SECRET.length);
  const response = await POST(makeRequest({ secret: wrongSameLength }));
  assert.strictEqual(response.status, 401);
});

test("#1875: secret of a different length returns 401 (no throw)", async (t) => {
  replacePrismaDocument(t, {});
  const response = await POST(makeRequest({ secret: "short" }));
  assert.strictEqual(response.status, 401);
});

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

test("#1875: oversized body (Content-Length preflight) returns 413 with the too-large message", async (t) => {
  replacePrismaDocument(t, {});
  const response = await POST(
    makeRequest({ contentLength: String(1024 * 1024) }),
  );
  assert.strictEqual(response.status, 413);
  const body = await response.json();
  assert.strictEqual(body.code, "VALIDATION_ERROR");
  assert.match(body.error, /too large/i);
});

test("#1875: malformed JSON body returns 400", async (t) => {
  replacePrismaDocument(t, {});
  const response = await POST(makeRequest({ rawBody: "{not json" }));
  assert.strictEqual(response.status, 400);
  const body = await response.json();
  assert.strictEqual(body.code, "VALIDATION_ERROR");
  assert.match(body.error, /invalid json/i);
});

test("#1875: payload missing documentId returns 400 with parser message", async (t) => {
  replacePrismaDocument(t, {});
  const response = await POST(makeRequest({ body: { update: VALID_UPDATE } }));
  assert.strictEqual(response.status, 400);
  const body = await response.json();
  assert.strictEqual(body.code, "VALIDATION_ERROR");
  assert.strictEqual(body.error, "Missing documentId.");
});

test("#2099: non-object and missing JSON payloads return 400", async (t) => {
  replacePrismaDocument(t, {});

  const cases = [
    {
      label: "null",
      request: makeRequest({ rawBody: "null" }),
      error: "Missing documentId.",
    },
    {
      label: "array",
      request: makeRequest({ rawBody: JSON.stringify(["doc", VALID_UPDATE]) }),
      error: "Missing documentId.",
    },
    {
      label: "string",
      request: makeRequest({ rawBody: JSON.stringify("payload") }),
      error: "Missing documentId.",
    },
    {
      label: "number",
      request: makeRequest({ rawBody: "42" }),
      error: "Missing documentId.",
    },
    {
      label: "missing body",
      request: makeRequest({ noBody: true }),
      error: "Invalid JSON body.",
    },
  ];

  for (const { label, request, error } of cases) {
    const response = await POST(request);
    assert.strictEqual(response.status, 400, `${label} should return 400`);
    const body = await response.json();
    assert.strictEqual(body.code, "VALIDATION_ERROR", label);
    assert.strictEqual(body.error, error, label);
  }
});

test("#1875: payload with invalid base64 update returns 400 with parser message", async (t) => {
  replacePrismaDocument(t, {});
  const response = await POST(
    makeRequest({ body: { documentId: DOCUMENT_ID, update: "not-base64!" } }),
  );
  assert.strictEqual(response.status, 400);
  const body = await response.json();
  assert.strictEqual(body.error, "Missing or invalid update.");
});

// ---------------------------------------------------------------------------
// Rate-limit budget exceeded
// ---------------------------------------------------------------------------

test("#1875: rate-limit budget exceeded returns 429 with Retry-After", async (t) => {
  replacePrismaDocument(t, {});
  globalForFlush.__collabFlushTestState.budgetResult = {
    allowed: false,
    retryAfterSeconds: 20,
  };

  const response = await POST(makeRequest());
  assert.strictEqual(response.status, 429);
  assert.strictEqual(response.headers.get("Retry-After"), "20");
  const body = await response.json();
  assert.strictEqual(body.code, "RATE_LIMITED");
});

// ---------------------------------------------------------------------------
// Document does not exist — the route never creates rows
// ---------------------------------------------------------------------------

test("#1875: nonexistent document returns 404 and never calls update", async (t) => {
  let updateCalled = false;
  replacePrismaDocument(t, {
    findUnique: async () => null,
    update: async () => {
      updateCalled = true;
      return {};
    },
  });

  const response = await POST(makeRequest());
  assert.strictEqual(response.status, 404);
  const body = await response.json();
  assert.strictEqual(body.code, "NOT_FOUND");
  assert.strictEqual(updateCalled, false, "flush must never create a document");
});

// ---------------------------------------------------------------------------
// Prisma update failure
// ---------------------------------------------------------------------------

test("#1875: prisma update failure returns 500 with a safe error body", async (t) => {
  replacePrismaDocument(t, {
    findUnique: async () => ({ id: DOCUMENT_ID }),
    update: async () => {
      throw new Error("simulated database connection failure");
    },
  });

  const response = await POST(makeRequest());
  assert.strictEqual(response.status, 500);
  const body = await response.json();
  assert.ok(typeof body.error === "string" && body.error.length > 0);
  assert.ok(!body.error.includes("database connection failure"));
});

// ---------------------------------------------------------------------------
// Successful flush — snapshot-only persistence
// ---------------------------------------------------------------------------

test("#1875: successful flush returns 200 and writes only the recovery snapshot fields", async (t) => {
  let updateArgs: unknown = null;
  replacePrismaDocument(t, {
    findUnique: async () => ({ id: DOCUMENT_ID }),
    update: async (args) => {
      updateArgs = args;
      return { id: DOCUMENT_ID };
    },
  });

  const response = await POST(makeRequest());
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true });

  const args = updateArgs as {
    where: { id: string };
    data: Record<string, unknown>;
  };
  assert.strictEqual(args.where.id, DOCUMENT_ID);
  assert.strictEqual(args.data.collabRecoverySnapshot, VALID_UPDATE);
  assert.ok(args.data.collabRecoverySavedAt instanceof Date);
  // Snapshot-only: contentJson (the canonical autosave field) must never be
  // touched by this best-effort recovery path.
  assert.strictEqual(args.data.contentJson, undefined);
  assert.deepEqual(Object.keys(args.data).sort(), [
    "collabRecoverySavedAt",
    "collabRecoverySnapshot",
  ]);
});

test("#1875: findUnique is scoped to the parsed documentId with a minimal select", async (t) => {
  let findArgs: unknown = null;
  replacePrismaDocument(t, {
    findUnique: async (args) => {
      findArgs = args;
      return { id: DOCUMENT_ID };
    },
    update: async () => ({ id: DOCUMENT_ID }),
  });

  const response = await POST(makeRequest());
  assert.strictEqual(response.status, 200);

  const args = findArgs as { where: { id: string }; select: unknown };
  assert.strictEqual(args.where.id, DOCUMENT_ID);
  assert.deepEqual(args.select, { id: true });
});
