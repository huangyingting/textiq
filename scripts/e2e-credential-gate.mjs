import {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createHash,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  X509Certificate,
} from "node:crypto";
import { isAbsolute } from "node:path";
import { Agent, request as createHttpsRequest } from "node:https";
import { connect as createTlsConnection, checkServerIdentity } from "node:tls";
import process from "node:process";

import { assertE2EListenerOwnedByProcess } from "./e2e-listener-ownership.mjs";
import { resolveE2EWebServerRuntime } from "./e2e-profile-runtime.mjs";

export const E2E_IDENTITY_ENDPOINT = "/__textiq_e2e_identity";
export const E2E_CAPABILITY_ENDPOINT = "/__textiq_e2e_capability";
export const E2E_GATE_CAPABILITY_HEADER = "x-textiq-e2e-capability";

const MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_PROOF_TIMEOUT_MS = 10_000;
const compromisedRuns = new Set();

export function resolveLiveCredentialGateConfig(env = process.env) {
  const runtime = resolveE2EWebServerRuntime(env);
  const origin = parseExactProfileUrl(
    env.E2E_BASE_URL ?? env.BASE_URL ?? "",
    "https:",
    "/",
    "E2E_BASE_URL",
    runtime.hostname,
  );
  const readinessUrl = parseExactProfileUrl(
    env.E2E_PROFILE_READINESS_URL ?? "",
    "http:",
    "/ready",
    "E2E_PROFILE_READINESS_URL",
    "127.0.0.1",
  );
  const appOrigin = parseExactProfileUrl(
    env.E2E_PROFILE_APP_URL ?? "",
    "http:",
    "/",
    "E2E_PROFILE_APP_URL",
    "127.0.0.1",
  );
  return {
    appOrigin,
    bindHost: "127.0.0.1",
    origin,
    proofTimeoutMs: positiveInteger(
      env.E2E_PROFILE_IDENTITY_PROOF_TIMEOUT_MS,
      DEFAULT_PROOF_TIMEOUT_MS,
      "E2E_PROFILE_IDENTITY_PROOF_TIMEOUT_MS",
    ),
    readinessUrl,
    runtime,
    spkiPin: validateSpkiPin(env.E2E_PROFILE_TLS_SPKI_PIN),
  };
}

export async function assertLiveE2ECredentialGate({
  env = process.env,
  now = () => Date.now(),
  assertOwnedListener = assertE2EListenerOwnedByProcess,
  fileDependencies,
  cleanupOnFailure = false,
  reportEvent = reportCredentialGateEvent,
} = {}) {
  let config;
  let rootPid;
  try {
    config = resolveLiveCredentialGateConfig(env);
    rootPid = readSecurePidFile(config.runtime.pidFile, fileDependencies);
    assertE2ECompromiseMarkerHealthy(config, rootPid, { fileDependencies });
    const identity = readSecureJsonFile(
      config.runtime.identityFile,
      "listener identity",
      fileDependencies,
    );
    validateIdentityRecord(identity, {
      appPort: Number(config.appOrigin.port),
      identityFile: config.runtime.identityFile,
      now: now(),
      proxyPort: Number(config.origin.port),
      rootPid,
      runId: config.runtime.runId,
      certFile: config.runtime.tlsCertFile,
      spkiPin: config.spkiPin,
      fileDependencies,
    });
    const marker = readSecureJsonFile(
      config.runtime.credentialGateFile,
      "credential gate",
      fileDependencies,
    );
    validateGateMarker(marker, {
      identity,
      identityFile: config.runtime.identityFile,
      now: now(),
      rootPid,
      runId: config.runtime.runId,
      certFile: config.runtime.tlsCertFile,
      spkiPin: config.spkiPin,
      fileDependencies,
    });
    const app = assertOwnedListener({
      host: config.bindHost,
      pid: rootPid,
      port: Number(config.appOrigin.port),
    });
    assertSameInodes(identity.app.inodes, app.inodes, "app");
    const channel = await openVerifiedProxyChannel(config);
    try {
      const proof = await requestOnVerifiedProxyChannel(channel, config, {
        headers: { host: config.origin.host },
        method: "GET",
        path: E2E_IDENTITY_ENDPOINT,
        timeoutMs: config.proofTimeoutMs,
      });
      if (proof.status !== 200) {
        throw new Error(
          "The authenticated E2E transport rejected its identity probe.",
        );
      }
      const live = JSON.parse(proof.body.toString("utf8"));
      if (
        live.runId !== config.runtime.runId ||
        live.spkiPin !== config.spkiPin ||
        live.channel !== "tls"
      ) {
        throw new Error(
          "The authenticated E2E transport returned the wrong run identity.",
        );
      }
    } finally {
      channel.agent.destroy();
      channel.socket.destroy();
    }
    assertE2ECompromiseMarkerHealthy(config, rootPid, { fileDependencies });
    return { config, identity, marker, verified: { app } };
  } catch (error) {
    if (config) {
      latchE2ECompromise(config, rootPid, credentialGateFailureCode(error), {
        now,
      });
      reportEvent(env, {
        code: credentialGateFailureCode(error),
        reason: error instanceof Error ? error.message : String(error),
        runId: config.runtime.runId,
      });
      if (cleanupOnFailure) {
        safeUnlink(config.runtime.credentialGateFile);
        safeUnlink(config.runtime.identityFile);
      }
    }
    throw error;
  }
}

