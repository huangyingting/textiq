import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  buildCollabHealthSummary,
  COLLAB_INLINE_PATH,
  createCollabHealthHandler,
  createRuntimeAuthorizer,
  createRuntimeEvictionFlusher,
  emitDeploymentDiagnostics,
  resolveCollabDeployment,
  resolveCollabInternalSecret,
  resolveCollabServiceUrls,
  roomFromInlineUrl,
  roomFromStandaloneUrl,
} from "./collab-runtime.mjs";
import {
  emitDeploymentDiagnostics as emitDeploymentDiagnosticsImpl,
  resolveCollabDeployment as resolveCollabDeploymentImpl,
} from "./collab-runtime-config.mjs";
import {
  buildCollabHealthSummary as buildCollabHealthSummaryImpl,
  createCollabHealthHandler as createCollabHealthHandlerImpl,
} from "./collab-runtime-health.mjs";
import {
  createRuntimeAuthorizer as createRuntimeAuthorizerImpl,
  createRuntimeEvictionFlusher as createRuntimeEvictionFlusherImpl,
} from "./collab-runtime-bootstrap.mjs";
import {
  COLLAB_INLINE_PATH as COLLAB_INLINE_PATH_IMPL,
  resolveCollabInternalSecret as resolveCollabInternalSecretImpl,
  resolveCollabServiceUrls as resolveCollabServiceUrlsImpl,
  roomFromInlineUrl as roomFromInlineUrlImpl,
  roomFromStandaloneUrl as roomFromStandaloneUrlImpl,
} from "./collab-runtime-service.mjs";

const originalConsole = {
  info: console.info,
  warn: console.warn,
  error: console.error,
};

