import {
  createHash,
  createHmac,
  createPrivateKey,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { request as createHttpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect as createNetConnection } from "node:net";
import process from "node:process";

import {
  assertE2EConnectionOwnedByProcess,
  assertE2EListenerOwnedByProcess,
  waitForOwnedE2EConnection,
  waitForOwnedE2EListener,
} from "./e2e-listener-ownership.mjs";
import {
  E2E_CAPABILITY_ENDPOINT,
  E2E_GATE_CAPABILITY_HEADER,
  E2E_IDENTITY_ENDPOINT,
  assertE2ECompromiseMarkerHealthy,
  initializeE2ECompromiseLatch,
  readSecurePidFile,
  resolveLiveCredentialGateConfig,
  signE2ERecord,
} from "./e2e-credential-gate.mjs";

export {
  assertE2EConnectionOwnedByProcess,
  E2E_IDENTITY_ENDPOINT,
  assertE2EListenerOwnedByProcess,
  waitForOwnedE2EConnection,
  waitForOwnedE2EListener,
};
export { linuxProcessTreePids } from "./e2e-listener-ownership.mjs";
export { resolveE2EWebServerRuntime } from "./e2e-profile-runtime.mjs";

const MAX_AUTH_RESPONSE_BYTES = 64 * 1024;
const MAX_PRECOMPILE_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PROXY_REQUEST_BYTES = 64 * 1024 * 1024;

export function resolveE2EWebServerConfig(env = process.env) {
  return resolveLiveCredentialGateConfig(env);
}

export function resolveE2EWebServerCredentials(env = process.env) {
  return {
    email:
      env.E2E_PROFILE_PRECOMPILE_EMAIL ??
      env.E2E_USER_EMAIL ??
      "e2e-owner@textiq.test",
    password:
      env.E2E_PROFILE_PRECOMPILE_PASSWORD ??
      env.E2E_USER_PASSWORD ??
      "e2e-owner-pw-2026",
  };
}

export async function startE2EWebServer({
  env = process.env,
  certificate,
  privateKey,
  createSecureServer = createHttpsServer,
  assertOwnedListener = assertE2EListenerOwnedByProcess,
  waitForOwnedConnection = waitForOwnedE2EConnection,
  waitForOwnedListener = waitForOwnedE2EListener,
  beforeUpstreamConnect,
  stdout = console.log,
} = {}) {
  if (!certificate || !privateKey) {
    throw new Error(
      "The authenticated E2E transport requires an in-memory TLS certificate and key.",
    );
  }
  const signingKey = createPrivateKey(privateKey);
  const config = resolveE2EWebServerConfig(env);
  const appPid = readSecurePidFile(config.runtime.pidFile);
  const appListener = assertOwnedListener({
    host: config.bindHost,
    pid: appPid,
    port: Number(config.appOrigin.port),
  });
  const compromiseLatch = initializeE2ECompromiseLatch(config, appPid, {
    privateKey: signingKey,
  });
  const state = {
    appListener,
    appPid,
    activeSockets: new Set(),
    assertOwnedListener,
    capabilityKey: randomBytes(32),
    beforeUpstreamConnect,
    channelIds: new WeakMap(),
    compromiseLatch,
    config,
    consumedNonces: new Set(),
    diagnostics: env.E2E_PROFILE_GATE_DIAGNOSTICS === "1",
    privateKey: signingKey,
    requestQueues: new WeakMap(),
    waitForOwnedConnection,
  };
  const server = await listenForReadiness(
    config.origin,
    createSecureServer,
    config.bindHost,
    config.appOrigin,
    state,
    { certificate, privateKey },
  );
  compromiseLatch.onLatch(() => {
    setImmediate(() => {
      for (const socket of state.activeSockets) socket.destroy();
      state.activeSockets.clear();
    });
  });
  if (Buffer.isBuffer(privateKey)) privateKey.fill(0);
  const proxyListener = await waitForOwnedListener({
    host: config.bindHost,
    pid: process.pid,
    port: Number(config.origin.port),
    timeoutMs: config.proofTimeoutMs,
  });
  const createdAt = new Date().toISOString();
  const identity = signE2ERecord(
    {
      schemaVersion: 4,
      runId: config.runtime.runId,
      identityPath: config.runtime.identityFile,
      createdAt,
      appPid,
      proxyPid: process.pid,
      spkiPin: config.spkiPin,
      app: listenerIdentity(config.appOrigin, appListener),
      proxy: listenerIdentity(config.origin, proxyListener),
    },
    signingKey,
  );
  const marker = signE2ERecord(
    {
      schemaVersion: 4,
      runId: config.runtime.runId,
      identityPath: config.runtime.identityFile,
      identityCreatedAt: createdAt,
      verifiedAt: createdAt,
      appPid,
      proxyPid: process.pid,
      spkiPin: config.spkiPin,
      app: identity.app,
      proxy: identity.proxy,
    },
    signingKey,
  );
  const { atomicWriteSecureJson } = await import("./e2e-credential-gate.mjs");
  atomicWriteSecureJson(config.runtime.identityFile, identity);
  atomicWriteSecureJson(config.runtime.credentialGateFile, marker);
  stdout(`[e2e-transport] HTTPS/WSS ready on ${config.origin.origin}`);
  return { readinessServer: server, server, state };
}

export function listenForReadiness(
  externalOrigin,
  createSecureServer,
  bindHost,
  appOrigin,
  state,
  { certificate, privateKey } = {},
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createSecureServer(
      { cert: certificate, key: privateKey, minVersion: "TLSv1.2" },
      (request, response) => {
        const previous = state.requestQueues.get(request.socket);
        const queued = Promise.resolve(previous)
          .catch(() => {})
          .then(() =>
            handleSecureRequest({
              appOrigin,
              request,
              response,
              state,
            }),
          );
        state.requestQueues.set(request.socket, queued);
        void queued.finally(() => {
          if (state.requestQueues.get(request.socket) === queued) {
            state.requestQueues.delete(request.socket);
          }
        });
      },
    );
    server.on("secureConnection", (socket) => {
      state.channelIds.set(socket, randomBytes(32).toString("hex"));
    });
    server.on("connection", (socket) => {
      state.activeSockets.add(socket);
      socket.once("close", () => state.activeSockets.delete(socket));
    });
    server.on("upgrade", (request, socket, head) => {
      void forwardWebSocketUpgrade({
        appOrigin,
        head,
        request,
        socket,
        state,
      });
    });
    server.once("error", rejectPromise);
    server.listen(Number(externalOrigin.port), bindHost, () =>
      resolvePromise(server),
    );
  });
}

