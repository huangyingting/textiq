import assert from "node:assert/strict";
import test from "node:test";

import {
  assertE2EConnectionOwnedByProcess,
  assertE2EListenerOwnedByProcess,
  linuxProcessTreePids,
  waitForOwnedE2EConnection,
  waitForOwnedE2EListener,
} from "./e2e-listener-ownership.mjs";
import {
  assertE2ECredentialGate,
  establishE2ECredentialGate,
  runE2EGlobalSetup,
  runE2EPrecompileProcess,
} from "./e2e-global-setup.mjs";
import {
  assertE2ECompromiseMarkerHealthy,
  latchE2ECompromise,
  readSecureFile,
  readSecureJsonFile,
  readSecurePidFile,
  validateCertificatePin,
} from "./e2e-credential-gate.mjs";
import { buildE2EProfileEnv } from "./e2e-profile.mjs";
import {
  deriveAuthenticatedE2EHostname,
  parseAuthenticatedE2EAppUrl,
  parseAuthenticatedE2EProfileOrigin,
  parseAuthenticatedE2EReadinessUrl,
  resolveE2EOrigin,
  resolveE2EOriginConfig,
} from "./e2e-origin.mjs";

const TCP_HEADER =
  "sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode";

function listenerTable(port, inode = "12345") {
  return `${TCP_HEADER}\n0: 0100007F:${port.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 0A 0 0 0 0 0 ${inode}\n`;
}

function connectionTable(serverPort, clientPort, inode = "12345") {
  return `${TCP_HEADER}\n0: 0100007F:${serverPort.toString(16).toUpperCase().padStart(4, "0")} 0100007F:${clientPort.toString(16).toUpperCase().padStart(4, "0")} 01 0 0 0 0 0 ${inode}\n`;
}

test("listener ownership verifies Linux socket tables and descriptor errors", async () => {
  const readFile = (path) => {
    if (path === "/proc/net/tcp") return listenerTable(4000);
    if (path.endsWith("/children")) return path.includes("/1/") ? "2\n" : "";
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  const result = assertE2EListenerOwnedByProcess({
    host: "127.0.0.1",
    port: 4000,
    pid: 1,
    platform: "linux",
    readFile,
    readDirectory: (path) => (path.includes("/1/") ? ["3"] : ["4"]),
    readLink: (path) => (path.endsWith("/3") ? "socket:[12345]" : "pipe:[1]"),
  });
  assert.deepEqual(result.ownerPids, [1]);
  assert.deepEqual(result.processTreePids, [1, 2]);

  assert.throws(() =>
    assertE2EListenerOwnedByProcess({ host: "localhost", platform: "linux" }),
  );
  assert.throws(() =>
    assertE2EListenerOwnedByProcess({
      host: "127.0.0.1",
      port: 0,
      pid: 1,
      platform: "linux",
    }),
  );
  assert.throws(
    () =>
      assertE2EListenerOwnedByProcess({
        host: "127.0.0.1",
        port: 4000,
        pid: 1,
        platform: "linux",
        readFile: () => listenerTable(4000, "999"),
        readDirectory: () => {
          throw new Error("denied");
        },
      }),
    /descriptors/,
  );

  let attempts = 0;
  await assert.deepEqual(
    await waitForOwnedE2EListener({
      host: "127.0.0.1",
      port: 4000,
      timeoutMs: 50,
      delay: async () => {},
      verify: () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("not ready");
          error.code = "E2E_LISTENER_NOT_READY";
          throw error;
        }
        return { ok: true };
      },
    }),
    { ok: true },
  );
  await assert.rejects(
    waitForOwnedE2EListener({
      host: "127.0.0.1",
      port: 4000,
      timeoutMs: 0,
      delay: async () => {},
      verify: () => {
        const error = new Error("not ready");
        error.code = "E2E_LISTENER_NOT_READY";
        throw error;
      },
    }),
    /did not own/,
  );
});

