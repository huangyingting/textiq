import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { createServer as createHttpsServer } from "node:https";
import { join } from "node:path";
import test from "node:test";

import {
  assertE2ECompromiseMarkerHealthy,
  assertLiveE2ECredentialGate,
  atomicWriteSecureJson,
  initializeE2ECompromiseLatch,
  latchE2ECompromise,
  readSecureFile,
  readSecureJsonFile,
  readSecurePidFile,
  requestOnVerifiedProxyChannel,
  resolveLiveCredentialGateConfig,
  sendE2ERequestOverVerifiedProxy,
  openVerifiedProxyChannel,
  signE2ERecord,
  spkiPinFromCertificate,
  spkiPinFromRawCertificate,
  validateCertificatePin,
  validateE2ERecordIntegrity,
  validateGateMarker,
  validateIdentityRecord,
} from "./e2e-credential-gate.mjs";
import { deriveAuthenticatedE2EHostname } from "./e2e-origin.mjs";
import { provisionE2ETlsIdentity } from "./e2e-profile.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

function envFor(root, runId = "credential-coverage") {
  const nonce = "7".repeat(64);
  const hostname = deriveAuthenticatedE2EHostname(runId, nonce);
  return {
    E2E_BASE_URL: `https://${hostname}:5600`,
    E2E_PROFILE_APP_URL: "http://127.0.0.1:5602",
    E2E_PROFILE_CREDENTIAL_GATE_FILE: join(root, "gate.json"),
    E2E_PROFILE_COMPROMISE_FILE: join(root, "compromise.json"),
    E2E_PROFILE_HOSTNAME: hostname,
    E2E_PROFILE_IDENTITY_FILE: join(root, "identity.json"),
    E2E_PROFILE_READINESS_URL: "http://127.0.0.1:5601/ready",
    E2E_PROFILE_RUN_ID: runId,
    E2E_PROFILE_RUN_NONCE: nonce,
    E2E_PROFILE_SERVER_PID_FILE: join(root, "server.pid"),
    E2E_PROFILE_TLS_CA_CERT_FILE: join(root, "ca.pem"),
    E2E_PROFILE_TLS_CERT_FILE: join(root, "cert.pem"),
    E2E_PROFILE_BROWSER_HOME: join(root, "browser-home"),
    E2E_PROFILE_TLS_SPKI_PIN: "A".repeat(43) + "=",
  };
}

function secureDeps(content, statOverrides = {}) {
  const stat = {
    isFile: () => true,
    mode: 0o600,
    nlink: 1,
    size: Buffer.byteLength(content),
    uid: 1000,
    ...statOverrides,
  };
  return {
    open: () => 9,
    fstat: () => stat,
    readFile: () => content,
    close: () => {},
    platform: "linux",
    getuid: () => 1000,
    noFollow: 1,
  };
}

test("credential gate config validates exact profile URLs, pins, and timeouts", () => {
  const root = join(
    process.cwd(),
    ".tmp",
    "test-fixtures",
    "credential-config",
  );
  const env = envFor(root);
  const config = resolveLiveCredentialGateConfig(env);
  assert.equal(config.origin.toString(), env.E2E_BASE_URL + "/");
  assert.equal(config.readinessUrl.toString(), env.E2E_PROFILE_READINESS_URL);
  assert.equal(config.appOrigin.toString(), env.E2E_PROFILE_APP_URL + "/");
  assert.equal(config.proofTimeoutMs, 10000);
  assert.equal(
    resolveLiveCredentialGateConfig({
      ...env,
      E2E_PROFILE_IDENTITY_PROOF_TIMEOUT_MS: "250",
    }).proofTimeoutMs,
    250,
  );

  for (const overrides of [
    { E2E_BASE_URL: "https://wrong.localhost:5600" },
    { E2E_BASE_URL: `https://${env.E2E_PROFILE_HOSTNAME}:0` },
    { E2E_PROFILE_READINESS_URL: "http://127.0.0.1:5601/not-ready" },
    { E2E_PROFILE_APP_URL: "http://localhost:5602" },
    { E2E_PROFILE_TLS_SPKI_PIN: "bad" },
    { E2E_PROFILE_IDENTITY_PROOF_TIMEOUT_MS: "0" },
  ]) {
    assert.throws(() =>
      resolveLiveCredentialGateConfig({ ...env, ...overrides }),
    );
  }
});

