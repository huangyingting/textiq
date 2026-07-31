import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  parseAuthenticatedE2EAppUrl,
  parseAuthenticatedE2EProfileOrigin,
  parseAuthenticatedE2EReadinessUrl,
  deriveAuthenticatedE2EHostname,
  resolveE2EOriginConfig,
} from "./e2e-origin.mjs";
import {
  buildE2EProfileEnv,
  buildE2EProfileSteps,
  closeE2EProfilePortReservations,
  detectLiveE2EServer,
  e2EPlaywrightProcessEnv,
  provisionE2ETlsIdentity,
  provisionChromiumTrust,
  removeGeneratedTypeIncludes,
  reserveE2EProfilePorts,
  resolveE2EProfileDatabaseUrl,
  resolveE2EProfileFixturePlan,
  resolveE2EProfileExplicitSpecs,
  resolveE2EProfileProjects,
  resolveE2EProfileRepeatEach,
  resolveE2EProfileWorkers,
  runE2EProfile,
  spawnE2EProfileServer,
  stopE2EProfileServer,
  stopE2EProfileServerProcess,
  waitForE2EProfileServer,
} from "./e2e-profile.mjs";
import { runE2EGlobalSetup } from "./e2e-global-setup.mjs";
import {
  authenticateE2EProfile,
  linuxProcessTreePids,
  precompileE2EProfileRoutes,
} from "./e2e-web-server.mjs";
import { resolveE2EWebServerRuntime } from "./e2e-profile-runtime.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

test("self-contained profile separates HTTPS origin, app listener, and readiness", () => {
  const env = buildE2EProfileEnv(
    { E2E_PROFILE_WORKERS: "2" },
    {
      repoRoot: process.cwd(),
      runId: "origin-contract",
      runNonce: "a".repeat(64),
      playwrightArgs: ["--repeat-each=2"],
    },
  );
  const hostname = deriveAuthenticatedE2EHostname(
    "origin-contract",
    "a".repeat(64),
  );
  assert.equal(env.E2E_BASE_URL, `https://${hostname}:4000`);
  assert.equal(env.BASE_URL, env.E2E_BASE_URL);
  assert.equal(env.AUTH_URL, env.E2E_BASE_URL);
  assert.equal(env.NEXT_PUBLIC_APP_URL, env.E2E_BASE_URL);
  assert.equal(env.E2E_PROFILE_HOSTNAME, hostname);
  assert.equal(env.E2E_PROFILE_APP_URL, "http://127.0.0.1:4002");
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, "0");
  assert.equal(env.PORT, "4002");
  assert.equal(env.E2E_PROFILE_READINESS_URL, "http://127.0.0.1:4001/ready");
  assert.equal(env.HOST, "127.0.0.1");
  assert.equal(
    env.E2E_WEB_SERVER_COMMAND,
    "node scripts/e2e-app-server-cli.mjs",
  );
  assert.equal(env.E2E_WEB_SERVER, "0");
  assert.equal(env.E2E_REUSE_EXISTING_SERVER, "1");
  assert.equal(env.E2E_PROFILE_EXTERNAL_SERVER, "1");
  assert.equal(env.NODE_EXTRA_CA_CERTS, env.E2E_PROFILE_TLS_CA_CERT_FILE);
  assert.equal(env.GOOGLE_CLIENT_ID, "");
  assert.equal(env.GOOGLE_CLIENT_SECRET, "");
  assert.equal(env.ACCOUNT_EXPORT_RATE_LIMIT, "100");
  assert.equal(JSON.parse(env.E2E_PROFILE_FIXTURE_SLOTS).length, 4);
});

test("self-contained profile warms collaboration authorization before browser connections", () => {
  const env = buildE2EProfileEnv(
    {},
    {
      repoRoot: process.cwd(),
      runId: "collab-authorize-readiness",
      runNonce: "9".repeat(64),
    },
  );

  assert.ok(
    JSON.parse(env.E2E_PROFILE_PRECOMPILE_ROUTES).some(
      (route) =>
        route.method === "GET" &&
        route.path === "/api/collab/authorize?room=e2efixturedocument0000001" &&
        route.status === 200,
    ),
    "the seeded collaboration room must be authorized during readiness so cold compilation cannot consume the 5-second WebSocket authorization deadline",
  );
});

