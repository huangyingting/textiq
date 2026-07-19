import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildE2EProfileEnv,
  captureE2EProfileConfigFiles,
  closeE2EProfilePortReservations,
  detectLiveE2EServer,
  provisionChromiumTrust,
  provisionE2ETlsIdentity,
  removeGeneratedTypeIncludes,
  reserveE2EProfilePorts,
  resolveE2EProfileDatabaseUrl,
  resolveE2EProfileProjects,
  resolveE2EProfileRepeatEach,
  resolveE2EProfileWorkers,
  restoreE2EProfileConfigFiles,
  reportE2EProfileFailure,
  runE2EProfile,
  spawnE2EProfileServer,
  stopE2EProfileServer,
  stopE2EProfileServerProcess,
  waitForE2EProfileServer,
} from "./e2e-profile.mjs";
import { deriveAuthenticatedE2EHostname } from "./e2e-origin.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

test("profile env and argument validation covers defensive branches", () => {
  assert.equal(
    resolveE2EProfileDatabaseUrl(
      { DB_PROVIDER: "sqlite", DATABASE_URL: "file:/already/absolute.db" },
      "/repo",
    ),
    "file:/already/absolute.db",
  );
  for (const env of [
    { DB_PROVIDER: "postgres" },
    { DB_PROVIDER: " " },
    { DATABASE_URL: "postgres://example" },
    { DATABASE_URL: "file:" },
    { DATABASE_URL: "file:./db.sqlite?mode=ro" },
    { DATABASE_URL: "file:./db.sqlite#hash" },
  ]) {
    assert.throws(() => resolveE2EProfileDatabaseUrl(env, "/repo"));
  }

  assert.throws(() => buildE2EProfileEnv({}, { runId: "-bad" }));
  assert.throws(() => buildE2EProfileEnv({}, { runId: "ok", runNonce: "BAD" }));
  const mismatchHost = deriveAuthenticatedE2EHostname("ok", "1".repeat(64));
  for (const env of [
    { E2E_PROFILE_PORT: "65534" },
    { E2E_PROFILE_PORT: "65535" },
    { E2E_PROFILE_APP_URL: "https://127.0.0.1:4002" },
    {
      BASE_URL: `https://${mismatchHost}:4001`,
      E2E_BASE_URL: `https://${mismatchHost}:4000`,
    },
  ]) {
    assert.throws(() =>
      buildE2EProfileEnv(env, { runId: "ok", runNonce: "1".repeat(64) }),
    );
  }

  assert.equal(resolveE2EProfileRepeatEach(["--repeat-each", "3"]), 3);
  assert.equal(resolveE2EProfileRepeatEach(["--repeat-each=2"]), 2);
  for (const args of [
    ["--repeat-each"],
    ["--repeat-each=0"],
    ["--repeat-each=x"],
  ]) {
    assert.throws(() => resolveE2EProfileRepeatEach(args));
  }
  assert.equal(resolveE2EProfileWorkers(["--workers", "2"]), 2);
  assert.equal(
    resolveE2EProfileWorkers(
      [],
      { E2E_PROFILE_WORKERS: "50%" },
      { cpuCount: 3 },
    ),
    1,
  );
  for (const [args, env, options] of [
    [["--workers"], {}, {}],
    [["--workers=0"], {}, {}],
    [["--workers=abc"], {}, {}],
    [["--workers=101%"], {}, {}],
    [["--workers=50%"], {}, { cpuCount: 0 }],
    [[], { E2E_PROFILE_WORKERS: 2 }, {}],
  ]) {
    assert.throws(() => resolveE2EProfileWorkers(args, env, options));
  }
  assert.deepEqual(resolveE2EProfileProjects(["--project", "chromium"]), [
    "chromium",
  ]);
  assert.deepEqual(resolveE2EProfileProjects(["--project=chromium"]), [
    "chromium",
  ]);
  assert.throws(() =>
    resolveE2EProfileProjects([], { E2E_PROFILE_PROJECTS: "," }),
  );
  assert.throws(() =>
    resolveE2EProfileProjects([], { E2E_PROFILE_PROJECTS: "firefox" }),
  );
});