test("secure file readers reject unsafe descriptors and malformed content", () => {
  assert.equal(
    readSecureFile("/secure.txt", "fixture", secureDeps("ok")),
    "ok",
  );
  for (const deps of [
    { platform: "darwin", getuid: () => 1000, noFollow: 1 },
    { platform: "linux", getuid: undefined, noFollow: 1 },
    { platform: "linux", getuid: () => 1000, noFollow: undefined },
  ]) {
    assert.throws(() => readSecureFile("/secure.txt", "fixture", deps));
  }
  assert.throws(() => readSecureFile("relative", "fixture", secureDeps("ok")));
  for (const overrides of [
    { isFile: () => false },
    { nlink: 2 },
    { mode: 0o644 },
    { uid: 2000 },
    { size: 70 * 1024 },
  ]) {
    assert.throws(() =>
      readSecureFile("/secure.txt", "fixture", secureDeps("ok", overrides)),
    );
  }
  assert.equal(readSecurePidFile("/pid", secureDeps("123\n")), 123);
  assert.throws(() =>
    readSecurePidFile("/pid", secureDeps("999999999999999999999999999999\n")),
  );
  assert.throws(() => readSecurePidFile("/pid", secureDeps("0\n")));
  assert.throws(() => readSecurePidFile("/pid", secureDeps("1e309\n")));
  assert.deepEqual(
    readSecureJsonFile("/json", "fixture", secureDeps('{"ok":true}')),
    {
      ok: true,
    },
  );
  assert.throws(() => readSecureJsonFile("/json", "fixture", secureDeps("{")));
});