test("self-contained profile preserves explicit Google OAuth configuration", () => {
  const env = buildE2EProfileEnv(
    {
      GOOGLE_CLIENT_ID: "e2e-google-client",
      GOOGLE_CLIENT_SECRET: "e2e-google-secret",
    },
    {
      repoRoot: process.cwd(),
      runId: "oauth-contract",
      runNonce: "f".repeat(64),
    },
  );

  assert.equal(env.GOOGLE_CLIENT_ID, "e2e-google-client");
  assert.equal(env.GOOGLE_CLIENT_SECRET, "e2e-google-secret");
});

test("self-contained profile preserves an explicit account export budget", () => {
  const env = buildE2EProfileEnv(
    { ACCOUNT_EXPORT_RATE_LIMIT: "7" },
    {
      repoRoot: process.cwd(),
      runId: "account-export-budget",
      runNonce: "7".repeat(64),
    },
  );

  assert.equal(env.ACCOUNT_EXPORT_RATE_LIMIT, "7");
});

test("authenticated profile URL parsers reject normalization and wrong schemes", () => {
  const parserEnv = {
    E2E_PROFILE_RUN_ID: "origin-parser",
    E2E_PROFILE_RUN_NONCE: "1".repeat(64),
  };
  parserEnv.E2E_PROFILE_HOSTNAME = deriveAuthenticatedE2EHostname(
    parserEnv.E2E_PROFILE_RUN_ID,
    parserEnv.E2E_PROFILE_RUN_NONCE,
  );
  assert.equal(
    parseAuthenticatedE2EProfileOrigin(
      `https://${parserEnv.E2E_PROFILE_HOSTNAME}:443`,
      "E2E_BASE_URL",
      parserEnv,
    ).toString(),
    `https://${parserEnv.E2E_PROFILE_HOSTNAME}:443/`,
  );
  assert.equal(
    parseAuthenticatedE2EReadinessUrl("http://127.0.0.1:4001/ready").toString(),
    "http://127.0.0.1:4001/ready",
  );
  assert.equal(
    parseAuthenticatedE2EAppUrl("http://127.0.0.1:4002").toString(),
    "http://127.0.0.1:4002/",
  );
  for (const invalid of [
    `http://${parserEnv.E2E_PROFILE_HOSTNAME}:4000`,
    `HTTPS://${parserEnv.E2E_PROFILE_HOSTNAME}:4000`,
    "https://127.0.0.1:4000",
    "https://localhost:04000",
    `https://${parserEnv.E2E_PROFILE_HOSTNAME}:4000/path`,
  ]) {
    assert.throws(() =>
      parseAuthenticatedE2EProfileOrigin(invalid, "E2E_BASE_URL", parserEnv),
    );
  }
});

test("profile origin resolution ignores the internal PORT only in profile mode", () => {
  const env = buildE2EProfileEnv(
    {},
    {
      repoRoot: process.cwd(),
      runId: "origin-resolution",
      runNonce: "2".repeat(64),
    },
  );
  assert.equal(
    resolveE2EOriginConfig({
      E2E_PROFILE: "1",
      E2E_BASE_URL: env.E2E_BASE_URL.replace(":4000", ":4400"),
      PORT: "4402",
    }).origin,
    env.E2E_BASE_URL.replace(":4000", ":4400"),
  );
  assert.throws(() =>
    resolveE2EOriginConfig({
      E2E_BASE_URL: env.E2E_BASE_URL.replace(":4000", ":4400"),
      PORT: "4402",
    }),
  );
});