test("connection ownership covers descendant, explicit owner, and retry paths", async () => {
  const result = assertE2EConnectionOwnedByProcess({
    clientPort: 5000,
    host: "127.0.0.1",
    port: 4000,
    pid: 1,
    platform: "linux",
    readFile: (path) => {
      if (path === "/proc/net/tcp") return connectionTable(4000, 5000);
      if (path.endsWith("/children")) return "";
      throw new Error("unexpected");
    },
    readDirectory: () => ["3"],
    readLink: () => "socket:[12345]",
  });
  assert.deepEqual(result.ownerPids, [1]);

  assertE2EConnectionOwnedByProcess({
    clientPort: 5000,
    host: "127.0.0.1",
    includeDescendants: false,
    port: 4000,
    pid: 1,
    platform: "linux",
    readFile: () => connectionTable(4000, 5000),
    readDirectory: () => ["3"],
    readLink: () => "socket:[12345]",
  });
  assertE2EConnectionOwnedByProcess({
    clientPort: 5000,
    host: "127.0.0.1",
    ownerPids: [9],
    port: 4000,
    pid: 1,
    platform: "linux",
    readFile: () => connectionTable(4000, 5000),
    readDirectory: () => ["3"],
    readLink: () => "socket:[12345]",
  });
  assert.throws(() =>
    assertE2EConnectionOwnedByProcess({
      clientPort: 5000,
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => connectionTable(4000, 5000, "999"),
      readDirectory: () => ["3"],
      readLink: () => "socket:[12345]",
    }),
  );

  let attempts = 0;
  assert.deepEqual(
    await waitForOwnedE2EConnection({
      timeoutMs: 50,
      delay: async () => {},
      verify: () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("not ready");
          error.code = "E2E_CONNECTION_NOT_READY";
          throw error;
        }
        return { ok: true };
      },
    }),
    { ok: true },
  );
  await assert.rejects(
    waitForOwnedE2EConnection({
      timeoutMs: 0,
      delay: async () => {},
      verify: () => {
        const error = new Error("not ready");
        error.code = "E2E_CONNECTION_NOT_READY";
        throw error;
      },
    }),
    /could not be attributed/,
  );

  assert.deepEqual(
    linuxProcessTreePids(1, {
      readFile: (path) => (path.includes("/1/") ? "2 bad 3" : ""),
    }),
    [1, 2, 3],
  );
});

test("global setup delegates through the authenticated transport", async () => {
  const calls = [];
  const env = {
    ...buildE2EProfileEnv(
      {},
      { runId: "ops-coverage", runNonce: "2".repeat(64) },
    ),
    E2E_PROFILE_EXTERNAL_SERVER: "1",
    E2E_PROFILE_TLS_SPKI_PIN: "A".repeat(43) + "=",
  };
  const cleanup = await runE2EGlobalSetup({
    env,
    assertGate: async (config, options) =>
      calls.push(["gate", config, options.env]),
    precompile: async ({ env }) => calls.push(["precompile", env]),
  });
  assert.equal(typeof cleanup, "function");
  assert.deepEqual(
    calls.map(([name]) => name),
    ["gate", "precompile"],
  );
  await assert.rejects(runE2EGlobalSetup({ env: {} }), /must be started/);

  assert.equal(
    await establishE2ECredentialGate({
      env: { E2E_PROFILE_TLS_CERT_FILE: "missing" },
      readFile: () => {
        throw new Error("missing");
      },
    }).catch((error) => error instanceof Error),
    true,
  );
  assert.equal(
    await assertE2ECredentialGate({}, { env: {}, readFile: () => "" }).catch(
      (error) => error instanceof Error,
    ),
    true,
  );
  assert.equal(
    await runE2EPrecompileProcess({ env: {} }).catch(
      (error) => error instanceof Error,
    ),
    true,
  );
});

test("credential gate secure-file guards reject unsafe metadata", () => {
  const safeStat = {
    isFile: () => true,
    mode: 0o600,
    nlink: 1,
    size: 3,
    uid: 1000,
  };
  assert.equal(
    readSecureFile("/secure.json", "fixture", {
      open: () => 7,
      fstat: () => safeStat,
      readFile: () => "123",
      close: () => {},
      platform: "linux",
      getuid: () => 1000,
      noFollow: 1,
    }),
    "123",
  );
  for (const dependencies of [
    { platform: "darwin", getuid: () => 1000, noFollow: 1 },
    { platform: "linux", getuid: undefined, noFollow: 1 },
    { platform: "linux", getuid: () => 1000, noFollow: undefined },
  ]) {
    assert.throws(() =>
      readSecureFile("/secure.json", "fixture", dependencies),
    );
  }
  assert.throws(() =>
    readSecureFile("relative", "fixture", {
      platform: "linux",
      getuid: () => 1000,
      noFollow: 1,
    }),
  );
  assert.throws(() =>
    readSecureFile("/secure.json", "fixture", {
      open: () => 7,
      fstat: () => ({ ...safeStat, mode: 0o644 }),
      readFile: () => "123",
      close: () => {},
      platform: "linux",
      getuid: () => 1000,
      noFollow: 1,
    }),
  );
  assert.equal(
    readSecurePidFile("/pid", {
      open: () => 7,
      fstat: () => safeStat,
      readFile: () => "123\n",
      close: () => {},
      platform: "linux",
      getuid: () => 1000,
      noFollow: 1,
    }),
    123,
  );
  assert.throws(() =>
    readSecurePidFile("/pid", {
      open: () => 7,
      fstat: () => safeStat,
      readFile: () => "0\n",
      close: () => {},
      platform: "linux",
      getuid: () => 1000,
      noFollow: 1,
    }),
  );
  assert.deepEqual(
    readSecureJsonFile("/json", "fixture", {
      open: () => 7,
      fstat: () => safeStat,
      readFile: () => '{"ok":true}',
      close: () => {},
      platform: "linux",
      getuid: () => 1000,
      noFollow: 1,
    }),
    { ok: true },
  );
  assert.throws(() =>
    readSecureJsonFile("/json", "fixture", {
      open: () => 7,
      fstat: () => safeStat,
      readFile: () => "{",
      close: () => {},
      platform: "linux",
      getuid: () => 1000,
      noFollow: 1,
    }),
  );
  assert.throws(() => validateCertificatePin("not a certificate", "bad"));

  const config = {
    runtime: {
      compromiseFile: "/proc/textiq-e2e-compromise",
      runId: "run",
      tlsCertFile: "/cert",
    },
    spkiPin: "A".repeat(43) + "=",
  };
  latchE2ECompromise(config, 123, "CODE", { now: () => 0 });
  assert.throws(() => assertE2ECompromiseMarkerHealthy(config, 123));
});

