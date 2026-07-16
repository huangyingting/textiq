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

type CreateDocumentFromImportResult =
  | { ok: true; documentId: string; documentPath: string }
  | {
      ok: false;
      error: {
        code: string;
        status: number;
        message: string;
      };
    };

type ImportRouteTestState = {
  ipCheckResult: IpCheckResult;
  checkIpRateLimitCalls: Array<{ namespace: string; secret: string }>;
  logRouteDenialCalls: Array<Record<string, unknown>>;
  logErrorCalls: Array<{ scope: string; context: Record<string, unknown> }>;
  createDocumentFromImportUploadImpl: (input: {
    file: File;
    subjectHash: string;
    target: { kind: "personal" } | { kind: "workspace"; workspaceId: string };
    signal: AbortSignal;
    deadlineAt: number;
  }) => Promise<CreateDocumentFromImportResult>;
  createDocumentFromImportUploadCalls: Array<{
    file: File;
    subjectHash: string;
    target: { kind: "personal" } | { kind: "workspace"; workspaceId: string };
    signal: AbortSignal;
    deadlineAt: number;
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
    createDocumentFromImportUploadImpl: async () => ({
      ok: true,
      documentId: "doc-default",
      documentPath: "/app/documents/doc-default",
    }),
    createDocumentFromImportUploadCalls: [],
  };
}

globalForImportRoute.__importRouteTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-import-route-test:";
const stubbedModules = new Map<string, string>([
  ["server-only", ""],
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
    "@/lib/import/application-service",
    `
      export async function createDocumentFromImportUpload(input) {
        globalThis.__importRouteTestState.createDocumentFromImportUploadCalls.push(input);
        return globalThis.__importRouteTestState.createDocumentFromImportUploadImpl(input);
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

function makeRequest(
  args: {
    file?: File;
    target?: "personal" | "workspace";
    workspaceId?: string;
  } = {},
): NextRequest {
  const form = new FormData();
  if (args.file) {
    form.set("file", args.file);
  }
  if (args.target) {
    form.set("target", args.target);
  }
  if (args.workspaceId) {
    form.set("workspaceId", args.workspaceId);
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

test("import route opts into the Node runtime", () => {
  assert.strictEqual(runtime, "nodejs");
});

test("missing AUTH_SECRET returns 500 and never checks the rate limit or parses", async (t) => {
  delete process.env.AUTH_SECRET;
  t.after(restoreAuthSecretEnv);

  const response = await POST(
    makeRequest({
      file: fakeFile("doc.md", "text/markdown"),
      target: "personal",
    }),
  );

  assert.strictEqual(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: {
      code: "internal",
      status: 500,
      message: "Server is misconfigured (missing AUTH_SECRET).",
    },
  });

  const state = globalForImportRoute.__importRouteTestState;
  assert.strictEqual(state.checkIpRateLimitCalls.length, 0);
  assert.strictEqual(state.createDocumentFromImportUploadCalls.length, 0);
  assert.strictEqual(state.logErrorCalls.length, 1);
  assert.strictEqual(
    state.logErrorCalls[0]?.context?.["reason"],
    "missing-auth-secret",
  );
});

test("rate-limit budget exceeded returns 429 with Retry-After and logs denial", async () => {
  const state = globalForImportRoute.__importRouteTestState;
  state.ipCheckResult = {
    allowed: false,
    retryAfterSeconds: 42,
    subjectHash: "blocked-subject",
  };

  const response = await POST(
    makeRequest({
      file: fakeFile("doc.md", "text/markdown"),
      target: "personal",
    }),
  );

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
  assert.strictEqual(state.createDocumentFromImportUploadCalls.length, 0);
});

test("a request with no file field returns malformed import failure and never delegates", async () => {
  const response = await POST(makeRequest({ target: "personal" }));

  assert.strictEqual(response.status, 422);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Missing `file` field in form data.",
    },
  });

  const state = globalForImportRoute.__importRouteTestState;
  assert.strictEqual(state.createDocumentFromImportUploadCalls.length, 0);
});

test("application-service failure returns typed import error and emits failure telemetry", async (t) => {
  const events = await collectTelemetry(t);
  const state = globalForImportRoute.__importRouteTestState;
  state.createDocumentFromImportUploadImpl = async () => ({
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Could not parse the file.",
    },
  });

  const file = fakeFile("doc.pdf", "application/pdf", "pdf-bytes");
  const response = await POST(makeRequest({ file, target: "personal" }));

  assert.strictEqual(response.status, 422);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Could not parse the file.",
    },
  });
  assert.strictEqual(body.error.status, response.status);

  assert.strictEqual(state.createDocumentFromImportUploadCalls.length, 1);
  assert.strictEqual(
    state.createDocumentFromImportUploadCalls[0]?.subjectHash,
    "default-subject-hash",
  );
  assert.strictEqual(
    state.createDocumentFromImportUploadCalls[0]?.target.kind,
    "personal",
  );
  assert.strictEqual(
    state.createDocumentFromImportUploadCalls[0]?.signal.aborted,
    false,
  );
  assert.ok(
    Number.isFinite(state.createDocumentFromImportUploadCalls[0]?.deadlineAt),
  );

  const started = events.find((e) => e.eventName === "product.import.started");
  const failed = events.find((e) => e.eventName === "product.import.failed");
  assert.ok(started);
  assert.ok(failed);
  assert.strictEqual(started?.fields.fileType, "pdf");
  assert.strictEqual(failed?.fields.status, 422);
  assert.strictEqual(failed?.fields.failureReason, "malformed");
  assert.strictEqual(failed?.fields.fileType, "pdf");
  assert.strictEqual(
    events.some((e) => e.eventName === "product.import.succeeded"),
    false,
  );
});

test("successful create returns flat success payload and emits success telemetry", async (t) => {
  const events = await collectTelemetry(t);
  const state = globalForImportRoute.__importRouteTestState;
  state.ipCheckResult = { allowed: true, subjectHash: "success-subject" };
  state.createDocumentFromImportUploadImpl = async () => ({
    ok: true,
    documentId: "doc-123",
    documentPath: "/app/documents/doc-123",
  });

  const file = fakeFile("notes.md", "text/markdown", "# Imported\n\nContent.");
  const response = await POST(makeRequest({ file, target: "personal" }));

  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: true,
    documentId: "doc-123",
    documentPath: "/app/documents/doc-123",
  });

  assert.strictEqual(state.createDocumentFromImportUploadCalls.length, 1);
  assert.strictEqual(
    state.createDocumentFromImportUploadCalls[0]?.file.name,
    "notes.md",
  );
  assert.strictEqual(
    state.createDocumentFromImportUploadCalls[0]?.subjectHash,
    "success-subject",
  );

  const started = events.find((e) => e.eventName === "product.import.started");
  const succeeded = events.find(
    (e) => e.eventName === "product.import.succeeded",
  );
  assert.ok(started);
  assert.ok(succeeded);
  assert.strictEqual(started?.fields.fileType, "md");
  assert.strictEqual(succeeded?.fields.fileType, "md");
  assert.strictEqual(succeeded?.fields.surface, "api");
  assert.strictEqual(
    events.some((e) => e.eventName === "product.import.failed"),
    false,
  );
});