test("profile origin resolution validates ports and preserves IPv6 host intent", () => {
  assert.deepEqual(
    resolveE2EOriginConfig({ E2E_BASE_URL: "http://host.test" }),
    {
      origin: "http://host.test",
      port: "80",
      serverHost: "host.test",
    },
  );
  assert.deepEqual(
    resolveE2EOriginConfig({ E2E_BASE_URL: "https://host.test" }),
    {
      origin: "https://host.test",
      port: "443",
      serverHost: "host.test",
    },
  );
  assert.deepEqual(
    resolveE2EOriginConfig({ E2E_BASE_URL: "http://[::1]:4100" }),
    {
      origin: "http://[::1]:4100",
      port: "4100",
      serverHost: "::1",
    },
  );
  assert.deepEqual(resolveE2EOriginConfig({ HOST: "::1", PORT: "4101" }), {
    origin: "http://[::1]:4101",
    port: "4101",
    serverHost: "::1",
  });
  assert.deepEqual(resolveE2EOriginConfig({ HOST: "[::]", PORT: "4102" }), {
    origin: "http://127.0.0.1:4102",
    port: "4102",
    serverHost: "[::]",
  });

  assert.throws(
    () => resolveE2EOriginConfig({ E2E_BASE_URL: "http://[" }),
    /absolute HTTP\(S\) URL/,
  );
  assert.throws(
    () => resolveE2EOriginConfig({ PORT: "not-a-port" }),
    /PORT must be an integer/,
  );
});

test("TLS provisioning persists only the public certificate and inherits an anonymous key FD", (t) => {
  const root = createTestFixtureRoot("e2e-tls-provision");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const env = buildE2EProfileEnv(
    {},
    {
      repoRoot: root,
      runId: "tls-provision",
      runNonce: "b".repeat(64),
    },
  );
  const identity = provisionE2ETlsIdentity(env, { repoRoot: root });
  t.after(() => closeSync(identity.keyDescriptor));
  assert.match(readFileSync(identity.keyDescriptor, "utf8"), /PRIVATE KEY/);
  assert.match(
    readFileSync(env.E2E_PROFILE_TLS_CERT_FILE, "utf8"),
    /BEGIN CERTIFICATE/,
  );
  assert.match(
    readFileSync(env.E2E_PROFILE_TLS_CA_CERT_FILE, "utf8"),
    /BEGIN CERTIFICATE/,
  );
  assert.equal(
    existsSync(join(env.E2E_PROFILE_BROWSER_HOME, ".pki", "nssdb", "cert9.db")),
    true,
  );
  assert.match(env.E2E_PROFILE_TLS_SPKI_PIN, /^[A-Za-z0-9+/]{43}=$/);
  assert.equal(env.E2E_PROFILE_TLS_KEY_FD, "3");
  assert.deepEqual(
    Object.keys(process.env).filter((name) => /TLS.*KEY.*PEM/i.test(name)),
    [],
  );
});

test("runtime paths are absolute, same-directory, and nonce is public correlation only", () => {
  const env = buildE2EProfileEnv(
    {},
    {
      repoRoot: process.cwd(),
      runId: "runtime-contract",
      runNonce: "c".repeat(64),
    },
  );
  const runtime = resolveE2EWebServerRuntime(env);
  assert.equal(runtime.runId, "runtime-contract");
  assert.equal(runtime.nonce, "c".repeat(64));
  assert.equal(runtime.tlsCertFile, env.E2E_PROFILE_TLS_CERT_FILE);
  assert.equal(runtime.tlsCaCertFile, env.E2E_PROFILE_TLS_CA_CERT_FILE);
  assert.throws(() =>
    resolveE2EWebServerRuntime({
      ...env,
      E2E_PROFILE_TLS_CERT_FILE: "relative.pem",
    }),
  );
});

