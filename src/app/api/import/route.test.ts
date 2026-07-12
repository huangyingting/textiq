/**
 * Behavioral tests for POST /api/import (#1880, #96).
 *
 * These tests exercise the route handler directly rather than the pieces it
 * delegates to (already covered elsewhere): `processImportUpload`'s
 * validation/parse/timeout/budget contracts live in upload-service.test.ts,
 * and the multipart parsing contracts (missing file field, non-multipart
 * body) live in parser.test.ts. What this file covers is the route's OWN
 * wiring: the abuse-budget secret gate, per-IP rate limiting (429 +
 * Retry-After), pass-through of a parser-level rejection, product-telemetry
 * emission on start/success/failure, and the JSON success shape.
 *
 * Module-hook approach (mirrors collab/flush/route.test.ts and
 * collab/authorize/route.test.ts):
 *   `@/lib/abuse-budget`         — stubbed: controls `checkIpRateLimit`
 *                                  without a live rate-limit store.
 *   `@/lib/diagnostics/api-abuse` — stubbed: captures `logRouteDenial` calls
 *                                  (and re-exports the real `ABUSE_CATEGORIES`
 *                                  values the route branches on).
 *   `@/lib/log`                  — stubbed: captures `logError` calls and
 *                                  suppresses stderr noise.
 *   `@/lib/import/upload-service` — stubbed: controls `processImportUpload`
 *                                  so success/failure/telemetry mapping can be
 *                                  asserted without re-running a real parser.
 *
 * `@/lib/env` (AUTH_SECRET), `@/lib/api/errors`, `./parser`, and
 * `@/lib/telemetry/product` are left real: the secret gate is driven by
 * mutating `process.env.AUTH_SECRET`, the parser-rejection test exercises the
 * real multipart parser, and telemetry is captured via the real
 * `configureProductTelemetrySink` hook.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";

import { NextRequest } from "next/server";

import {
  configureProductTelemetrySink,
  type ProductTelemetryRecord,
} from "@/lib/telemetry/product";

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

type IpCheckResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
  subjectHash: string;
};

type ProcessImportUploadResult =
  | { ok: true; markdown: string }
  | { ok: false; status: 400 | 413 | 415 | 422; error: string };

type ImportRouteTestState = {
  ipCheckResult: IpCheckResult;
  checkIpRateLimitCalls: Array<{ namespace: string; secret: string }>;
  logRouteDenialCalls: Array<Record<string, unknown>>;
  logErrorCalls: Array<{ scope: string; context: Record<string, unknown> }>;
  processImportUploadImpl: (
    file: File,
    options: { subjectHash: string },
  ) => Promise<ProcessImportUploadResult>;
  processImportUploadCalls: Array<{
    file: File;
    options: { subjectHash: string };
  }>;
};

const globalForImportRoute = globalThis as typeof globalThis & {
  __importRouteTestState: ImportRouteTestState;
};

function createDefaultState(): ImportRouteTestState {
  return {
    ipCheckResult: { allowed: true, subjectHash: "default-subject-hash" },
    checkIpRateLimitCalls: [],
    logRouteDenialCalls: [],
    logErrorCalls: [],
    processImportUploadImpl: async () => ({
      ok: true,
      markdown: "# Default stub markdown",
    }),
    processImportUploadCalls: [],
  };
}

globalForImportRoute.__importRouteTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-import-route-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/abuse-budget",
    `
      export async function checkIpRateLimit(opts) {
        globalThis.__importRouteTestState.checkIpRateLimitCalls.push({
          namespace: opts.namespace,
          secret: opts.secret,
        });
        return globalThis.__importRouteTestState.ipCheckResult;
      }
    `,
  ],
  [
    "@/lib/diagnostics/api-abuse",
    `
      export const ABUSE_CATEGORIES = {
        RATE_LIMIT_HIT: "rate-limit-hit",
        ANON_QUOTA_DENIED: "anon-quota-denied",
        PARSER_TIMEOUT: "parser-timeout",
        AI_TIMEOUT: "ai-timeout",
        CREDIT_DENIED: "credit-denied",
      };
      export function logRouteDenial(event) {
        globalThis.__importRouteTestState.logRouteDenialCalls.push(event);
      }
    `,
  ],
  [
    "@/lib/log",
    `
      export function logError(scope, error, context) {
        globalThis.__importRouteTestState.logErrorCalls.push({ scope, context });
      }
      export function logInfo() {}
    `,
  ],
  [
    "@/lib/import/upload-service",
    `
      export async function processImportUpload(file, options) {
        globalThis.__importRouteTestState.processImportUploadCalls.push({ file, options });
        return globalThis.__importRouteTestState.processImportUploadImpl(file, options);
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
let POST: RouteModule["POST"];
let runtime: RouteModule["runtime"];

before(async () => {
  const mod = await import("./route");
  POST = mod.POST;
  runtime = mod.runtime;
});

const AUTH_SECRET = "test-only-import-route-secret";
let savedAuthSecretEnv: string | undefined;

beforeEach(() => {
  globalForImportRoute.__importRouteTestState = createDefaultState();
  savedAuthSecretEnv = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = AUTH_SECRET;
});

function restoreAuthSecretEnv(): void {
  if (savedAuthSecretEnv === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = savedAuthSecretEnv;
  }
}

function makeRequest(file?: File): NextRequest {
  const form = new FormData();
  if (file) {
    form.set("file", file);
  }
  return new NextRequest("http://localhost/api/import", {
    method: "POST",
    body: form,
  });
}

function fakeFile(name: string, type: string, content = "data"): File {
  return new File([Buffer.from(content)], name, { type });
}

async function collectTelemetry(t: {
  after(callback: () => void): void;
}): Promise<ProductTelemetryRecord[]> {
  const events: ProductTelemetryRecord[] = [];
  const restore = configureProductTelemetrySink((event) => {
    events.push(event);
  });
  t.after(restore);
  return events;
}

// ---------------------------------------------------------------------------
// Runtime flag
// ---------------------------------------------------------------------------

test("#1880: import route opts into the Node runtime", () => {
  assert.strictEqual(runtime, "nodejs");
});

// ---------------------------------------------------------------------------
// Missing / misconfigured abuse-budget secret
// ---------------------------------------------------------------------------

test("#1880: missing AUTH_SECRET returns 500 and never checks the rate limit or parses", async (t) => {
  delete process.env.AUTH_SECRET;
  t.after(restoreAuthSecretEnv);

  const response = await POST(makeRequest(fakeFile("doc.md", "text/markdown")));

  assert.strictEqual(response.status, 500);
  const body = await response.json();
  assert.strictEqual(body.code, "SERVER_ERROR");
  assert.match(body.error, /misconfigured/i);

  const state = globalForImportRoute.__importRouteTestState;
  assert.strictEqual(
    state.checkIpRateLimitCalls.length,
    0,
    "the rate limit must never be checked when the secret is missing",
  );
  assert.strictEqual(
    state.processImportUploadCalls.length,
    0,
    "the upload must never be processed when the secret is missing",
  );
  assert.strictEqual(state.logErrorCalls.length, 1);
  assert.strictEqual(
    state.logErrorCalls[0]?.context?.["reason"],
    "missing-auth-secret",
  );
});

test("#1880: a blank (whitespace-only) AUTH_SECRET is treated as missing", async (t) => {
  process.env.AUTH_SECRET = "   ";
  t.after(restoreAuthSecretEnv);

  const response = await POST(makeRequest(fakeFile("doc.md", "text/markdown")));

  assert.strictEqual(response.status, 500);
  const state = globalForImportRoute.__importRouteTestState;
  assert.strictEqual(state.checkIpRateLimitCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Rate-limit budget exceeded
// ---------------------------------------------------------------------------

test("#1880: rate-limit budget exceeded returns 429 with Retry-After and logs the denial", async () => {
  const state = globalForImportRoute.__importRouteTestState;
  state.ipCheckResult = {
    allowed: false,
    retryAfterSeconds: 42,
    subjectHash: "blocked-subject",
  };

  const response = await POST(makeRequest(fakeFile("doc.md", "text/markdown")));

  assert.strictEqual(response.status, 429);
  assert.strictEqual(response.headers.get("Retry-After"), "42");
  const body = await response.json();
  assert.strictEqual(body.code, "RATE_LIMITED");

  assert.strictEqual(state.checkIpRateLimitCalls.length, 1);
  assert.strictEqual(state.checkIpRateLimitCalls[0]?.namespace, "import.ip");
  assert.strictEqual(state.checkIpRateLimitCalls[0]?.secret, AUTH_SECRET);

  assert.strictEqual(state.logRouteDenialCalls.length, 1);
  assert.strictEqual(
    state.logRouteDenialCalls[0]?.["reason"],
    "rate-limit-hit",
  );
  assert.strictEqual(state.logRouteDenialCalls[0]?.["status"], 429);
  assert.strictEqual(
    state.logRouteDenialCalls[0]?.["subjectHash"],
    "blocked-subject",
  );
  assert.strictEqual(state.logRouteDenialCalls[0]?.["retryAfterSeconds"], 42);

  assert.strictEqual(
    state.processImportUploadCalls.length,
    0,
    "the upload must never be processed once the rate limit is exceeded",
  );
});

test("#1880: rate-limit denial with no retryAfterSeconds omits the Retry-After header", async () => {
  const state = globalForImportRoute.__importRouteTestState;
  state.ipCheckResult = { allowed: false, subjectHash: "blocked-subject" };

  const response = await POST(makeRequest(fakeFile("doc.md", "text/markdown")));

  assert.strictEqual(response.status, 429);
  assert.strictEqual(response.headers.get("Retry-After"), null);
});

// ---------------------------------------------------------------------------
// Malformed upload — parser-level rejection passes through untouched
// ---------------------------------------------------------------------------

test("#1880: a request with no `file` field returns the parser's 400 response and never delegates", async () => {
  const response = await POST(makeRequest());

  assert.strictEqual(response.status, 400);
  const body = await response.json();
  assert.strictEqual(body.code, "VALIDATION_ERROR");
  assert.strictEqual(body.error, "Missing `file` field in form data.");

  const state = globalForImportRoute.__importRouteTestState;
  assert.strictEqual(
    state.processImportUploadCalls.length,
    0,
    "a malformed upload must never reach processImportUpload",
  );
});

// ---------------------------------------------------------------------------
// processImportUpload failure — status/error mapping + failure telemetry
// ---------------------------------------------------------------------------

test("#1880: a processImportUpload failure maps to validationError(status) and emits failure telemetry", async (t) => {
  const events = await collectTelemetry(t);
  const state = globalForImportRoute.__importRouteTestState;
  state.processImportUploadImpl = async () => ({
    ok: false,
    status: 422,
    error: "Could not parse the file.",
  });

  const file = fakeFile("doc.pdf", "application/pdf", "pdf-bytes");
  const response = await POST(makeRequest(file));

  assert.strictEqual(response.status, 422);
  const body = await response.json();
  assert.strictEqual(body.code, "VALIDATION_ERROR");
  assert.strictEqual(body.error, "Could not parse the file.");

  assert.strictEqual(state.processImportUploadCalls.length, 1);
  assert.strictEqual(
    state.processImportUploadCalls[0]?.options.subjectHash,
    "default-subject-hash",
  );

  const started = events.find((e) => e.eventName === "product.import.started");
  const failed = events.find((e) => e.eventName === "product.import.failed");
  assert.ok(started, "must emit product.import.started");
  assert.ok(failed, "must emit product.import.failed");
  assert.strictEqual(started?.fields.fileType, "pdf");
  assert.strictEqual(started?.fields.surface, "api");
  assert.strictEqual(failed?.fields.status, 422);
  assert.strictEqual(failed?.fields.failureReason, "client");
  assert.strictEqual(failed?.fields.fileType, "pdf");
  assert.strictEqual(failed?.fields.surface, "api");
  assert.ok(typeof failed?.fields.durationBucket === "string");
  assert.strictEqual(
    events.some((e) => e.eventName === "product.import.succeeded"),
    false,
  );
});

// ---------------------------------------------------------------------------
// Successful delegation
// ---------------------------------------------------------------------------

test("#1880: a successful processImportUpload returns 200 with the markdown body and emits success telemetry", async (t) => {
  const events = await collectTelemetry(t);
  const state = globalForImportRoute.__importRouteTestState;
  state.ipCheckResult = { allowed: true, subjectHash: "success-subject" };
  state.processImportUploadImpl = async () => ({
    ok: true,
    markdown: "# Imported\n\nContent.",
  });

  const file = fakeFile("notes.md", "text/markdown", "# Imported\n\nContent.");
  const response = await POST(makeRequest(file));

  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { markdown: "# Imported\n\nContent." });

  assert.strictEqual(state.processImportUploadCalls.length, 1);
  assert.strictEqual(state.processImportUploadCalls[0]?.file.name, "notes.md");
  assert.strictEqual(
    state.processImportUploadCalls[0]?.options.subjectHash,
    "success-subject",
  );

  const started = events.find((e) => e.eventName === "product.import.started");
  const succeeded = events.find(
    (e) => e.eventName === "product.import.succeeded",
  );
  assert.ok(started, "must emit product.import.started");
  assert.ok(succeeded, "must emit product.import.succeeded");
  assert.strictEqual(started?.fields.fileType, "md");
  assert.strictEqual(succeeded?.fields.fileType, "md");
  assert.strictEqual(succeeded?.fields.surface, "api");
  assert.ok(typeof succeeded?.fields.durationBucket === "string");
  assert.strictEqual(
    events.some((e) => e.eventName === "product.import.failed"),
    false,
  );
});