test("signed records, identity markers, compromise latch, and pins are enforced", async (t) => {
  const root = createTestFixtureRoot("credential-records");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const env = envFor(root, "credential-records");
  const identity = provisionE2ETlsIdentity(env, { repoRoot: root });
  t.after(() => closeSync(identity.keyDescriptor));
  const privateKey = readFileSync(identity.keyDescriptor);
  const certificate = readFileSync(env.E2E_PROFILE_TLS_CERT_FILE);
  const spkiPin = spkiPinFromCertificate(certificate);
  env.E2E_PROFILE_TLS_SPKI_PIN = spkiPin;
  assert.equal(spkiPinFromRawCertificate(certificate), spkiPin);
  validateCertificatePin(certificate, spkiPin);
  assert.throws(() =>
    validateCertificatePin(certificate, "B".repeat(43) + "="),
  );

  const now = Date.now();
  const unsignedIdentity = {
    schemaVersion: 4,
    runId: env.E2E_PROFILE_RUN_ID,
    identityPath: env.E2E_PROFILE_IDENTITY_FILE,
    createdAt: new Date(now).toISOString(),
    appPid: 123,
    spkiPin,
    app: { host: "127.0.0.1", port: 5602, inodes: ["1"], ownerPids: [123] },
    proxy: {
      host: "127.0.0.1",
      port: 5600,
      inodes: ["2"],
      ownerPids: [process.pid],
    },
  };
  const baseIdentity = signE2ERecord(unsignedIdentity, privateKey);
  validateE2ERecordIntegrity(baseIdentity, certificate, "listener identity");
  validateIdentityRecord(baseIdentity, {
    appPort: 5602,
    certFile: env.E2E_PROFILE_TLS_CERT_FILE,
    fileDependencies: secureDeps(certificate),
    identityFile: env.E2E_PROFILE_IDENTITY_FILE,
    now,
    proxyPort: 5600,
    rootPid: 123,
    runId: env.E2E_PROFILE_RUN_ID,
    spkiPin,
  });
  for (const bad of [
    null,
    signE2ERecord({ ...unsignedIdentity, schemaVersion: 3 }, privateKey),
    signE2ERecord({ ...unsignedIdentity, runId: "wrong" }, privateKey),
    signE2ERecord(
      { ...unsignedIdentity, createdAt: new Date(now + 10_000).toISOString() },
      privateKey,
    ),
    signE2ERecord(
      {
        ...unsignedIdentity,
        app: { host: "localhost", port: 5602, inodes: ["1"] },
      },
      privateKey,
    ),
  ]) {
    assert.throws(() =>
      validateIdentityRecord(bad, {
        appPort: 5602,
        certFile: env.E2E_PROFILE_TLS_CERT_FILE,
        fileDependencies: secureDeps(certificate),
        identityFile: env.E2E_PROFILE_IDENTITY_FILE,
        now,
        proxyPort: 5600,
        rootPid: 123,
        runId: env.E2E_PROFILE_RUN_ID,
        spkiPin,
      }),
    );
  }

  const unsignedMarker = {
    schemaVersion: 4,
    runId: env.E2E_PROFILE_RUN_ID,
    identityPath: env.E2E_PROFILE_IDENTITY_FILE,
    identityCreatedAt: baseIdentity.createdAt,
    verifiedAt: new Date(now).toISOString(),
    appPid: 123,
    spkiPin,
  };
  const marker = signE2ERecord(unsignedMarker, privateKey);
  validateGateMarker(marker, {
    certFile: env.E2E_PROFILE_TLS_CERT_FILE,
    fileDependencies: secureDeps(certificate),
    identity: baseIdentity,
    identityFile: env.E2E_PROFILE_IDENTITY_FILE,
    now,
    rootPid: 123,
    runId: env.E2E_PROFILE_RUN_ID,
    spkiPin,
  });
  assert.throws(() =>
    validateGateMarker(
      signE2ERecord({ ...unsignedMarker, appPid: 999 }, privateKey),
      {
        certFile: env.E2E_PROFILE_TLS_CERT_FILE,
        fileDependencies: secureDeps(certificate),
        identity: baseIdentity,
        identityFile: env.E2E_PROFILE_IDENTITY_FILE,
        now,
        rootPid: 123,
        runId: env.E2E_PROFILE_RUN_ID,
        spkiPin,
      },
    ),
  );

  const config = resolveLiveCredentialGateConfig(env);
  assert.throws(
    () => initializeE2ECompromiseLatch(config, 123),
    /in-memory key/,
  );
  const diagnosticRoot = createTestFixtureRoot("credential-diagnostics");
  t.after(() => rmSync(diagnosticRoot, { force: true, recursive: true }));
  const diagnosticEnv = envFor(diagnosticRoot, "credential-diagnostics");
  const diagnosticIdentity = provisionE2ETlsIdentity(diagnosticEnv, {
    repoRoot: diagnosticRoot,
  });
  const diagnosticKey = readFileSync(diagnosticIdentity.keyDescriptor);
  closeSync(diagnosticIdentity.keyDescriptor);
  diagnosticEnv.E2E_PROFILE_TLS_SPKI_PIN = spkiPinFromCertificate(
    readFileSync(diagnosticEnv.E2E_PROFILE_TLS_CERT_FILE),
  );
  const diagnosticConfig = resolveLiveCredentialGateConfig(diagnosticEnv);
  const originalDiagnostics = process.env.E2E_PROFILE_GATE_DIAGNOSTICS;
  const originalConsoleError = console.error;
  const diagnostics = [];
  process.env.E2E_PROFILE_GATE_DIAGNOSTICS = "1";
  console.error = (line) => diagnostics.push(line);
  const diagnosticLatch = initializeE2ECompromiseLatch(diagnosticConfig, 123, {
    privateKey: diagnosticKey,
    now: () => now,
  });
  diagnosticLatch.latch("DIAGNOSTIC");
  console.error = originalConsoleError;
  if (originalDiagnostics === undefined)
    delete process.env.E2E_PROFILE_GATE_DIAGNOSTICS;
  else process.env.E2E_PROFILE_GATE_DIAGNOSTICS = originalDiagnostics;
  assert.match(diagnostics[0], /DIAGNOSTIC/);

  const tamperRoot = createTestFixtureRoot("credential-tamper");
  t.after(() => rmSync(tamperRoot, { force: true, recursive: true }));
  const tamperEnv = envFor(tamperRoot, "credential-tamper");
  const tamperIdentity = provisionE2ETlsIdentity(tamperEnv, {
    repoRoot: tamperRoot,
  });
  const tamperKey = readFileSync(tamperIdentity.keyDescriptor);
  closeSync(tamperIdentity.keyDescriptor);
  tamperEnv.E2E_PROFILE_TLS_SPKI_PIN = spkiPinFromCertificate(
    readFileSync(tamperEnv.E2E_PROFILE_TLS_CERT_FILE),
  );
  const tamperConfig = resolveLiveCredentialGateConfig(tamperEnv);
  const tamperLatch = initializeE2ECompromiseLatch(tamperConfig, 123, {
    privateKey: tamperKey,
    now: () => now,
  });
  atomicWriteSecureJson(
    tamperEnv.E2E_PROFILE_COMPROMISE_FILE,
    signE2ERecord(
      {
        schemaVersion: 2,
        state: "compromised",
        runId: tamperEnv.E2E_PROFILE_RUN_ID,
        appPid: 123,
        spkiPin: tamperEnv.E2E_PROFILE_TLS_SPKI_PIN,
      },
      tamperKey,
    ),
  );
  assert.throws(() => tamperLatch.assertHealthy(), /compromised/);

  const latch = initializeE2ECompromiseLatch(config, 123, {
    privateKey,
    now: () => now,
  });
  let latchedCode;
  const unsubscribe = latch.onLatch((code) => {
    latchedCode = code;
  });
  unsubscribe();
  latch.onLatch((code) => {
    latchedCode = code;
  });
  assert.equal(latch.isCompromised(), false);
  assertE2ECompromiseMarkerHealthy(config, 123);
  latch.latch("BROKEN");
  assert.equal(latchedCode, "BROKEN");
  assert.equal(latch.isCompromised(), true);
  let already;
  latch.onLatch((code) => {
    already = code;
  });
  assert.equal(already, "E2E_RUN_ALREADY_COMPROMISED");
  assert.throws(() => latch.assertHealthy(), /compromised/);

  const unwriteable = {
    runtime: {
      compromiseFile: "/proc/textiq-credential-coverage",
      runId: "unwriteable",
    },
    spkiPin,
  };
  assert.doesNotThrow(() => latchE2ECompromise(unwriteable, 123, "CODE"));
});