test("runner isolates the key FD to its managed secure server before Playwright", async (t) => {
  const root = createTestFixtureRoot("e2e-runner");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  writeFileSync(join(root, "tsconfig.json"), "{}\n");
  const calls = [];
  const reservations = [{}, {}, {}];
  let closedReservations = 0;
  let closedKey = false;
  let stoppedServer = false;
  const serverProcess = { exitCode: null, pid: 4321, signalCode: null };
  await runE2EProfile({
    argv: ["node", "scripts/e2e-profile.mjs", "--workers=2"],
    processEnv: {},
    repoRoot: root,
    detectLiveServer: async () => false,
    reservePorts: async (ports) => {
      assert.deepEqual(ports, ["4000", "4001", "4002"]);
      return reservations;
    },
    closeReservations: async (value) => {
      closedReservations += value.length;
    },
    provisionTls: (env) => {
      env.E2E_PROFILE_TLS_SPKI_PIN = "A".repeat(43) + "=";
      env.E2E_PROFILE_TLS_KEY_FD = "3";
      return { keyDescriptor: 99 };
    },
    closeDescriptor: (descriptor) => {
      assert.equal(descriptor, 99);
      closedKey = true;
    },
    runCommand: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
    spawnServer: ({ env, keyDescriptor }) => {
      assert.equal(env.E2E_PROFILE_TLS_KEY_FD, "3");
      assert.equal(keyDescriptor, 99);
      return serverProcess;
    },
    waitForServer: ({ serverProcess: actual }) => {
      assert.equal(actual, serverProcess);
      assert.equal(closedKey, true);
    },
    stopServer: (actual) => {
      assert.equal(actual, serverProcess);
      stoppedServer = true;
    },
    cleanup: () => {},
    captureConfig: () => ({}),
    restoreConfig: () => {},
    exit: () => assert.fail("successful runner must not exit"),
  });
  assert.equal(closedReservations, 3);
  assert.deepEqual(
    calls.map((call) => call.args.join(" ")),
    [
      "run db:generate",
      "run db:push",
      "run db:seed:e2e",
      "playwright install chromium",
      "node_modules/@playwright/test/cli.js test --workers=2",
    ],
  );
  assert.equal(calls.at(-1).options.stdio, "inherit");
  assert.equal("E2E_PROFILE_TLS_KEY_FD" in calls.at(-1).options.env, false);
  assert.equal(calls.at(-1).options.env.E2E_WEB_SERVER, "0");
  assert.equal(calls.at(-1).options.env.E2E_REUSE_EXISTING_SERVER, "1");
  assert.equal(calls[2].options.env.E2E_PROFILE_TLS_KEY_FD, "3");
  assert.equal(closedKey, true);
  assert.equal(stoppedServer, true);
});

test("Playwright and its descendants cannot inherit the proxy key descriptor", async (t) => {
  if (process.platform !== "linux") return;
  const root = createTestFixtureRoot("e2e-key-isolation");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const env = buildE2EProfileEnv(
    {},
    {
      repoRoot: root,
      runId: "key-isolation",
      runNonce: "d".repeat(64),
    },
  );
  const identity = provisionE2ETlsIdentity(env, { repoRoot: root });
  const proxy = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    env,
    stdio: ["ignore", "ignore", "ignore", identity.keyDescriptor],
  });
  closeSync(identity.keyDescriptor);
  const playwrightProgram = [
    'const {spawn}=require("node:child_process")',
    'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"})',
    'process.on("SIGTERM",()=>{child.kill("SIGTERM");process.exit(0)})',
    "setInterval(()=>{},1000)",
  ].join(";");
  const playwright = spawn(process.execPath, ["-e", playwrightProgram], {
    env: e2EPlaywrightProcessEnv(env),
    stdio: "ignore",
  });
  t.after(() => {
    if (proxy.exitCode === null) proxy.kill("SIGTERM");
    if (playwright.exitCode === null) playwright.kill("SIGTERM");
  });
  const playwrightTree = await waitForProcessTree(playwright.pid, 2);

  const keyTarget = readlinkSync(`/proc/${proxy.pid}/fd/3`);
  const proxyMatches = descriptorTargets(proxy.pid).filter(
    (target) => target === keyTarget,
  );
  assert.equal(proxyMatches.length, 1);
  assert.equal(playwrightTree.length, 2);
  const inheritedMatches = playwrightTree.flatMap((pid) =>
    descriptorTargets(pid).filter((target) => target === keyTarget),
  );
  assert.equal(inheritedMatches.length, 0);
  assert.equal("E2E_PROFILE_TLS_KEY_FD" in e2EPlaywrightProcessEnv(env), false);
});

test("Playwright descendants do not inherit ambient NO_COLOR alongside forced color", () => {
  const env = buildE2EProfileEnv(
    { NO_COLOR: "1" },
    {
      runId: "color-env-isolation",
      runNonce: "e".repeat(64),
    },
  );

  assert.equal("NO_COLOR" in e2EPlaywrightProcessEnv(env), false);
});

