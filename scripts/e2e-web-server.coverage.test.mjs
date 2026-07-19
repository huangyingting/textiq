import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import {
  closeSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { connect as createTlsConnection } from "node:tls";
import test from "node:test";

import {
  authenticateE2EProfile,
  precompileE2EProfileRoutes,
  proxyResponseHeaders,
  resolveE2EWebServerCredentials,
  rewriteE2ERedirectLocation,
  startE2EWebServer,
} from "./e2e-web-server.mjs";
import { buildE2EProfileEnv, provisionE2ETlsIdentity } from "./e2e-profile.mjs";
import {
  E2E_CAPABILITY_ENDPOINT,
  E2E_GATE_CAPABILITY_HEADER,
  openVerifiedProxyChannel,
  requestOnVerifiedProxyChannel,
} from "./e2e-credential-gate.mjs";
import { resolveLiveCredentialGateConfig } from "./e2e-credential-gate.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

test("web server config and startup reject missing secrets before binding", async () => {
  assert.deepEqual(resolveE2EWebServerCredentials({}), {
    email: "e2e-owner@textiq.test",
    password: "e2e-owner-pw-2026",
  });
  assert.deepEqual(
    resolveE2EWebServerCredentials({
      E2E_PROFILE_PRECOMPILE_EMAIL: "profile@example.test",
      E2E_PROFILE_PRECOMPILE_PASSWORD: "profile-pw",
      E2E_USER_EMAIL: "user@example.test",
      E2E_USER_PASSWORD: "user-pw",
    }),
    { email: "profile@example.test", password: "profile-pw" },
  );
  assert.deepEqual(
    resolveE2EWebServerCredentials({
      E2E_USER_EMAIL: "user@example.test",
      E2E_USER_PASSWORD: "user-pw",
    }),
    { email: "user@example.test", password: "user-pw" },
  );

  await assert.rejects(
    startE2EWebServer({ certificate: "cert" }),
    /certificate and key/,
  );
  await assert.rejects(
    startE2EWebServer({ privateKey: "key" }),
    /certificate and key/,
  );
});

test("authentication helper rejects bad CSRF, callback, session, and oversized responses", async () => {
  await assert.rejects(
    authenticateE2EProfile({
      origin: "https://localhost:4000",
      email: "owner@example.test",
      password: "pw",
      fetchImpl: async () => response("{}", { status: 500 }),
    }),
    /CSRF request returned 500/,
  );
  await assert.rejects(
    authenticateE2EProfile({
      origin: "https://localhost:4000",
      email: "owner@example.test",
      password: "pw",
      fetchImpl: async () => response("{}"),
    }),
    /did not return a CSRF token/,
  );
  await assert.rejects(
    authenticateE2EProfile({
      origin: "https://localhost:4000",
      email: "owner@example.test",
      password: "pw",
      fetchImpl: async () => response("x".repeat(70 * 1024)),
    }),
    /exceeded its response limit/,
  );

  const callbackStatuses = [
    response(JSON.stringify({ csrfToken: "csrf" }), {
      headers: { "set-cookie": "authjs.csrf-token=csrf; Path=/" },
    }),
    response("nope", { status: 401 }),
  ];
  await assert.rejects(
    authenticateE2EProfile({
      origin: "https://localhost:4000",
      email: "owner@example.test",
      password: "pw",
      fetchImpl: async () => callbackStatuses.shift(),
    }),
    /authentication returned 401/,
  );

  const missingSession = [
    response(JSON.stringify({ csrfToken: "csrf" }), {
      headers: { "set-cookie": "authjs.csrf-token=csrf; Path=/" },
    }),
    response(null, {
      status: 302,
      headers: { "set-cookie": "authjs.csrf-token=; Path=/" },
    }),
  ];
  await assert.rejects(
    authenticateE2EProfile({
      origin: "https://localhost:4000",
      email: "owner@example.test",
      password: "pw",
      fetchImpl: async () => missingSession.shift(),
    }),
    /did not set a session cookie/,
  );

  const success = [
    response(JSON.stringify({ csrfToken: "csrf" }), {
      headers: { "set-cookie": "authjs.csrf-token=csrf; Path=/" },
    }),
    response(null, {
      status: 303,
      headers: {
        "set-cookie": "__Secure-authjs.session-token=session; Path=/",
      },
    }),
  ];
  assert.equal(
    await authenticateE2EProfile({
      origin: "https://localhost:4000",
      email: "owner@example.test",
      password: "pw",
      fetchImpl: async () => success.shift(),
      assertServerIdentity: async () => {},
    }),
    "authjs.csrf-token=csrf; __Secure-authjs.session-token=session",
  );
});

test("precompile helper validates expected statuses and response size", async () => {
  const logs = [];
  await precompileE2EProfileRoutes({
    origin: "https://localhost:4000",
    cookie: "session=1",
    routes: [
      { method: "GET", path: "/app", status: 200 },
      { method: "POST", path: "/api/import", status: 204 },
    ],
    fetchImpl: async (target, init) => {
      assert.equal(init.headers.cookie, "session=1");
      return target.pathname === "/app"
        ? response("", { status: 200 })
        : new Response(null, { status: 204 });
    },
    stdout: (line) => logs.push(line),
  });
  assert.deepEqual(logs, [
    "[e2e-readiness] GET /app -> 200",
    "[e2e-readiness] POST /api/import -> 204",
  ]);

  await assert.rejects(
    precompileE2EProfileRoutes({
      origin: "https://localhost:4000",
      cookie: "session=1",
      routes: [{ method: "GET", path: "/app", status: 200 }],
      fetchImpl: async () => response("missing", { status: 404 }),
      stdout: () => {},
    }),
    /returned 404; expected 200/,
  );
  await assert.rejects(
    precompileE2EProfileRoutes({
      origin: "https://localhost:4000",
      routes: [{ method: "GET", path: "/large", status: 200 }],
      fetchImpl: async () => response("x".repeat(9 * 1024 * 1024)),
      stdout: () => {},
    }),
    /exceeded its response limit/,
  );
});

test("redirect and response header proxying reject ambiguous upstream locations", () => {
  const appOrigin = new URL("http://localhost:4402");
  const externalOrigin = new URL("https://localhost:4400");
  assert.equal(
    rewriteE2ERedirectLocation("/login#ready", appOrigin, externalOrigin),
    "https://localhost:4400/login#ready",
  );
  assert.equal(
    rewriteE2ERedirectLocation(
      "http://localhost:4402/app",
      appOrigin,
      externalOrigin,
    ),
    "https://localhost:4400/app",
  );
  assert.equal(
    rewriteE2ERedirectLocation(
      "https://localhost:4400/app",
      appOrigin,
      externalOrigin,
    ),
    "https://localhost:4400/app",
  );
  assert.throws(
    () =>
      rewriteE2ERedirectLocation(
        "/profile",
        new URL("http://user:pass@localhost:4402"),
        externalOrigin,
      ),
    /external upstream Location/,
  );
  for (const location of [
    "http://evil.example/app",
    "//evil.example/app",
    "https://user:pass@localhost:4400/app",
    "http://localhost%2eevil.example:4402/app",
    "http:\\evil.example\\app",
    "http:%2f%2fevil.example/app",
    "javascript:alert(1)",
  ]) {
    assert.throws(() =>
      rewriteE2ERedirectLocation(location, appOrigin, externalOrigin),
    );
  }

  assert.deepEqual(
    proxyResponseHeaders({
      appOrigin,
      externalOrigin,
      headers: {
        connection: "close",
        "content-type": "text/html",
        location: "/login",
        "transfer-encoding": "chunked",
      },
      rawHeaders: ["Location", "/login"],
    }),
    {
      "content-type": "text/html",
      "transfer-encoding": "chunked",
      location: "https://localhost:4400/login",
    },
  );
  assert.throws(() =>
    proxyResponseHeaders({
      appOrigin,
      externalOrigin,
      headers: { location: ["/one", "/two"] },
      rawHeaders: ["Location", "/one", "location", "/two"],
    }),
  );
});

test("secure web proxy rejects invalid capabilities and request targets", async (t) => {
  let sequence = 0;
  async function fixture(label, { withApp = true } = {}) {
    sequence += 1;
    const root = createTestFixtureRoot(`web-proxy-${label}`);
    t.after(() => rmSync(root, { force: true, recursive: true }));
    const basePort = 5100 + (process.pid % 100) * 3 + sequence * 3;
    const env = buildE2EProfileEnv(
      { E2E_PROFILE_PORT: String(basePort) },
      { repoRoot: root, runId: `web-proxy-${label}`, runNonce: "a".repeat(64) },
    );
    mkdirSync(join(root, ".next", "e2e-profile", `web-proxy-${label}`), {
      recursive: true,
    });
    writeFileSync(env.E2E_PROFILE_SERVER_PID_FILE, String(process.pid) + "\n", {
      mode: 0o600,
    });
    let app;
    if (withApp) {
      app = createHttpServer((request, response) => {
        request.resume();
        if (request.url === "/app") {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("ok");
        } else {
          response.writeHead(404);
          response.end("missing");
        }
      });
      app.on("upgrade", (_request, socket) => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Protocol: chat\r\n\r\n",
        );
        socket.end();
      });
      app.listen(Number(new URL(env.E2E_PROFILE_APP_URL).port), "127.0.0.1");
      await once(app, "listening");
    }
    const tlsIdentity = provisionE2ETlsIdentity(env, { repoRoot: root });
    const privateKey = readFileSync(tlsIdentity.keyDescriptor);
    closeSync(tlsIdentity.keyDescriptor);
    const secure = await startE2EWebServer({
      env,
      certificate: readFileSync(env.E2E_PROFILE_TLS_CERT_FILE),
      privateKey,
      assertOwnedListener: withApp
        ? undefined
        : () => ({ inodes: ["1"], ownerPids: [process.pid] }),
      stdout: () => {},
    });
    t.after(() => {
      for (const socket of secure.state.activeSockets) socket.destroy();
      secure.server.close();
      app?.close();
    });
    return { env };
  }

  async function proxyRequest(env, options) {
    const config = resolveLiveCredentialGateConfig(env);
    const channel = await openVerifiedProxyChannel(config);
    try {
      return await requestOnVerifiedProxyChannel(channel, config, options);
    } finally {
      channel.agent.destroy();
      channel.socket.destroy();
    }
  }

  const invalidMethod = await fixture("invalid-method");
  assert.equal(
    (
      await proxyRequest(invalidMethod.env, {
        headers: { host: new URL(invalidMethod.env.E2E_BASE_URL).host },
        method: "GET",
        path: E2E_CAPABILITY_ENDPOINT,
        timeoutMs: 1_000,
      })
    ).status,
    503,
  );

  const invalidCommitment = await fixture("invalid-commitment");
  assert.equal(
    (
      await proxyRequest(invalidCommitment.env, {
        body: Buffer.from(JSON.stringify({ method: "get", origin: "nope" })),
        headers: { host: new URL(invalidCommitment.env.E2E_BASE_URL).host },
        method: "POST",
        path: E2E_CAPABILITY_ENDPOINT,
        timeoutMs: 1_000,
      })
    ).status,
    503,
  );

  const invalidJson = await fixture("invalid-json");
  assert.equal(
    (
      await proxyRequest(invalidJson.env, {
        body: Buffer.from("{"),
        headers: { host: new URL(invalidJson.env.E2E_BASE_URL).host },
        method: "POST",
        path: E2E_CAPABILITY_ENDPOINT,
        timeoutMs: 1_000,
      })
    ).status,
    503,
  );

  const oversizedCommitment = await fixture("oversized-commitment");
  await assert.rejects(
    () =>
      proxyRequest(oversizedCommitment.env, {
        body: Buffer.alloc(17 * 1024, "x"),
        headers: { host: new URL(oversizedCommitment.env.E2E_BASE_URL).host },
        method: "POST",
        path: E2E_CAPABILITY_ENDPOINT,
        timeoutMs: 1_000,
      }),
    /socket hang up|closed before completion/,
  );

  const forged = await fixture("forged-capability");
  assert.equal(
    (
      await proxyRequest(forged.env, {
        body: Buffer.alloc(0),
        headers: {
          host: new URL(forged.env.E2E_BASE_URL).host,
          [E2E_GATE_CAPABILITY_HEADER]: "forged",
        },
        method: "GET",
        path: "/app",
        timeoutMs: 1_000,
      })
    ).status,
    503,
  );

  const wrongHost = await fixture("wrong-host");
  assert.equal(
    (
      await proxyRequest(wrongHost.env, {
        body: Buffer.alloc(0),
        headers: { host: "evil.example" },
        method: "GET",
        path: "/app",
        timeoutMs: 1_000,
      })
    ).status,
    503,
  );

  async function issueCapability(
    env,
    { method = "GET", path = "/app", body = Buffer.alloc(0) } = {},
  ) {
    const target = new URL(path, env.E2E_BASE_URL);
    const commitment = {
      bodyHash: createHash("sha256").update(body).digest("hex"),
      host: target.host,
      method,
      origin: target.origin,
      path: target.pathname,
      query: target.search,
    };
    const result = await proxyRequest(env, {
      body: Buffer.from(JSON.stringify(commitment)),
      headers: {
        "content-type": "application/json",
        host: target.host,
      },
      method: "POST",
      path: E2E_CAPABILITY_ENDPOINT,
      timeoutMs: 1_000,
    });
    assert.equal(result.status, 201);
    return JSON.parse(result.body.toString("utf8")).capability;
  }

  const slashTarget = await fixture("slash-target");
  const slashCapability = await issueCapability(slashTarget.env);
  assert.equal(
    (
      await proxyRequest(slashTarget.env, {
        body: Buffer.alloc(0),
        headers: {
          host: new URL(slashTarget.env.E2E_BASE_URL).host,
          [E2E_GATE_CAPABILITY_HEADER]: slashCapability,
        },
        method: "GET",
        path: "//evil.example/app",
        timeoutMs: 1_000,
      })
    ).status,
    503,
  );

  async function rawUpgrade(env, rawRequest) {
    const socket = createTlsConnection({
      ca: readFileSync(env.E2E_PROFILE_TLS_CA_CERT_FILE),
      host: "127.0.0.1",
      port: Number(new URL(env.E2E_BASE_URL).port),
      rejectUnauthorized: true,
      servername: env.E2E_PROFILE_HOSTNAME,
    });
    await once(socket, "secureConnect");
    const chunks = [];
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.write(rawRequest);
    await once(socket, "close");
    return Buffer.concat(chunks).toString("utf8");
  }

  const websocket = await fixture("websocket");
  const websocketHost = new URL(websocket.env.E2E_BASE_URL).host;
  const upgradeResponse = await rawUpgrade(
    websocket.env,
    [
      "GET /socket HTTP/1.1",
      `Host: ${websocketHost}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version: 13",
      "Sec-WebSocket-Protocol: chat",
      "Sec-WebSocket-Protocol: superchat",
      "",
      "",
    ].join("\r\n"),
  );
  assert.match(upgradeResponse, /101 Switching Protocols/);

  const noUpstream = await fixture("no-upstream", { withApp: false });
  const noUpstreamConfig = resolveLiveCredentialGateConfig(noUpstream.env);
  const noUpstreamChannel = await openVerifiedProxyChannel(noUpstreamConfig);
  try {
    const body = Buffer.alloc(0);
    const target = new URL("/app", noUpstream.env.E2E_BASE_URL);
    const commitment = {
      bodyHash: createHash("sha256").update(body).digest("hex"),
      host: target.host,
      method: "GET",
      origin: target.origin,
      path: target.pathname,
      query: target.search,
    };
    const capabilityResponse = await requestOnVerifiedProxyChannel(
      noUpstreamChannel,
      noUpstreamConfig,
      {
        body: Buffer.from(JSON.stringify(commitment)),
        headers: { host: target.host },
        method: "POST",
        path: E2E_CAPABILITY_ENDPOINT,
        timeoutMs: 1_000,
      },
    );
    const upstreamCapability = JSON.parse(
      capabilityResponse.body.toString("utf8"),
    ).capability;
    assert.equal(
      (
        await requestOnVerifiedProxyChannel(
          noUpstreamChannel,
          noUpstreamConfig,
          {
            body,
            headers: {
              host: target.host,
              [E2E_GATE_CAPABILITY_HEADER]: upstreamCapability,
            },
            method: "GET",
            path: "/app",
            timeoutMs: 1_000,
          },
        )
      ).status,
      503,
    );
  } finally {
    noUpstreamChannel.agent.destroy();
    noUpstreamChannel.socket.destroy();
  }
});