export async function sendE2ERequestOverVerifiedProxy({
  body,
  env = process.env,
  headers = {},
  method = "GET",
  timeoutMs = 120_000,
  url,
}) {
  const config = resolveLiveCredentialGateConfig(env);
  const rootPid = readSecurePidFile(config.runtime.pidFile);
  assertE2ECompromiseMarkerHealthy(config, rootPid);
  const target = new URL(url, config.origin);
  if (
    target.origin !== config.origin.origin ||
    target.username ||
    target.password
  ) {
    throw new Error(
      "Verified deterministic E2E requests require the authenticated HTTPS origin.",
    );
  }
  const requestBody = body ? Buffer.from(body) : Buffer.alloc(0);
  const normalizedMethod = String(method).toUpperCase();
  let channel;
  try {
    channel = await openVerifiedProxyChannel(config);
    const commitment = {
      bodyHash: createHash("sha256").update(requestBody).digest("hex"),
      host: target.host,
      method: normalizedMethod,
      origin: target.origin,
      path: target.pathname,
      query: target.search,
    };
    const capabilityResult = await requestOnVerifiedProxyChannel(
      channel,
      config,
      {
        body: Buffer.from(JSON.stringify(commitment)),
        headers: {
          "content-type": "application/json",
          "content-length": String(
            Buffer.byteLength(JSON.stringify(commitment)),
          ),
          host: config.origin.host,
        },
        method: "POST",
        path: E2E_CAPABILITY_ENDPOINT,
        timeoutMs: config.proofTimeoutMs,
      },
    );
    if (capabilityResult.status !== 201) {
      throw new Error(
        "The authenticated E2E transport refused the request capability.",
      );
    }
    const capability = JSON.parse(
      capabilityResult.body.toString("utf8"),
    ).capability;
    if (typeof capability !== "string" || capability.length > 4096) {
      throw new Error(
        "The authenticated E2E transport returned an invalid request capability.",
      );
    }
    const result = await requestOnVerifiedProxyChannel(channel, config, {
      body: requestBody,
      headers: {
        ...headers,
        [E2E_GATE_CAPABILITY_HEADER]: capability,
        host: target.host,
      },
      method: normalizedMethod,
      path: `${target.pathname}${target.search}`,
      timeoutMs,
    });
    return { ...result, url: target.toString() };
  } catch (error) {
    latchE2ECompromise(config, rootPid, "E2E_AUTHENTICATED_CHANNEL_FAILED");
    throw error;
  } finally {
    channel?.agent.destroy();
    channel?.socket.destroy();
  }
}