test("direct deterministic Playwright setup fails without the managed secure server", async () => {
  await assert.rejects(
    runE2EGlobalSetup({ env: { E2E_PROFILE: "1" } }),
    /must be started through/,
  );
});

test("fixture planning preserves workers, projects, and repeat slots", () => {
  assert.equal(
    resolveE2EProfileWorkers(["--workers=50%"], {}, { cpuCount: 8 }),
    4,
  );
  assert.deepEqual(
    resolveE2EProfileFixturePlan(
      ["--workers=2", "--repeat-each=3", "--project=chromium"],
      {},
    ),
    {
      projects: ["chromium"],
      repeatEach: 3,
      workers: 2,
      slots: Array.from({ length: 3 }, (_, repeatEachIndex) =>
        Array.from({ length: 2 }, (_unused, parallelIndex) => ({
          projectName: "chromium",
          repeatEachIndex,
          parallelIndex,
        })),
      ).flat(),
    },
  );
});

test("database normalization and generated type cleanup remain deterministic", () => {
  assert.equal(
    resolveE2EProfileDatabaseUrl(
      { DB_PROVIDER: "sqlite", DATABASE_URL: "file:./prisma/dev.db" },
      "/repo",
    ),
    "file:/repo/prisma/dev.db",
  );
  assert.deepEqual(
    removeGeneratedTypeIncludes(
      {
        include: [
          "src/**/*.ts",
          ".next/e2e-profile/run/types/**/*.ts",
          ".next/e2e-profile/run/dev/types/**/*.ts",
        ],
      },
      ".next/e2e-profile/run",
    ),
    { include: ["src/**/*.ts"] },
  );
});

test("origin and profile config reject unsafe edge cases", () => {
  assert.deepEqual(resolveE2EOriginConfig({ HOST: "0.0.0.0" }), {
    origin: "http://127.0.0.1:4000",
    port: "4000",
    serverHost: "0.0.0.0",
  });
  assert.deepEqual(resolveE2EOriginConfig({ HOST: "::", PORT: "4010" }), {
    origin: "http://127.0.0.1:4010",
    port: "4010",
    serverHost: "::",
  });
  assert.equal(
    resolveE2EOriginConfig({ E2E_BASE_URL: "https://localhost:443" }).port,
    "443",
  );

  for (const env of [
    { DB_PROVIDER: "postgres" },
    { DB_PROVIDER: " " },
    { DATABASE_URL: "postgres://example" },
    { DATABASE_URL: "file:" },
    { DATABASE_URL: "file:./db.sqlite?mode=ro" },
  ]) {
    assert.throws(() => resolveE2EProfileDatabaseUrl(env, "/repo"));
  }

  assert.throws(() => buildE2EProfileEnv({}, { runId: "-bad" }));
  assert.throws(() => buildE2EProfileEnv({}, { runId: "ok", runNonce: "ABC" }));
  assert.throws(() =>
    buildE2EProfileEnv(
      { E2E_PROFILE_PORT: "65534" },
      { runId: "ok", runNonce: "1".repeat(64) },
    ),
  );
  assert.throws(() =>
    buildE2EProfileEnv(
      { E2E_PROFILE_PORT: "65535" },
      { runId: "ok", runNonce: "1".repeat(64) },
    ),
  );
  assert.throws(() =>
    buildE2EProfileEnv(
      {
        BASE_URL: "https://localhost:4001",
        E2E_BASE_URL: "https://localhost:4000",
      },
      { runId: "ok", runNonce: "1".repeat(64) },
    ),
  );
});