test("profile live-server, listing, run, and cleanup failure paths are observable", async () => {
  assert.equal(
    await detectLiveE2EServer("https://localhost:4000", {
      fetchImpl: async () => {},
    }),
    true,
  );
  assert.equal(
    await detectLiveE2EServer("https://localhost:4000", {
      fetchImpl: async () => {
        const error = new Error("aggregate");
        error.errors = [{ code: "ECONNREFUSED" }];
        throw error;
      },
    }),
    false,
  );
  await assert.rejects(
    detectLiveE2EServer("https://localhost:4000", {
      fetchImpl: async () => {
        const error = new Error("boom");
        error.cause = { code: "ECONNRESET" };
        throw error;
      },
    }),
    /Unable to verify/,
  );

  const listed = [];
  await runE2EProfile({
    argv: ["node", "scripts/e2e-profile.mjs", "--list-steps"],
    processEnv: {},
    stdout: (line) => listed.push(line),
  });
  assert.equal(listed.length, 5);

  const exits = [];
  await runE2EProfile({
    argv: ["node", "scripts/e2e-profile.mjs", "--list"],
    processEnv: {},
    runCommand: () => ({ status: 7 }),
    exit: (code) => exits.push(code),
    stdout: () => {},
  });
  assert.deepEqual(exits, [7]);

  await assert.rejects(
    runE2EProfile({
      processEnv: {},
      detectLiveServer: async () => true,
    }),
    /Refusing to reseed/,
  );

  const earlyFailureCalls = [];
  await runE2EProfile({
    argv: ["node", "scripts/e2e-profile.mjs"],
    processEnv: {},
    repoRoot: process.cwd(),
    detectLiveServer: async () => false,
    reservePorts: async () => [{ close: (callback) => callback() }],
    closeReservations: async (reservations) =>
      earlyFailureCalls.push(["close", reservations.length]),
    captureConfig: () => ({}),
    provisionTls: (env) => {
      env.E2E_PROFILE_TLS_KEY_FD = "3";
      env.E2E_PROFILE_TLS_SPKI_PIN = "A".repeat(43) + "=";
      return { keyDescriptor: 77 };
    },
    closeDescriptor: (descriptor) =>
      earlyFailureCalls.push(["descriptor", descriptor]),
    runCommand: () => ({ status: 4 }),
    stopServer: async () => earlyFailureCalls.push(["stop"]),
    cleanup: () => earlyFailureCalls.push(["cleanup"]),
    restoreConfig: () => earlyFailureCalls.push(["restore"]),
    exit: (code) => earlyFailureCalls.push(["exit", code]),
    stdout: () => {},
  });
  assert.deepEqual(
    earlyFailureCalls.filter(([kind]) => kind === "descriptor"),
    [["descriptor", 77]],
  );

  const calls = [];
  await runE2EProfile({
    argv: ["node", "scripts/e2e-profile.mjs"],
    processEnv: {},
    repoRoot: process.cwd(),
    detectLiveServer: async () => false,
    reservePorts: async () => [{ close: (callback) => callback() }],
    closeReservations: async (reservations) =>
      calls.push(["close", reservations.length]),
    captureConfig: () => ({ snapshot: true }),
    provisionTls: (env) => {
      env.E2E_PROFILE_TLS_KEY_FD = "3";
      env.E2E_PROFILE_TLS_SPKI_PIN = "A".repeat(43) + "=";
      return { keyDescriptor: 99 };
    },
    closeDescriptor: (descriptor) => calls.push(["descriptor", descriptor]),
    spawnServer: () => ({ pid: 123, exitCode: null, signalCode: null }),
    waitForServer: async () => {},
    runCommand: (_command, _args, options) => {
      calls.push(["run", options.env.E2E_PROFILE_TLS_KEY_FD ?? "playwright"]);
      return calls.filter(([kind]) => kind === "run").length === 5
        ? { status: 9 }
        : { status: 0 };
    },
    stopServer: async () => calls.push(["stop"]),
    cleanup: (path, options) =>
      calls.push(["cleanup", Boolean(path), options.force]),
    restoreConfig: (snapshot) => calls.push(["restore", snapshot.snapshot]),
    exit: (code) => calls.push(["exit", code]),
    stdout: () => {},
  });
  assert.deepEqual(calls.at(-1), ["exit", 9]);
  assert.ok(calls.some(([kind]) => kind === "cleanup"));
  assert.ok(calls.some(([kind]) => kind === "restore"));
});