export async function openVerifiedProxyChannel(config) {
  const caCertificate = readSecureFile(
    config.runtime.tlsCaCertFile,
    "TLS CA certificate",
  );
  const socket = createTlsConnection({
    ca: caCertificate,
    host: config.bindHost,
    port: Number(config.origin.port),
    rejectUnauthorized: true,
    servername: config.runtime.hostname,
    checkServerIdentity: (hostname, peer) => {
      const error = checkServerIdentity(hostname, peer);
      if (error) return error;
      try {
        const pin = spkiPinFromRawCertificate(peer.raw);
        if (pin !== config.spkiPin) {
          return new Error("The deterministic E2E TLS SPKI pin did not match.");
        }
      } catch (pinError) {
        return pinError;
      }
      return undefined;
    },
  });
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      socket.once("secureConnect", resolvePromise);
      socket.once("error", rejectPromise);
    });
    if (!socket.authorized) {
      throw new Error(
        `The deterministic E2E TLS channel was not authorized: ${socket.authorizationError}`,
      );
    }
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    agent.createConnection = () => socket;
    return { agent, socket };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export function requestOnVerifiedProxyChannel(
  channel,
  config,
  { body, headers, method, path, timeoutMs },
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = createHttpsRequest(
      {
        agent: channel.agent,
        headers: { ...headers, connection: "keep-alive" },
        host: config.bindHost,
        method,
        path,
        port: Number(config.origin.port),
        servername: config.runtime.hostname,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.once("end", () => {
          resolvePromise({
            body: Buffer.concat(chunks),
            headers: response.headers,
            status: response.statusCode ?? 500,
            statusText: response.statusMessage ?? "",
          });
        });
        response.once("aborted", () =>
          rejectPromise(
            new Error("The authenticated E2E TLS response was aborted."),
          ),
        );
        response.once("close", () => {
          if (!response.complete) {
            rejectPromise(
              new Error("The authenticated E2E TLS response closed early."),
            );
          }
        });
        response.once("error", rejectPromise);
      },
    );
    request.once("close", () =>
      rejectPromise(
        new Error(
          "The authenticated E2E TLS request closed before completion.",
        ),
      ),
    );
    request.once("socket", (requestSocket) => {
      if (requestSocket !== channel.socket) {
        request.destroy(
          new Error("The authenticated E2E TLS channel socket changed."),
        );
      }
    });
    request.once("error", rejectPromise);
    request.end(body);
  });
}

export function signE2ERecord(record, privateKey) {
  const unsigned = { ...record };
  delete unsigned.signature;
  return {
    ...unsigned,
    signature: sign(
      "sha256",
      Buffer.from(canonicalJson(unsigned)),
      privateKey,
    ).toString("base64url"),
  };
}

export function validateE2ERecordIntegrity(record, certificate, label) {
  if (
    !record ||
    typeof record !== "object" ||
    typeof record.signature !== "string"
  ) {
    throw new Error(
      `The deterministic E2E ${label} signature is invalid; refusing credentials.`,
    );
  }
  const unsigned = { ...record };
  delete unsigned.signature;
  const valid = verify(
    "sha256",
    Buffer.from(canonicalJson(unsigned)),
    new X509Certificate(certificate).publicKey,
    Buffer.from(record.signature, "base64url"),
  );
  if (!valid) {
    throw new Error(
      `The deterministic E2E ${label} was tampered with; refusing credentials.`,
    );
  }
}

export function validateIdentityRecord(
  identity,
  {
    appPort,
    identityFile,
    now,
    proxyPort,
    rootPid,
    runId,
    certFile,
    spkiPin,
    fileDependencies,
  },
) {
  const certificate = readSecureFile(
    certFile,
    "TLS certificate",
    fileDependencies,
  );
  validateCertificatePin(certificate, spkiPin);
  validateE2ERecordIntegrity(identity, certificate, "listener identity");
  const createdAt = Date.parse(identity?.createdAt);
  if (
    identity?.schemaVersion !== 4 ||
    identity.runId !== runId ||
    identity.identityPath !== identityFile ||
    identity.appPid !== rootPid ||
    identity.spkiPin !== spkiPin ||
    !Number.isFinite(createdAt) ||
    createdAt > now + 5_000
  ) {
    throw new Error(
      "The deterministic E2E listener identity is invalid; refusing credentials.",
    );
  }
  validateListenerIdentity(identity.app, appPort, "app");
  validateListenerIdentity(identity.proxy, proxyPort, "proxy");
}

export function validateGateMarker(
  marker,
  {
    identity,
    identityFile,
    now,
    rootPid,
    runId,
    certFile,
    spkiPin,
    fileDependencies,
  },
) {
  const certificate = readSecureFile(
    certFile,
    "TLS certificate",
    fileDependencies,
  );
  validateCertificatePin(certificate, spkiPin);
  validateE2ERecordIntegrity(marker, certificate, "credential gate");
  const verifiedAt = Date.parse(marker?.verifiedAt);
  if (
    marker?.schemaVersion !== 4 ||
    marker.runId !== runId ||
    marker.identityPath !== identityFile ||
    marker.identityCreatedAt !== identity.createdAt ||
    marker.appPid !== rootPid ||
    marker.spkiPin !== spkiPin ||
    !Number.isFinite(verifiedAt) ||
    verifiedAt > now + 5_000
  ) {
    throw new Error(
      "The deterministic E2E credential gate marker is invalid; refusing credentials.",
    );
  }
}