test("profile argument parsing rejects unsupported worker and project shapes", () => {
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

test("profile server readiness and cleanup handle failure paths", async () => {
  await assert.equal(
    await detectLiveE2EServer("https://localhost:4000", {
      fetchImpl: async () => {},
    }),
    true,
  );
  await assert.equal(
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
    { pid: 123, exitCode: 0, signalCode: null },
    { kill: () => assert.fail("already exited"), delay: async () => {} },
  );
  await stopE2EProfileServerProcess(
    { pid: 123, exitCode: null, signalCode: null },
    {
      timeoutMs: 0,
      kill: (pid, signal) => signals.push([pid, signal]),
      delay: async () => {},
    },
  );
  assert.deepEqual(signals, [
    [123, "SIGTERM"],
    [123, "SIGKILL"],
  ]);
  await assert.rejects(
    stopE2EProfileServerProcess(
      { pid: 0, exitCode: null, signalCode: null },
      { delay: async () => {} },
    ),
    /PID is invalid/,
  );
});

test("profile process helpers cover reservation and command error paths", async () => {
  const closed = [];
  const servers = [
    {
      once: (_event, _handler) => {},
      listen: (_options, callback) => callback(),
      removeListener: () => {},
      close: (callback) => {
        closed.push("first");
        callback();
      },
    },
    {
      once: (_event, handler) => {
        handler(new Error("busy"));
      },
      listen: () => {},
      close: (callback) => {
        closed.push("second");
        callback();
      },
    },
  ];
  await assert.rejects(
    reserveE2EProfilePorts(["4000", "4001"], {
      createServerImpl: () => servers.shift(),
    }),
    /Unable to reserve/,
  );
  assert.deepEqual(closed, ["first"]);
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
    spawnE2EProfileServer({
      env: {},
      keyDescriptor: 3,
      spawnImpl: () => child,
    }).e2eSpawnError.message,
    "spawn",
  );

  assert.throws(() =>
    provisionChromiumTrust({ E2E_PROFILE_BROWSER_HOME: "relative" }),
  );
});

test("command plan keeps database generation, push, seed, browser install, then Playwright", () => {
  const steps = buildE2EProfileSteps({}, [
    "e2e/auth/authenticated-nested-routes.spec.ts",
  ]);
  assert.deepEqual(
    steps.map(([label]) => label),
    [
      "Generate Prisma client",
      "Push SQLite schema",
      "Seed deterministic profile",
      "Install Chromium",
      "Run deterministic E2E profile",
    ],
  );
});

test("explicit profile specs are normalized under the E2E root", () => {
  assert.deepEqual(
    resolveE2EProfileExplicitSpecs(
      [
        "e2e/ui-matrix/document-editor-ui.spec.ts",
        "./e2e/ui-matrix/document-editor-ui.spec.ts",
        "e2e/ui-matrix/document-editor-ui.spec.ts",
        "src/not-e2e.spec.ts",
        "--grep=editor",
      ],
      process.cwd(),
    ),
    ["ui-matrix/document-editor-ui.spec.ts"],
  );
});

test("unrestricted, deterministic, and required lists preserve command provenance", () => {
  const unrestrictedEnv = {
    ...process.env,
    E2E_PROFILE: "0",
    E2E_PROFILE_GREP: "",
  };
  delete unrestrictedEnv.E2E_PROFILE_EXTERNAL_SERVER;
  delete unrestrictedEnv.E2E_PROFILE_HOSTNAME;
  delete unrestrictedEnv.NODE_EXTRA_CA_CERTS;

  const unrestricted = listPlaywrightTests(
    [join("node_modules", "@playwright", "test", "cli.js"), "test", "--list"],
    unrestrictedEnv,
  );
  const deterministic = listPlaywrightTests(
    ["scripts/e2e-profile.mjs", "--list"],
    {
      ...process.env,
      E2E_PROFILE_GREP: "",
    },
  );
  const required = listPlaywrightTests(["scripts/e2e-profile.mjs", "--list"], {
    ...process.env,
    E2E_PROFILE_GREP: "@required-profile",
  });
  const explicitProfile = listPlaywrightTests(
    [
      "scripts/e2e-profile.mjs",
      "--list",
      "e2e/ui-matrix/document-editor-ui.spec.ts",
    ],
    {
      ...process.env,
      E2E_PROFILE_GREP: "",
    },
  );

  assert.match(deterministic.output, /List deterministic E2E profile/);
  assert.match(required.output, /List required E2E profile/);
  assert.ok(
    explicitProfile.tests.some(
      ({ spec }) => spec === "ui-matrix/document-editor-ui.spec.ts",
    ),
    "an explicit profile spec must extend the configured profile match set",
  );
  const unrestrictedIdentities = new Set(unrestricted.tests.map(testIdentity));
  const deterministicIdentities = new Set(
    deterministic.tests.map(testIdentity),
  );
  const requiredIdentities = new Set(required.tests.map(testIdentity));
  assert.deepEqual(
    deterministicIdentities,
    unrestrictedIdentities,
    "every maintained browser test must run in the deterministic profile",
  );

  const annotatedUnrestricted = new Set(
    unrestricted.tests
      .filter(({ title }) => title.includes("@required-profile"))
      .map(testIdentity),
  );
  assert.deepEqual(requiredIdentities, annotatedUnrestricted);
  for (const identity of requiredIdentities) {
    assert.ok(
      deterministicIdentities.has(identity),
      `required test is outside the deterministic profile: ${identity}`,
    );
  }
  assert.ok(
    deterministic.tests.some(
      ({ spec, title }) =>
        spec === "import/import-roundtrip.spec.ts" &&
        title.includes("rejects an unsupported file type"),
    ),
    "deterministic list must include the import-only non-required case",
  );
  assert.equal(
    required.tests.some(({ title }) =>
      title.includes("rejects an unsupported file type"),
    ),
    false,
  );
});

test("profile authentication and precompile keep credentials on injected secure fetch", async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ csrfToken: "csrf" }), {
      status: 200,
      headers: { "set-cookie": "authjs.csrf-token=csrf; Secure; Path=/" },
    }),
    new Response(null, {
      status: 302,
      headers: {
        location: "https://localhost:4000/app",
        "set-cookie":
          "__Secure-authjs.session-token=session; Secure; HttpOnly; Path=/",
      },
    }),
    new Response("<html>ok</html>", { status: 200 }),
  ];
  const fetchImpl = async (target, init) => {
    calls.push({ target: target.toString(), init });
    return responses.shift();
  };
  const cookie = await authenticateE2EProfile({
    email: "owner@example.test",
    fetchImpl,
    origin: "https://localhost:4000",
    password: "password",
  });
  assert.match(cookie, /__Secure-authjs\.session-token=session/);
  await precompileE2EProfileRoutes({
    cookie,
    fetchImpl,
    origin: "https://localhost:4000",
    routes: [{ kind: "dashboard", method: "GET", path: "/app", status: 200 }],
    stdout: () => {},
  });
  assert.equal(calls.length, 3);
  assert.equal(
    calls[1].target,
    "https://localhost:4000/api/auth/callback/credentials",
  );
  assert.match(String(calls[1].init.body), /password=password/);
  assert.equal(calls[2].init.headers.cookie.includes("session"), true);
});