test("live gate failures latch, report, and clean stale marker files", async (t) => {
  const root = createTestFixtureRoot("credential-live-failure");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const env = envFor(root, "credential-live-failure");
  mkdirSync(root, { recursive: true });
  writeFileSync(env.E2E_PROFILE_SERVER_PID_FILE, "123\n", { mode: 0o600 });
  writeFileSync(env.E2E_PROFILE_IDENTITY_FILE, "{}\n", { mode: 0o600 });
  writeFileSync(env.E2E_PROFILE_CREDENTIAL_GATE_FILE, "{}\n", { mode: 0o600 });
  writeFileSync(env.E2E_PROFILE_COMPROMISE_FILE, "{}\n", { mode: 0o600 });
  writeFileSync(env.E2E_PROFILE_TLS_CERT_FILE, "not a certificate\n", {
    mode: 0o600,
  });
  writeFileSync(env.E2E_PROFILE_TLS_CA_CERT_FILE, "not a certificate\n", {
    mode: 0o600,
  });
  const events = [];
  await assert.rejects(
    assertLiveE2ECredentialGate({
      env,
      cleanupOnFailure: true,
      reportEvent: (_env, event) => events.push(event),
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(existsSync(env.E2E_PROFILE_IDENTITY_FILE), false);
  assert.equal(existsSync(env.E2E_PROFILE_CREDENTIAL_GATE_FILE), false);

  const replacementTarget = join(root, "atomic.json");
  atomicWriteSecureJson(replacementTarget, { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(replacementTarget, "utf8")), {
    ok: true,
  });
});

test("verified proxy client rejects bad origins, capabilities, and TLS pins", async (t) => {
  async function healthyEnv(rootName, runId) {
    const root = createTestFixtureRoot(rootName);
    t.after(() => rmSync(root, { force: true, recursive: true }));
    const env = envFor(root, runId);
    const identity = provisionE2ETlsIdentity(env, { repoRoot: root });
    const privateKey = readFileSync(identity.keyDescriptor);
    closeSync(identity.keyDescriptor);
    const certificate = readFileSync(env.E2E_PROFILE_TLS_CERT_FILE);
    env.E2E_PROFILE_TLS_SPKI_PIN = spkiPinFromCertificate(certificate);
    const now = Date.now();
    const signedIdentity = signE2ERecord(
      {
        schemaVersion: 4,
        runId: env.E2E_PROFILE_RUN_ID,
        identityPath: env.E2E_PROFILE_IDENTITY_FILE,
        createdAt: new Date(now).toISOString(),
        appPid: process.pid,
        spkiPin: env.E2E_PROFILE_TLS_SPKI_PIN,
        app: {
          host: "127.0.0.1",
          port: 5602,
          inodes: ["1"],
          ownerPids: [process.pid],
        },
        proxy: {
          host: "127.0.0.1",
          port: 5600,
          inodes: ["2"],
          ownerPids: [process.pid],
        },
      },
      privateKey,
    );
    const marker = signE2ERecord(
      {
        schemaVersion: 4,
        runId: env.E2E_PROFILE_RUN_ID,
        identityPath: env.E2E_PROFILE_IDENTITY_FILE,
        identityCreatedAt: signedIdentity.createdAt,
        verifiedAt: new Date(now).toISOString(),
        appPid: process.pid,
        spkiPin: env.E2E_PROFILE_TLS_SPKI_PIN,
      },
      privateKey,
    );
    const compromise = signE2ERecord(
      {
        schemaVersion: 2,
        state: "healthy",
        runId: env.E2E_PROFILE_RUN_ID,
        appPid: process.pid,
        createdAt: new Date(now).toISOString(),
        spkiPin: env.E2E_PROFILE_TLS_SPKI_PIN,
      },
      privateKey,
    );
    writeFileSync(
      env.E2E_PROFILE_SERVER_PID_FILE,
      `
pid-placeholder`,
      { mode: 0o600 },
    );
    writeFileSync(env.E2E_PROFILE_SERVER_PID_FILE, `${process.pid}`, {
      mode: 0o600,
    });
    writeFileSync(env.E2E_PROFILE_SERVER_PID_FILE, `${process.pid}`, {
      mode: 0o600,
    });
    writeFileSync(env.E2E_PROFILE_SERVER_PID_FILE, `${process.pid}`, {
      mode: 0o600,
    });
    writeFileSync(env.E2E_PROFILE_SERVER_PID_FILE, `${process.pid}`, {
      mode: 0o600,
    });
    writeFileSync(env.E2E_PROFILE_SERVER_PID_FILE, String(process.pid) + "\n", {
      mode: 0o600,
    });
    atomicWriteSecureJson(env.E2E_PROFILE_IDENTITY_FILE, signedIdentity);
    atomicWriteSecureJson(env.E2E_PROFILE_CREDENTIAL_GATE_FILE, marker);
    atomicWriteSecureJson(env.E2E_PROFILE_COMPROMISE_FILE, compromise);
    return { certificate, env, privateKey };
  }

  const badOrigin = await healthyEnv(
    "credential-bad-origin",
    "credential-bad-origin",
  );
  await assert.rejects(
    sendE2ERequestOverVerifiedProxy({
      env: badOrigin.env,
      url: "https://evil.example/app",
    }),
    /authenticated HTTPS origin/,
  );

  const listenerMismatch = await healthyEnv(
    "credential-listener-mismatch",
    "credential-listener-mismatch",
  );
  const listenerIdentity = JSON.parse(
    readFileSync(listenerMismatch.env.E2E_PROFILE_IDENTITY_FILE, "utf8"),
  );
  atomicWriteSecureJson(
    listenerMismatch.env.E2E_PROFILE_IDENTITY_FILE,
    signE2ERecord(
      {
        ...listenerIdentity,
        app: { ...listenerIdentity.app, inodes: ["9"] },
      },
      listenerMismatch.privateKey,
    ),
  );
  await assert.rejects(
    assertLiveE2ECredentialGate({
      env: listenerMismatch.env,
      assertOwnedListener: () => ({ inodes: ["1"] }),
    }),
    /listener changed/,
  );

  for (const [rootName, runId, handler, expected] of [
    [
      "credential-capability-status",
      "credential-capability-status",
      (_request, response) => {
        response.writeHead(500);
        response.end("no");
      },
      /refused the request capability/,
    ],
    [
      "credential-capability-invalid",
      "credential-capability-invalid",
      (_request, response) => {
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ capability: 42 }));
      },
      /invalid request capability/,
    ],
  ]) {
    const fixture = await healthyEnv(rootName, runId);
    const server = createHttpsServer(
      { cert: fixture.certificate, key: fixture.privateKey },
      handler,
    );
    server.listen(5600, "127.0.0.1");
    await once(server, "listening");
    await assert.rejects(
      sendE2ERequestOverVerifiedProxy({
        env: fixture.env,
        url: fixture.env.E2E_BASE_URL,
      }),
      expected,
    );
    await new Promise((resolve) => server.close(resolve));
  }

  for (const [rootName, runId, handler, expected] of [
    [
      "credential-proof-status",
      "credential-proof-status",
      (_request, response) => {
        response.writeHead(500);
        response.end("no");
      },
      /rejected its identity probe/,
    ],
    [
      "credential-proof-wrong",
      "credential-proof-wrong",
      (_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ runId: "wrong", spkiPin: "wrong", channel: "tls" }),
        );
      },
      /wrong run identity/,
    ],
  ]) {
    const fixture = await healthyEnv(rootName, runId);
    const server = createHttpsServer(
      { cert: fixture.certificate, key: fixture.privateKey },
      handler,
    );
    server.listen(5600, "127.0.0.1");
    await once(server, "listening");
    await assert.rejects(
      assertLiveE2ECredentialGate({
        env: fixture.env,
        assertOwnedListener: () => ({ inodes: ["1"] }),
      }),
      expected,
    );
    await new Promise((resolve) => server.close(resolve));
  }

  const pinFixture = await healthyEnv("credential-pin", "credential-pin");
  const pinServer = createHttpsServer(
    { cert: pinFixture.certificate, key: pinFixture.privateKey },
    (request, response) => {
      if (request.url === "/early-close") {
        response.writeHead(200, { "content-length": "10" });
        response.write("hi");
        response.destroy();
        return;
      }
      response.end("ok");
    },
  );
  pinServer.listen(5600, "127.0.0.1");
  await once(pinServer, "listening");
  await assert.rejects(
    openVerifiedProxyChannel({
      ...resolveLiveCredentialGateConfig(pinFixture.env),
      spkiPin: "B".repeat(43) + "=",
    }),
    /SPKI pin/,
  );
  const earlyChannel = await openVerifiedProxyChannel(
    resolveLiveCredentialGateConfig(pinFixture.env),
  );
  await assert.rejects(
    requestOnVerifiedProxyChannel(
      earlyChannel,
      resolveLiveCredentialGateConfig(pinFixture.env),
      {
        headers: { host: new URL(pinFixture.env.E2E_BASE_URL).host },
        method: "GET",
        path: "/early-close",
        timeoutMs: 1_000,
      },
    ),
    /aborted|closed early|closed before completion|socket hang up/,
  );
  earlyChannel.agent.destroy();
  earlyChannel.socket.destroy();
  const channel = await openVerifiedProxyChannel(
    resolveLiveCredentialGateConfig(pinFixture.env),
  );
  const result = await requestOnVerifiedProxyChannel(
    channel,
    resolveLiveCredentialGateConfig(pinFixture.env),
    {
      headers: { host: new URL(pinFixture.env.E2E_BASE_URL).host },
      method: "GET",
      path: "/ok",
      timeoutMs: 1_000,
    },
  );
  assert.equal(result.status, 200);
  channel.agent.destroy();
  channel.socket.destroy();
  await new Promise((resolve) => pinServer.close(resolve));
});