test("profile server process and port helpers cover errors and teardown", async () => {
  await assert.rejects(
    waitForE2EProfileServer({
      env: {
        E2E_PROFILE_IDENTITY_FILE: "identity",
        E2E_PROFILE_CREDENTIAL_GATE_FILE: "gate",
        E2E_PROFILE_COMPROMISE_FILE: "compromise",
        E2E_WEB_SERVER_TIMEOUT_MS: "1",
      },
      serverProcess: { e2eSpawnError: new Error("spawn") },
      delay: async () => {},
    }),
    /Unable to launch/,
  );
  await assert.rejects(
    waitForE2EProfileServer({
      env: {
        E2E_PROFILE_IDENTITY_FILE: "identity",
        E2E_PROFILE_CREDENTIAL_GATE_FILE: "gate",
        E2E_PROFILE_COMPROMISE_FILE: "compromise",
        E2E_WEB_SERVER_TIMEOUT_MS: "1",
      },
      serverProcess: { exitCode: 1, signalCode: null },
      delay: async () => {},
    }),
    /exited before readiness/,
  );
  await assert.rejects(
    waitForE2EProfileServer({
      env: {
        E2E_PROFILE_IDENTITY_FILE: "identity",
        E2E_PROFILE_CREDENTIAL_GATE_FILE: "gate",
        E2E_PROFILE_COMPROMISE_FILE: "compromise",
        E2E_WEB_SERVER_TIMEOUT_MS: "1",
      },
      serverProcess: { exitCode: null, signalCode: null },
      existsFile: () => true,
      assertGate: async () => {
        throw new Error("not ready");
      },
      delay: async () => {},
    }),
    /did not establish/,
  );

  const signals = [];
  await stopE2EProfileServerProcess(
    { pid: 123, exitCode: null, signalCode: null },
    {
      kill: (pid, signal) => {
        signals.push([pid, signal]);
        if (signal === "SIGTERM") {
          const error = new Error("gone");
          error.code = "ESRCH";
          throw error;
        }
      },
      delay: async () => {},
    },
  );
  await stopE2EProfileServerProcess(
    { pid: 124, exitCode: null, signalCode: null },
    {
      timeoutMs: 0,
      kill: (pid, signal) => signals.push([pid, signal]),
      delay: async () => {},
    },
  );
  assert.deepEqual(signals, [
    [123, "SIGTERM"],
    [124, "SIGTERM"],
    [124, "SIGKILL"],
  ]);
  await assert.rejects(
    stopE2EProfileServerProcess(
      { pid: 0, exitCode: null, signalCode: null },
      { delay: async () => {} },
    ),
    /PID is invalid/,
  );
  const exiting = { pid: 126, exitCode: null, signalCode: null };
  let delayed = false;
  await stopE2EProfileServerProcess(exiting, {
    kill: (pid, signal) => signals.push([pid, signal]),
    delay: async () => {
      delayed = true;
      exiting.exitCode = 0;
    },
  });
  assert.equal(delayed, true);

  const killGone = [];
  await stopE2EProfileServerProcess(
    { pid: 127, exitCode: null, signalCode: null },
    {
      timeoutMs: 0,
      kill: (pid, signal) => {
        killGone.push([pid, signal]);
        if (signal === "SIGKILL") {
          const error = new Error("gone");
          error.code = "ESRCH";
          throw error;
        }
      },
      delay: async () => {},
    },
  );
  assert.deepEqual(killGone, [
    [127, "SIGTERM"],
    [127, "SIGKILL"],
  ]);

  await assert.rejects(
    stopE2EProfileServerProcess(
      { pid: 125, exitCode: null, signalCode: null },
      {
        kill: () => {
          const error = new Error("denied");
          error.code = "EPERM";
          throw error;
        },
        delay: async () => {},
      },
    ),
    /denied/,
  );

  const closed = [];
  const servers = [
    {
      once: () => {},
      listen: (_options, callback) => callback(),
      removeListener: () => {},
      close: (callback) => {
        closed.push("first");
        callback();
      },
    },
    {
      once: (_event, handler) => handler(new Error("busy")),
      listen: () => {},
    },
  ];
  await assert.rejects(
    reserveE2EProfilePorts(["4000", "4001"], {
      createServerImpl: () => servers.shift(),
    }),
    /Unable to reserve/,
  );
  assert.deepEqual(closed, ["first"]);
  const successClosed = [];
  const successServers = [
    {
      once: () => {},
      listen: (_options, callback) => callback(),
      removeListener: () => {},
      close: (callback) => {
        successClosed.push("a");
        callback();
      },
    },
  ];
  const reservations = await reserveE2EProfilePorts(["4100"], {
    createServerImpl: () => successServers.shift(),
  });
  assert.equal(reservations.length, 1);
  await closeE2EProfilePortReservations(reservations);
  assert.deepEqual(successClosed, ["a"]);

  await assert.rejects(
    closeE2EProfilePortReservations([
      { close: (callback) => callback(new Error("close")) },
    ]),
    /close/,
  );

  assert.throws(() =>
    spawnE2EProfileServer({ env: {}, keyDescriptor: 2, spawnImpl: () => ({}) }),
  );
  const child = {
    once(event, handler) {
      assert.equal(event, "error");
      handler(new Error("spawn"));
    },
  };
  assert.equal(
    spawnE2EProfileServer({ env: {}, keyDescriptor: 3, spawnImpl: () => child })
      .e2eSpawnError.message,
    "spawn",
  );
});