export function initializeE2ECompromiseLatch(
  config,
  appPid,
  { privateKey, now = () => Date.now() } = {},
) {
  if (!privateKey) {
    throw new Error("The E2E compromise latch requires its in-memory key.");
  }
  const createdAt = new Date(now()).toISOString();
  atomicWriteSecureJson(
    config.runtime.compromiseFile,
    signE2ERecord(
      {
        schemaVersion: 2,
        state: "healthy",
        runId: config.runtime.runId,
        appPid,
        createdAt,
        spkiPin: config.spkiPin,
      },
      privateKey,
    ),
  );
  let compromised = false;
  const latchListeners = new Set();
  const latch = (code) => {
    if (!compromised && process.env.E2E_PROFILE_GATE_DIAGNOSTICS === "1") {
      console.error(
        `[e2e-credential-gate] ${JSON.stringify({
          code,
          event: "E2E_RUN_COMPROMISED",
          runId: config.runtime.runId,
        })}`,
      );
    }
    compromised = true;
    compromisedRuns.add(compromiseKey(config));
    atomicWriteSecureJson(
      config.runtime.compromiseFile,
      signE2ERecord(
        {
          schemaVersion: 2,
          state: "compromised",
          runId: config.runtime.runId,
          appPid,
          createdAt,
          compromisedAt: new Date(now()).toISOString(),
          code,
          spkiPin: config.spkiPin,
        },
        privateKey,
      ),
    );
    for (const listener of latchListeners) listener(code);
    latchListeners.clear();
  };
  return {
    assertHealthy() {
      if (compromised) throw compromisedRunError();
      try {
        assertE2ECompromiseMarkerHealthy(config, appPid);
      } catch {
        latch("E2E_COMPROMISE_MARKER_TAMPERED");
        throw compromisedRunError();
      }
    },
    isCompromised: () => compromised,
    latch,
    onLatch(listener) {
      if (compromised) {
        listener("E2E_RUN_ALREADY_COMPROMISED");
        return () => {};
      }
      latchListeners.add(listener);
      return () => latchListeners.delete(listener);
    },
  };
}

export function assertE2ECompromiseMarkerHealthy(
  config,
  appPid,
  { fileDependencies } = {},
) {
  if (compromisedRuns.has(compromiseKey(config))) {
    throw compromisedRunError();
  }
  const certificate = readSecureFile(
    config.runtime.tlsCertFile,
    "TLS certificate",
    fileDependencies,
  );
  validateCertificatePin(certificate, config.spkiPin);
  const marker = readSecureJsonFile(
    config.runtime.compromiseFile,
    "compromise latch",
    fileDependencies,
  );
  validateE2ERecordIntegrity(marker, certificate, "compromise latch");
  if (
    marker.schemaVersion !== 2 ||
    marker.runId !== config.runtime.runId ||
    marker.appPid !== appPid ||
    marker.spkiPin !== config.spkiPin ||
    marker.state !== "healthy"
  ) {
    compromisedRuns.add(compromiseKey(config));
    throw compromisedRunError();
  }
  return marker;
}

export function latchE2ECompromise(
  config,
  appPid,
  code,
  { now = () => Date.now() } = {},
) {
  compromisedRuns.add(compromiseKey(config));
  try {
    atomicWriteSecureJson(config.runtime.compromiseFile, {
      schemaVersion: 2,
      state: "compromised",
      runId: config.runtime.runId,
      appPid,
      compromisedAt: new Date(now()).toISOString(),
      code,
      spkiPin: config.spkiPin,
      signature: "client-fail-closed",
    });
  } catch {
    // The process-local latch remains authoritative.
  }
}

export function readSecurePidFile(path, dependencies) {
  const raw = readSecureFile(path, "server PID", dependencies).trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error("The deterministic E2E server PID file is invalid.");
  }
  const pid = Number(raw);
  if (!Number.isSafeInteger(pid)) {
    throw new Error("The deterministic E2E server PID file is invalid.");
  }
  return pid;
}

export function readSecureJsonFile(path, label, dependencies) {
  const raw = readSecureFile(path, label, dependencies);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`The deterministic E2E ${label} file is invalid JSON.`);
  }
}