test("origin helpers cover canonical defaults and URL rejection branches", () => {
  assert.equal(resolveE2EOrigin({ PORT: "4100" }), "http://127.0.0.1:4100");
  assert.deepEqual(resolveE2EOriginConfig({ HOST: "::", PORT: "4101" }), {
    origin: "http://127.0.0.1:4101",
    port: "4101",
    serverHost: "::",
  });
  assert.deepEqual(
    resolveE2EOriginConfig({ E2E_BASE_URL: "https://localhost", PORT: "443" }),
    { origin: "https://localhost", port: "443", serverHost: "localhost" },
  );
  assert.throws(() =>
    resolveE2EOriginConfig({
      E2E_BASE_URL: "https://localhost:4001",
      PORT: "4000",
    }),
  );
  for (const bad of [
    "ftp://localhost:4000",
    "https://user:pass@localhost:4000",
    "https://localhost:4000/path",
    "https://localhost:4000?x=1",
    "https://localhost:4000#x",
    " https://localhost:4000",
    "https://localhost:4000\n",
  ]) {
    assert.throws(() => resolveE2EOriginConfig({ E2E_BASE_URL: bad }));
  }
  assert.throws(() => resolveE2EOriginConfig({ PORT: "0" }));

  const runId = "origin-coverage";
  const nonce = "3".repeat(64);
  const hostname = deriveAuthenticatedE2EHostname(runId, nonce);
  const env = {
    E2E_PROFILE_HOSTNAME: hostname,
    E2E_PROFILE_RUN_ID: runId,
    E2E_PROFILE_RUN_NONCE: nonce,
  };
  assert.equal(
    parseAuthenticatedE2EProfileOrigin(
      `https://${hostname}:4000`,
      "E2E_BASE_URL",
      env,
    ).toString(),
    `https://${hostname}:4000/`,
  );
  for (const bad of [
    `http://${hostname}:4000`,
    `https://user:pass@${hostname}:4000`,
    `https://${hostname}:4000/path`,
    `https://${hostname}`,
    `https://${hostname}:70000`,
    `https://${hostname}:04000`,
    `https://wrong.localhost:4000`,
  ]) {
    assert.throws(() =>
      parseAuthenticatedE2EProfileOrigin(bad, "E2E_BASE_URL", env),
    );
  }
  assert.throws(() => deriveAuthenticatedE2EHostname("-bad", nonce));
  assert.throws(() => deriveAuthenticatedE2EHostname(runId, "not-hex"));

  assert.equal(
    parseAuthenticatedE2EReadinessUrl("http://127.0.0.1:4001/ready").toString(),
    "http://127.0.0.1:4001/ready",
  );
  assert.equal(
    parseAuthenticatedE2EAppUrl("http://127.0.0.1:4002").toString(),
    "http://127.0.0.1:4002/",
  );
  for (const bad of [
    "https://127.0.0.1:4001/ready",
    "http://user:pass@127.0.0.1:4001/ready",
    "http://localhost:4001/ready",
    "http://127.0.0.1:4001/not-ready",
    "http://127.0.0.1",
  ]) {
    assert.throws(() => parseAuthenticatedE2EReadinessUrl(bad));
  }
  for (const bad of [
    "https://127.0.0.1:4002",
    "http://user:pass@127.0.0.1:4002",
    "http://localhost:4002",
    "http://127.0.0.1:4002/path",
  ]) {
    assert.throws(() => parseAuthenticatedE2EAppUrl(bad));
  }
});