afterEach(() => {
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

describe("collab-runtime health summary", () => {
  test("buildCollabHealthSummary matches inline and standalone health payload shape", () => {
    const deploymentConfig = resolveCollabDeployment({
      COLLAB_SINGLE_INSTANCE: "1",
    });
    const summary = buildCollabHealthSummary({
      deploymentConfig,
      rooms: 2,
      connections: 5,
      flushFailures: 1,
      recentFlushFailureCount: 1,
    });

    assert.deepEqual(summary, {
      ok: true,
      rooms: 2,
      connections: 5,
      mode: "single-instance",
      warnings: [],
      healthy: true,
      flushFailures: 1,
      recentFlushFailureCount: 1,
    });
  });

  test("createCollabHealthHandler serializes live stats as JSON", () => {
    const writes = [];
    const response = {
      writeHead: (status, headers) => writes.push({ status, headers }),
      end: (body) => writes.push({ body }),
    };
    const handler = createCollabHealthHandler({
      deploymentConfig: {
        mode: "single-instance",
        warnings: [],
        healthy: true,
      },
      getStats: () => ({
        rooms: 1,
        connections: 2,
        flushFailures: 0,
        recentFlushFailureCount: 0,
      }),
    });

    handler({}, response);

    assert.deepEqual(writes[0], {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    assert.equal(JSON.parse(writes[1].body).connections, 2);
  });

  test("createCollabHealthHandler omits per-room failure ids from the public payload", () => {
    const writes = [];
    const response = {
      writeHead: (status, headers) => writes.push({ status, headers }),
      end: (body) => writes.push({ body }),
    };
    const handler = createCollabHealthHandler({
      deploymentConfig: {
        mode: "single-instance",
        warnings: [],
        healthy: true,
      },
      getStats: () => ({
        rooms: 1,
        connections: 2,
        flushFailures: 3,
        recentFlushFailureCount: 1,
      }),
    });

    handler({}, response);

    const payload = JSON.parse(writes[1].body);
    assert.equal(payload.flushFailures, 3);
    assert.equal(payload.recentFlushFailureCount, 1);
    assert.equal("recentFlushFailures" in payload, false);
    assert.equal("room" in payload, false);
    assert.equal("docId" in payload, false);
    assert.equal(JSON.stringify(payload).includes("doc-1"), false);
  });

  test("buildCollabHealthSummary reports unhealthy deployment as ok=false", () => {
    const deploymentConfig = resolveCollabDeployment({
      COLLAB_INSTANCE_COUNT: "2",
    });

    const summary = buildCollabHealthSummary({
      deploymentConfig,
      rooms: 0,
      connections: 0,
      flushFailures: 0,
      recentFlushFailureCount: 0,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.healthy, false);
    assert.equal(summary.warnings.length, 1);
  });

  test("resolveCollabDeployment accepts sticky multi-instance and advisory single-instance defaults", () => {
    assert.deepEqual(
      resolveCollabDeployment({
        COLLAB_INSTANCE_COUNT: "3",
        COLLAB_STICKY_ROUTING: "true",
      }),
      { mode: "unconfigured", warnings: [], healthy: true },
    );
    const advisory = resolveCollabDeployment({});
    assert.equal(advisory.healthy, true);
    assert.equal(advisory.warnings.length, 1);
  });
});

describe("collab-runtime deployment diagnostics", () => {
  test("inline warnings preserve the existing human-readable console output", () => {
    const warnings = [];
    console.warn = (line) => warnings.push(String(line));
    const healthy = emitDeploymentDiagnostics(
      {
        mode: "unconfigured",
        healthy: true,
        warnings: ["declare single instance"],
      },
      {
        runtimeMode: "inline",
        writeInlineWarning: (line) => warnings.push(String(line)),
      },
    );

    assert.equal(healthy, true);
    assert.deepEqual(warnings, [
      "[collab] CONFIG WARNING: declare single instance",
    ]);
  });

  test("standalone warnings use the shared structured script logger", () => {
    const warnings = [];
    console.warn = (line) => warnings.push(String(line));
    const healthy = emitDeploymentDiagnostics(
      {
        mode: "unconfigured",
        healthy: true,
        warnings: ["declare single instance"],
      },
      { runtimeMode: "standalone", scope: "collab.server.configure" },
    );

    assert.equal(healthy, true);
    assert.equal(warnings.length, 1);
    const parsed = JSON.parse(warnings[0]);
    assert.equal(parsed.level, "warning");
    assert.equal(parsed.scope, "collab.server.configure");
    assert.equal(parsed.mode, "unconfigured");
    assert.equal(parsed.warning, "declare single instance");
  });

  test("unhealthy inline config fails closed without changing fatal output text", () => {
    const errors = [];
    console.error = (line) => errors.push(String(line));
    const healthy = emitDeploymentDiagnostics(
      {
        mode: "unconfigured",
        healthy: false,
        warnings: ["load balancer missing sticky routing"],
      },
      {
        runtimeMode: "inline",
        writeInlineError: (line) => errors.push(String(line)),
      },
    );

    assert.equal(healthy, false);
    assert.deepEqual(errors, [
      "[collab] FATAL CONFIG ERROR: load balancer missing sticky routing",
      "[collab] Refusing to start in a misconfigured multi-instance environment. Fix the configuration and restart.",
    ]);
  });

  test("unhealthy standalone config fails closed with structured errors", () => {
    const errors = [];
    console.error = (line) => errors.push(String(line));
    const healthy = emitDeploymentDiagnostics(
      {
        mode: "unconfigured",
        healthy: false,
        warnings: ["load balancer missing sticky routing"],
      },
      { runtimeMode: "standalone", scope: "collab.server.configure" },
    );

    assert.equal(healthy, false);
    assert.equal(errors.length, 2);
    assert.equal(JSON.parse(errors[0]).scope, "collab.server.configure");
    assert.equal(
      JSON.parse(errors[1]).message,
      "refusing to start in a misconfigured environment",
    );
  });
});

describe("collab-runtime service URL and secret resolution", () => {
  test("inline authorizer and flusher URLs always target the same local app server", () => {
    const urls = resolveCollabServiceUrls({
      runtimeMode: "inline",
      env: {
        AUTH_URL: "https://app.example.com/",
        COLLAB_AUTHORIZE_URL: "https://override.example.com/authz",
      },
      port: 4567,
    });

    assert.deepEqual(urls, {
      appBaseUrl: "http://127.0.0.1:4567",
      authorizeUrl: "http://127.0.0.1:4567/api/collab/authorize",
      flushUrl: "http://127.0.0.1:4567/api/collab/flush",
    });
  });

  test("standalone URLs resolve from AUTH_URL and COLLAB_AUTHORIZE_URL", () => {
    const urls = resolveCollabServiceUrls({
      runtimeMode: "standalone",
      env: {
        AUTH_URL: "https://app.example.com/",
        COLLAB_AUTHORIZE_URL: "https://authz.example.com/check",
      },
    });

    assert.deepEqual(urls, {
      appBaseUrl: "https://app.example.com",
      authorizeUrl: "https://authz.example.com/check",
      flushUrl: "https://app.example.com/api/collab/flush",
    });
  });

  test("standalone URLs keep the historical localhost default", () => {
    const urls = resolveCollabServiceUrls({
      runtimeMode: "standalone",
      env: {},
    });

    assert.deepEqual(urls, {
      appBaseUrl: "http://127.0.0.1:4000",
      authorizeUrl: "http://127.0.0.1:4000/api/collab/authorize",
      flushUrl: "http://127.0.0.1:4000/api/collab/flush",
    });
  });

  test("COLLAB_INTERNAL_SECRET is forwarded unchanged to preserve existing behavior", () => {
    assert.equal(
      resolveCollabInternalSecret({ COLLAB_INTERNAL_SECRET: "  secret  " }),
      "  secret  ",
    );
    assert.equal(resolveCollabInternalSecret({}), undefined);
  });
});

describe("collab-runtime authorizer and flusher construction", () => {
  test("runtime authorizer uses resolved URL and forwards cookies", async () => {
    let captured = null;
    const authorize = createRuntimeAuthorizer({
      runtimeMode: "inline",
      port: 4567,
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return {
          status: 200,
          json: async () => ({ ok: true, readOnly: true }),
        };
      },
    });

    const decision = await authorize(
      { headers: { cookie: "session=abc" } },
      "doc 1",
    );

    assert.deepEqual(decision, { ok: true, status: 101, readOnly: true });
    assert.equal(
      captured.url,
      "http://127.0.0.1:4567/api/collab/authorize?room=doc%201",
    );
    assert.equal(captured.init.headers.cookie, "session=abc");
    assert.equal(captured.init.headers.accept, "application/json");
  });

  test("runtime flusher uses resolved URL and secret without real sockets", async () => {
    console.info = () => {};
    let captured = null;
    const flush = createRuntimeEvictionFlusher({
      runtimeMode: "standalone",
      env: {
        AUTH_URL: "https://app.example.com/",
        COLLAB_INTERNAL_SECRET: "s3cret",
      },
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return { ok: true, status: 200 };
      },
    });

    await flush("doc-1", new Uint8Array([1, 2, 3]));

    assert.equal(captured.url, "https://app.example.com/api/collab/flush");
    assert.equal(captured.init.headers["x-collab-internal-secret"], "s3cret");
    assert.equal(JSON.parse(captured.init.body).documentId, "doc-1");
  });

  test("runtime flusher remains a no-op with warning when the secret is missing", async () => {
    const warnings = [];
    console.warn = (line) => warnings.push(String(line));
    let called = false;
    const flush = createRuntimeEvictionFlusher({
      runtimeMode: "inline",
      port: 4567,
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200 };
      },
    });

    await flush("doc-1", new Uint8Array([1, 2, 3]));

    assert.equal(called, false);
    assert.equal(warnings.length, 1);
    assert.equal(JSON.parse(warnings[0]).reason, "missing-internal-secret");
  });
});

describe("collab-runtime room naming rules", () => {
  test("inline room names are trimmed after /collab", () => {
    assert.equal(roomFromInlineUrl("/collab/doc-1"), "doc-1");
    assert.equal(roomFromInlineUrl("/collab/doc-1?token=ignored"), "doc-1");
    assert.equal(roomFromInlineUrl("/collab/"), "default");
    assert.equal(roomFromInlineUrl("/collab"), "default");
  });

  test("standalone room names use the full root path", () => {
    assert.equal(roomFromStandaloneUrl("/doc-1"), "doc-1");
    assert.equal(roomFromStandaloneUrl("/doc-1?token=ignored"), "doc-1");
    assert.equal(roomFromStandaloneUrl("/"), "default");
    assert.equal(roomFromStandaloneUrl(undefined), "default");
  });
});

describe("collab-runtime facade parity", () => {
  test("re-exports config and diagnostics helpers", () => {
    assert.equal(resolveCollabDeployment, resolveCollabDeploymentImpl);
    assert.equal(emitDeploymentDiagnostics, emitDeploymentDiagnosticsImpl);
  });

  test("re-exports health helpers", () => {
    assert.equal(buildCollabHealthSummary, buildCollabHealthSummaryImpl);
    assert.equal(createCollabHealthHandler, createCollabHealthHandlerImpl);
  });

  test("re-exports service URL/room helpers", () => {
    assert.equal(COLLAB_INLINE_PATH, COLLAB_INLINE_PATH_IMPL);
    assert.equal(resolveCollabServiceUrls, resolveCollabServiceUrlsImpl);
    assert.equal(resolveCollabInternalSecret, resolveCollabInternalSecretImpl);
    assert.equal(roomFromInlineUrl, roomFromInlineUrlImpl);
    assert.equal(roomFromStandaloneUrl, roomFromStandaloneUrlImpl);
    assert.equal(COLLAB_INLINE_PATH_IMPL, "/collab");
  });

  test("re-exports runtime bootstrap helpers", () => {
    assert.equal(createRuntimeAuthorizer, createRuntimeAuthorizerImpl);
    assert.equal(
      createRuntimeEvictionFlusher,
      createRuntimeEvictionFlusherImpl,
    );
  });
});