test("TLS provisioning, pid cleanup, and config restore preserve defensive behavior", (t) => {
  const root = createTestFixtureRoot("e2e-profile-coverage");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const env = buildE2EProfileEnv(
    {},
    { repoRoot: root, runId: "tls-errors", runNonce: "6".repeat(64) },
  );
  assert.throws(() =>
    provisionE2ETlsIdentity({ ...env, E2E_PROFILE_TLS_CERT_FILE: "relative" }),
  );
  assert.throws(() =>
    provisionE2ETlsIdentity({
      ...env,
      E2E_PROFILE_TLS_CA_CERT_FILE: "relative",
    }),
  );

  const failingEnv = { ...env };
  const opened = [];
  assert.throws(() =>
    provisionE2ETlsIdentity(failingEnv, {
      repoRoot: root,
      open: () => {
        opened.push(opened.length + 40);
        return opened.at(-1);
      },
      close: (descriptor) => {
        if (descriptor === 41) {
          const error = new Error("already closed");
          error.code = "EBADF";
          throw error;
        }
      },
      unlink: (path) => {
        if (path.endsWith(".csr")) {
          const error = new Error("gone");
          error.code = "ENOENT";
          throw error;
        }
      },
      runOpenSsl: () => ({ status: 1, stderr: "openssl failed\n" }),
    }),
  );

  assert.throws(() =>
    provisionChromiumTrust({ E2E_PROFILE_BROWSER_HOME: "relative" }),
  );
  assert.throws(
    () =>
      provisionChromiumTrust(
        {
          E2E_PROFILE_BROWSER_HOME: join(root, "browser"),
          E2E_PROFILE_TLS_CA_CERT_FILE: join(root, "ca.pem"),
          E2E_PROFILE_RUN_ID: "run",
        },
        { runCommand: () => ({ status: 1, stderr: "certutil failed\n" }) },
      ),
    /certutil failed/,
  );

  const pidFile = join(root, "server.pid");
  assert.throws(() => stopE2EProfileServer("relative.pid"));
  writeFileSync(pidFile, "bad\n", { mode: 0o600 });
  assert.throws(() => stopE2EProfileServer(pidFile), /Invalid/);
  writeFileSync(pidFile, `${Number.MAX_SAFE_INTEGER + 2}\n`, { mode: 0o600 });
  assert.throws(() => stopE2EProfileServer(pidFile), /Invalid/);
  writeFileSync(pidFile, "123\n", { mode: 0o600 });
  assert.throws(() =>
    stopE2EProfileServer(pidFile, {
      kill: () => {
        const error = new Error("denied");
        error.code = "EPERM";
        throw error;
      },
    }),
  );
  assert.equal(existsSync(pidFile), false);

  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ include: ["src/**/*.ts"] }),
  );
  const snapshot = captureE2EProfileConfigFiles(root);
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      include: ["src/**/*.ts", ".next/e2e-profile/run/types/**/*.ts"],
    }),
  );
  writeFileSync(
    join(root, "next-env.d.ts"),
    '/// <reference types=".next/e2e-profile/run/types" />\n',
  );
  restoreE2EProfileConfigFiles(snapshot, ".next/e2e-profile/run");
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")),
    {
      include: ["src/**/*.ts"],
    },
  );
  assert.equal(existsSync(join(root, "next-env.d.ts")), false);

  mkdirSync(join(root, "nested"), { recursive: true });
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ include: ["src/**/*.ts"] }),
  );
  restoreE2EProfileConfigFiles(
    {
      [join(root, "tsconfig.json")]: JSON.stringify({
        include: ["src/**/*.ts"],
      }),
    },
    ".next/e2e-profile/run",
  );
  writeFileSync(join(root, "tsconfig.json"), "not json");
  restoreE2EProfileConfigFiles(
    { [join(root, "tsconfig.json")]: JSON.stringify({ include: [] }) },
    ".next/e2e-profile/run",
  );
  writeFileSync(
    join(root, "nested", "next-env.d.ts"),
    "no generated types here\n",
  );
  restoreE2EProfileConfigFiles(
    { [join(root, "nested", "next-env.d.ts")]: "original\n" },
    ".next/e2e-profile/run",
  );
  assert.equal(
    readFileSync(join(root, "nested", "next-env.d.ts"), "utf8"),
    "no generated types here\n",
  );
  writeFileSync(
    join(root, "nested", "next-env.d.ts"),
    '/// <reference types=".next/e2e-profile/run/types" />\n',
  );
  restoreE2EProfileConfigFiles(
    { [join(root, "nested", "next-env.d.ts")]: "original\n" },
    ".next/e2e-profile/run",
  );
  assert.equal(
    readFileSync(join(root, "nested", "next-env.d.ts"), "utf8"),
    "original\n",
  );
  restoreE2EProfileConfigFiles(
    { [join(root, "missing-next-env.d.ts")]: "original\n" },
    ".next/e2e-profile/run",
  );
  restoreE2EProfileConfigFiles(
    {
      [join(root, "missing-tsconfig.json")]: "{}",
      [join(root, "nested", "next-env.d.ts")]: "original\n",
    },
    ".next/e2e-profile/run",
  );
  assert.deepEqual(
    removeGeneratedTypeIncludes({ include: "src/**/*.ts" }, "dist"),
    {
      include: "src/**/*.ts",
    },
  );

  const originalExitCode = process.exitCode;
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (message) => errors.push(message);
  try {
    reportE2EProfileFailure("plain failure");
    assert.equal(process.exitCode, 1);
    assert.deepEqual(errors, ["plain failure"]);
  } finally {
    console.error = originalConsoleError;
    process.exitCode = originalExitCode;
  }
});