test("PID cleanup terminates only the exact recorded process", () => {
  const root = createTestFixtureRoot("e2e-pid-cleanup");
  const pidFile = join(root, "server.pid");
  writeFileSync(pidFile, "1234\n", { mode: 0o600 });
  const signals = [];
  stopE2EProfileServer(pidFile, {
    kill: (pid, signal) => signals.push([pid, signal]),
  });
  assert.deepEqual(signals, [[1234, "SIGTERM"]]);
  assert.equal(existsSync(pidFile), false);
  rmSync(root, { force: true, recursive: true });
});

function descriptorTargets(pid) {
  return readdirSync(`/proc/${pid}/fd`).flatMap((descriptor) => {
    try {
      return [readlinkSync(`/proc/${pid}/fd/${descriptor}`)];
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  });
}

async function waitForProcessTree(rootPid, expectedCount, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = linuxProcessTreePids(rootPid);
    if (pids.length === expectedCount) return pids;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error("Timed out waiting for the Playwright fixture process tree.");
}

function listPlaywrightTests(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = `${result.stdout}${result.stderr}`;
  const tests = output.split("\n").flatMap((line) => {
    const match = line.match(/› ([^:]+\.spec\.ts):\d+:\d+ › (.+)$/);
    return match ? [{ spec: match[1], title: match[2] }] : [];
  });
  assert.ok(tests.length > 0, output);
  return { output, tests };
}

function testIdentity({ spec, title }) {
  return `${spec} › ${title}`;
}