export function readSecureFile(
  path,
  label,
  {
    open = openSync,
    fstat = fstatSync,
    readFile = readFileSync,
    close = closeSync,
    platform = process.platform,
    getuid = process.getuid,
    noFollow = constants.O_NOFOLLOW,
  } = {},
) {
  if (
    platform !== "linux" ||
    typeof getuid !== "function" ||
    !Number.isInteger(noFollow)
  ) {
    throw new Error(
      `Descriptor-safe deterministic E2E ${label} verification is unavailable; refusing credentials.`,
    );
  }
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error(
      `The deterministic E2E ${label} path is invalid; refusing credentials.`,
    );
  }
  let descriptor;
  try {
    descriptor = open(path, constants.O_RDONLY | noFollow);
    const stat = fstat(descriptor);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== getuid()
    ) {
      throw new Error(
        `The deterministic E2E ${label} file is not descriptor-safe.`,
      );
    }
    if (!Number.isSafeInteger(stat.size) || stat.size > MAX_FILE_BYTES) {
      throw new Error(`The deterministic E2E ${label} file is too large.`);
    }
    return readFile(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) close(descriptor);
  }
}

export function atomicWriteSecureJson(path, value) {
  const replacement = `${path}.${process.pid}.${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(replacement, `${JSON.stringify(value)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(replacement, path);
  } finally {
    safeUnlink(replacement);
  }
}

export function spkiPinFromCertificate(certificate) {
  return createHash("sha256")
    .update(
      new X509Certificate(certificate).publicKey.export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("base64");
}

export function spkiPinFromRawCertificate(raw) {
  return createHash("sha256")
    .update(
      new X509Certificate(raw).publicKey.export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("base64");
}

export function validateCertificatePin(certificate, expectedPin) {
  const actual = spkiPinFromCertificate(certificate);
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(validateSpkiPin(expectedPin));
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error(
      "The deterministic E2E TLS certificate does not match the run SPKI pin.",
    );
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseExactProfileUrl(value, protocol, pathname, name, hostname) {
  const scheme = protocol.slice(0, -1);
  const suffix = pathname === "/" ? "" : pathname;
  const escapedSuffix = suffix.replace("/", "\\/");
  const escapedHostname = hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `^${scheme}://${escapedHostname}:([1-9]\\d*)${escapedSuffix}$`,
  ).exec(value);
  const port = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(port) || port > 65_535) {
    throw new Error(
      `${name} must use exact ${protocol}//${hostname}:<port>${suffix}.`,
    );
  }
  const explicit = `${protocol}//${hostname}:${port}${suffix || "/"}`;
  const url = new URL(explicit);
  Object.defineProperties(url, {
    port: { value: String(port) },
    toJSON: { value: () => explicit },
    toString: { value: () => explicit },
  });
  return url;
}

function validateSpkiPin(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("E2E_PROFILE_TLS_SPKI_PIN must be one SHA-256 SPKI pin.");
  }
  return value;
}

function validateListenerIdentity(listener, port, label) {
  if (
    listener?.host !== "127.0.0.1" ||
    listener.port !== port ||
    !Array.isArray(listener.inodes) ||
    listener.inodes.some((inode) => !/^\d+$/.test(inode))
  ) {
    throw new Error(
      `The deterministic E2E ${label} listener identity is invalid.`,
    );
  }
}

function assertSameInodes(expected, actual, label) {
  if (
    JSON.stringify([...(expected ?? [])].sort()) !==
    JSON.stringify([...(actual ?? [])].sort())
  ) {
    throw new Error(
      `The deterministic E2E ${label} listener changed; refusing credentials.`,
    );
  }
}

function compromisedRunError() {
  return new Error(
    "The deterministic E2E run is compromised; refusing all credential traffic until parent teardown.",
  );
}

function compromiseKey(config) {
  return `${config.runtime.runId}\0${config.runtime.compromiseFile}`;
}

function safeUnlink(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function credentialGateFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/certificate|TLS|SPKI|authorized/i.test(message)) {
    return "E2E_TLS_AUTHENTICATION_FAILED";
  }
  if (/listener|inode|identity/i.test(message)) {
    return "E2E_LISTENER_IDENTITY_FAILED";
  }
  return "E2E_CREDENTIAL_GATE_FAILED";
}

function reportCredentialGateEvent(env, event) {
  if (env.E2E_PROFILE_GATE_DIAGNOSTICS === "1") {
    console.error(`[e2e-credential-gate] ${JSON.stringify(event)}`);
  }
}