async function handleSecureRequest({ appOrigin, request, response, state }) {
  try {
    state.compromiseLatch.assertHealthy();
    const target = exactExternalTarget(request, state.config.origin);
    if (target.pathname === E2E_IDENTITY_ENDPOINT) {
      if (request.method !== "GET") throw new Error("Invalid identity method.");
      sendJson(response, 200, {
        channel: "tls",
        runId: state.config.runtime.runId,
        spkiPin: state.config.spkiPin,
      });
      return;
    }
    if (target.pathname === E2E_CAPABILITY_ENDPOINT) {
      await issueCapability({ request, response, state });
      return;
    }
    const body = await readRequestBody(request);
    const capability = request.headers[E2E_GATE_CAPABILITY_HEADER];
    if (capability !== undefined) {
      verifyAndConsumeCapability({
        body,
        capability,
        request,
        state,
        target,
      });
    }
    const upstreamSocket = await connectVerifiedUpstream(state);
    await forwardHttpRequest({
      appOrigin,
      body,
      request,
      response,
      state,
      target,
      upstreamSocket,
    });
  } catch (error) {
    if (state.diagnostics) {
      console.error(
        `[e2e-transport] upstream verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.headersSent) {
      response.writeHead(503, {
        "cache-control": "no-store",
        "content-length": "0",
      });
    }
    response.end();
    if (
      error instanceof Error &&
      /listener|connection ownership|runner identity|capability|origin|host/i.test(
        error.message,
      )
    ) {
      state.compromiseLatch.latch(classifyProxyFailure(error));
    }
  }
}

async function issueCapability({ request, response, state }) {
  if (request.method !== "POST") {
    throw new Error("Invalid capability method.");
  }
  const body = await readRequestBody(request, 16 * 1024);
  let commitment;
  try {
    commitment = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("Invalid capability commitment.");
  }
  validateCommitment(commitment, state.config.origin);
  const now = Date.now();
  const payload = {
    schemaVersion: 1,
    runId: state.config.runtime.runId,
    method: commitment.method,
    origin: commitment.origin,
    host: commitment.host,
    path: commitment.path,
    query: commitment.query,
    bodyHash: commitment.bodyHash,
    channelId: channelIdForRequest(request, state),
    issuedAt: now,
    expiresAt: now + 5_000,
    nonce: randomBytes(32).toString("hex"),
  };
  const encoded = Buffer.from(canonicalJson(payload)).toString("base64url");
  const signature = createHmac("sha256", state.capabilityKey)
    .update(encoded)
    .digest("base64url");
  sendJson(response, 201, { capability: `${encoded}.${signature}` });
}

function verifyAndConsumeCapability({
  body,
  capability,
  request,
  state,
  target,
}) {
  if (typeof capability !== "string") {
    throw new Error("Invalid request capability.");
  }
  const parts = capability.split(".");
  if (parts.length !== 2) throw new Error("Invalid request capability.");
  const [encoded, signature] = parts;
  const expected = createHmac("sha256", state.capabilityKey)
    .update(encoded)
    .digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    throw new Error("Invalid request capability.");
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Forged request capability.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid request capability.");
  }
  const now = Date.now();
  const expectedBodyHash = createHash("sha256").update(body).digest("hex");
  if (
    payload.schemaVersion !== 1 ||
    payload.runId !== state.config.runtime.runId ||
    payload.method !== request.method ||
    payload.origin !== target.origin ||
    payload.host !== request.headers.host ||
    payload.path !== target.pathname ||
    payload.query !== target.search ||
    payload.bodyHash !== expectedBodyHash ||
    payload.channelId !== channelIdForRequest(request, state) ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.issuedAt > now + 1_000 ||
    payload.expiresAt < now ||
    payload.expiresAt - payload.issuedAt > 5_000 ||
    typeof payload.nonce !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.nonce)
  ) {
    throw new Error("Mutated or expired request capability.");
  }
  if (state.consumedNonces.has(payload.nonce)) {
    throw new Error("Replayed request capability.");
  }
  state.consumedNonces.add(payload.nonce);
}

async function connectVerifiedUpstream(state) {
  state.compromiseLatch.assertHealthy();
  const before = state.assertOwnedListener({
    host: state.config.bindHost,
    pid: state.appPid,
    port: Number(state.config.appOrigin.port),
  });
  assertSameInodes(state.appListener.inodes, before.inodes);
  await state.beforeUpstreamConnect?.();
  const socket = createNetConnection({
    host: state.config.bindHost,
    port: Number(state.config.appOrigin.port),
  });
  state.activeSockets.add(socket);
  socket.once("close", () => state.activeSockets.delete(socket));
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      socket.once("connect", resolvePromise);
      socket.once("error", rejectPromise);
    });
    socket.pause();
    assertExactUpstreamEndpoint(socket, state.config);
    const after = state.assertOwnedListener({
      host: state.config.bindHost,
      pid: state.appPid,
      port: Number(state.config.appOrigin.port),
    });
    assertSameInodes(before.inodes, after.inodes);
    await state.waitForOwnedConnection({
      clientPort: socket.localPort,
      host: state.config.bindHost,
      pid: state.appPid,
      port: Number(state.config.appOrigin.port),
      timeoutMs: state.config.proofTimeoutMs,
    });
    assertE2ECompromiseMarkerHealthy(state.config, state.appPid);
    return socket;
  } catch (error) {
    socket.destroy();
    state.compromiseLatch.latch("E2E_APP_CONNECTION_MISMATCH");
    throw error;
  }
}

function forwardHttpRequest({
  appOrigin,
  body,
  request,
  response,
  state,
  target,
  upstreamSocket,
}) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = () => {
      upstreamSocket.destroy();
      if (settled) return;
      settled = true;
      resolvePromise();
    };
    const upstream = createHttpRequest(
      {
        agent: false,
        createConnection: () => upstreamSocket,
        headers: proxyHeaders(request.headers, state.config.origin),
        host: state.config.bindHost,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        port: Number(appOrigin.port),
      },
      (upstreamResponse) => {
        let headers;
        try {
          headers = proxyResponseHeaders({
            appOrigin,
            externalOrigin: state.config.origin,
            headers: upstreamResponse.headers,
            rawHeaders: upstreamResponse.rawHeaders,
          });
        } catch (_error) {
          state.compromiseLatch.latch("E2E_UNSAFE_UPSTREAM_REDIRECT");
          upstreamResponse.resume();
          if (!response.headersSent) {
            response.writeHead(503, {
              "cache-control": "no-store",
              "content-length": "0",
            });
          }
          response.end();
          finish();
          return;
        }
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          headers,
        );
        upstreamResponse.pipe(response);
        upstreamResponse.once("end", finish);
        upstreamResponse.once("aborted", finish);
        upstreamResponse.once("error", finish);
      },
    );
    upstream.once("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
      finish();
    });
    response.once("close", () => {
      upstream.destroy();
      finish();
    });
    upstream.end(body);
  });
}

async function forwardWebSocketUpgrade({ head, request, socket, state }) {
  try {
    state.compromiseLatch.assertHealthy();
    const target = exactExternalTarget(request, state.config.origin);
    const upstream = await connectVerifiedUpstream(state);
    state.compromiseLatch.assertHealthy();
    await writeSocketChunk(
      upstream,
      `${request.method ?? "GET"} ${target.pathname}${target.search} HTTP/${request.httpVersion}\r\n`,
    );
    for (const [name, value] of Object.entries(
      proxyUpgradeHeaders(request.headers, state.config.origin),
    )) {
      if (Array.isArray(value)) {
        for (const item of value) {
          await writeSocketChunk(upstream, `${name}: ${item}\r\n`);
        }
      } else if (value !== undefined) {
        await writeSocketChunk(upstream, `${name}: ${value}\r\n`);
      }
    }
    await writeSocketChunk(upstream, "\r\n");
    if (head.length > 0) await writeSocketChunk(upstream, head);
    socket.pipe(upstream);
    upstream.pipe(socket);
    upstream.once("error", () => socket.destroy());
    socket.once("error", () => upstream.destroy());
    upstream.once("end", () => {
      upstream.destroy();
      socket.end();
    });
    socket.once("end", () => {
      socket.destroy();
      upstream.end();
    });
    upstream.once("close", () => socket.destroy());
    socket.once("close", () => upstream.destroy());
  } catch (error) {
    if (
      error instanceof Error &&
      /listener|connection ownership|endpoint|origin|host/i.test(error.message)
    ) {
      state.compromiseLatch.latch(classifyProxyFailure(error));
    }
    socket.destroy();
  }
}

function exactExternalTarget(request, origin) {
  if (
    typeof request.url !== "string" ||
    !request.url.startsWith("/") ||
    request.url.startsWith("//")
  ) {
    throw new Error(
      "The authenticated proxy rejected a non-origin-form target.",
    );
  }
  if (request.headers.host !== origin.host) {
    throw new Error("The authenticated proxy rejected the request host.");
  }
  const target = new URL(request.url, origin);
  if (target.origin !== origin.origin) {
    throw new Error("The authenticated proxy rejected the request origin.");
  }
  return target;
}

function validateCommitment(value, origin) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.method !== "string" ||
    value.method !== value.method.toUpperCase() ||
    value.origin !== origin.origin ||
    value.host !== origin.host ||
    typeof value.path !== "string" ||
    !value.path.startsWith("/") ||
    typeof value.query !== "string" ||
    (value.query !== "" && !value.query.startsWith("?")) ||
    typeof value.bodyHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.bodyHash)
  ) {
    throw new Error("Invalid request capability commitment.");
  }
}

function channelIdForRequest(request, state) {
  const channelId = state.channelIds.get(request.socket);
  if (!channelId) throw new Error("Unknown authenticated TLS channel.");
  return channelId;
}

function readRequestBody(request, maxBytes = MAX_PROXY_REQUEST_BYTES) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        rejectPromise(
          new Error("The authenticated proxy request was too large."),
        );
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.once("end", () => resolvePromise(Buffer.concat(chunks)));
    request.once("error", rejectPromise);
  });
}

function proxyHeaders(headers, externalOrigin) {
  const forwarded = {
    ...headers,
    host: externalOrigin.host,
    "x-forwarded-host": externalOrigin.host,
    "x-forwarded-proto": "https",
  };
  delete forwarded[E2E_GATE_CAPABILITY_HEADER];
  delete forwarded.connection;
  return forwarded;
}

export function proxyResponseHeaders({
  appOrigin,
  externalOrigin,
  headers,
  rawHeaders = [],
}) {
  const forwarded = { ...headers };
  delete forwarded.connection;
  delete forwarded["keep-alive"];
  const locations = headerValues(rawHeaders, headers, "location");
  delete forwarded.location;
  if (locations.length > 1) {
    throw new Error(
      "The authenticated proxy rejected multiple upstream Location headers.",
    );
  }
  if (locations.length === 1) {
    forwarded.location = rewriteE2ERedirectLocation(
      locations[0],
      appOrigin,
      externalOrigin,
    );
  }
  return forwarded;
}

export function rewriteE2ERedirectLocation(
  location,
  appOrigin,
  externalOrigin,
) {
  if (
    typeof location !== "string" ||
    location.length === 0 ||
    location !== location.trim() ||
    /[\u0000-\u001f\u007f\\]/.test(location) ||
    /%5c/i.test(location) ||
    location.startsWith("//")
  ) {
    throw new Error(
      "The authenticated proxy rejected an unsafe upstream Location.",
    );
  }

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(location);
  const absolute = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)/.exec(location);
  if (scheme && !absolute) {
    throw new Error(
      "The authenticated proxy rejected an anomalous upstream Location scheme.",
    );
  }
  if (absolute) {
    const [, protocol, authority] = absolute;
    const internalAbsolute =
      protocol === "http" && authority === appOrigin.host;
    const publicAbsolute =
      protocol === "https" && authority === externalOrigin.host;
    if ((!internalAbsolute && !publicAbsolute) || /[%@\\]/.test(authority)) {
      throw new Error(
        "The authenticated proxy rejected an external upstream Location.",
      );
    }
  }

  let target;
  try {
    target = new URL(location, appOrigin);
  } catch (error) {
    throw new Error(
      "The authenticated proxy rejected an invalid upstream Location.",
      { cause: error },
    );
  }
  if (
    ![appOrigin.origin, externalOrigin.origin].includes(target.origin) ||
    target.username ||
    target.password
  ) {
    throw new Error(
      "The authenticated proxy rejected an external upstream Location.",
    );
  }
  return new URL(
    `${target.pathname}${target.search}${target.hash}`,
    externalOrigin,
  ).toString();
}

function proxyUpgradeHeaders(headers, externalOrigin) {
  return {
    ...proxyHeaders(headers, externalOrigin),
    connection: headers.connection ?? "Upgrade",
  };
}

function listenerIdentity(url, verified) {
  return {
    host: "127.0.0.1",
    port: Number(url.port),
    inodes: [...new Set(verified.inodes)].sort(),
    ownerPids: [...new Set(verified.ownerPids)].sort(
      (left, right) => left - right,
    ),
  };
}

function assertSameInodes(expected, actual) {
  if (
    JSON.stringify([...expected].sort()) !== JSON.stringify([...actual].sort())
  ) {
    throw new Error("The authenticated app listener changed.");
  }
}

function assertExactUpstreamEndpoint(socket, config) {
  if (
    socket.remoteAddress !== config.bindHost ||
    socket.remotePort !== Number(config.appOrigin.port) ||
    socket.localAddress !== config.bindHost ||
    !Number.isSafeInteger(socket.localPort)
  ) {
    throw new Error(
      "The accepted E2E upstream connection endpoint did not match the pinned app listener.",
    );
  }
}

function headerValues(rawHeaders, headers, expectedName) {
  const values = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === expectedName) {
      values.push(String(rawHeaders[index + 1]));
    }
  }
  if (values.length > 0) return values;
  const fallback = headers[expectedName];
  if (Array.isArray(fallback)) return fallback.map(String);
  return fallback === undefined ? [] : [String(fallback)];
}

function writeSocketChunk(socket, chunk) {
  return new Promise((resolvePromise, rejectPromise) => {
    const onError = (error) => {
      socket.removeListener("drain", onDrain);
      rejectPromise(error);
    };
    const onDrain = () => {
      socket.removeListener("error", onError);
      resolvePromise();
    };
    socket.once("error", onError);
    if (socket.write(chunk)) {
      socket.removeListener("error", onError);
      resolvePromise();
      return;
    }
    socket.once("drain", onDrain);
  });
}

function classifyProxyFailure(error) {
  if (/capability/i.test(error.message)) return "E2E_CAPABILITY_MISMATCH";
  if (/location|redirect/i.test(error.message))
    return "E2E_UNSAFE_UPSTREAM_REDIRECT";
  if (/origin|host/i.test(error.message)) return "E2E_ORIGIN_MISMATCH";
  return "E2E_PROXY_VERIFICATION_FAILED";
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": String(body.length),
    "content-type": "application/json",
  });
  response.end(body);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function authenticateE2EProfile({
  origin,
  email,
  password,
  timeoutMs = 120_000,
  fetchImpl = globalThis.fetch,
  assertServerIdentity = async () => {},
}) {
  const cookies = new Map();
  const csrfTarget = new URL("/api/auth/csrf", origin);
  await assertServerIdentity();
  const csrf = await requestAndRead({
    fetchImpl,
    init: { method: "GET", redirect: "manual" },
    label: "E2E readiness authentication CSRF request",
    maxBytes: MAX_AUTH_RESPONSE_BYTES,
    target: csrfTarget,
    timeoutMs,
  });
  if (csrf.response.status !== 200) {
    throw new Error(
      `E2E readiness authentication CSRF request returned ${csrf.response.status}.`,
    );
  }
  const payload = JSON.parse(csrf.body);
  if (typeof payload.csrfToken !== "string" || payload.csrfToken.length === 0) {
    throw new Error(
      "E2E readiness authentication did not return a CSRF token.",
    );
  }
  updateCookies(cookies, csrf.response.headers);
  const callbackUrl = new URL("/app", origin);
  const callbackTarget = new URL("/api/auth/callback/credentials", origin);
  await assertServerIdentity();
  const callback = await requestAndRead({
    fetchImpl,
    init: {
      body: new URLSearchParams({
        callbackUrl: callbackUrl.toString(),
        csrfToken: payload.csrfToken,
        email,
        password,
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader(cookies),
      },
      method: "POST",
      redirect: "manual",
    },
    label: "E2E readiness authentication callback",
    maxBytes: MAX_AUTH_RESPONSE_BYTES,
    target: callbackTarget,
    timeoutMs,
  });
  if (![302, 303].includes(callback.response.status)) {
    throw new Error(
      `E2E readiness authentication returned ${callback.response.status}.`,
    );
  }
  updateCookies(cookies, callback.response.headers);
  if (
    ![...cookies.keys()].some((name) => name.endsWith("authjs.session-token"))
  ) {
    throw new Error(
      "E2E readiness authentication did not set a session cookie.",
    );
  }
  return cookieHeader(cookies);
}

export async function precompileE2EProfileRoutes({
  origin,
  routes,
  cookie,
  timeoutMs = 120_000,
  fetchImpl = globalThis.fetch,
  stdout = console.log,
  assertServerIdentity = async () => {},
}) {
  for (const route of routes) {
    await assertServerIdentity();
    const target = new URL(route.path, origin);
    const result = await requestAndRead({
      fetchImpl,
      init: routeRequestInit(route, cookie),
      label: `E2E readiness route ${route.path}`,
      maxBytes: MAX_PRECOMPILE_RESPONSE_BYTES,
      target,
      timeoutMs,
    });
    stdout(
      `[e2e-readiness] ${route.method} ${route.path} -> ${result.response.status}`,
    );
    if (result.response.status !== route.status) {
      throw new Error(
        `E2E readiness route ${route.path} returned ${result.response.status}; expected ${route.status}.`,
      );
    }
  }
}

async function requestAndRead({
  fetchImpl,
  init,
  label,
  maxBytes,
  target,
  timeoutMs,
}) {
  const response = await fetchImpl(target, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (Buffer.byteLength(body) > maxBytes) {
    throw new Error(`${label} exceeded its response limit.`);
  }
  return { body, response };
}

function routeRequestInit(route, cookie) {
  return {
    body: route.method === "POST" ? Buffer.alloc(0) : undefined,
    headers: cookie ? { cookie } : undefined,
    method: route.method,
    redirect: "manual",
  };
}

function updateCookies(cookies, headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const first = value.split(";", 1)[0];
    const separator = first.indexOf("=");
    if (separator < 1) continue;
    const name = first.slice(0, separator);
    const cookieValue = first.slice(separator + 1);
    if (cookieValue) cookies.set(name, cookieValue);
    else cookies.delete(name);
  }
}

function cookieHeader(cookies) {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}
