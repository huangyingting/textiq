#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { cpus } from "node:os";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  AUTHENTICATED_E2E_PROFILE_BIND_HOST,
  deriveAuthenticatedE2EHostname,
  parseAuthenticatedE2EAppUrl,
  parseAuthenticatedE2EProfileOrigin,
  parseAuthenticatedE2EReadinessUrl,
  resolveE2EOriginConfig,
} from "./e2e-origin.mjs";
import {
  assertLiveE2ECredentialGate,
  spkiPinFromCertificate,
} from "./e2e-credential-gate.mjs";

// Re-export so callers that import profile helpers get the timeout resolver too.
export { resolveE2EProfileGlobalTimeout } from "./e2e-origin.mjs";

export function resolveE2EProfileDatabaseUrl(
  env = process.env,
  repoRoot = process.cwd(),
) {
  const provider = (env.DB_PROVIDER ?? "sqlite").trim();
  if (provider !== "sqlite") {
    throw new Error(
      `The self-contained E2E profile requires DB_PROVIDER=sqlite, received ${provider || "<empty>"}.`,
    );
  }

  const configuredUrl = env.DATABASE_URL?.trim() || "file:./prisma/dev.db";
  if (!configuredUrl.startsWith("file:")) {
    throw new Error(
      "The self-contained E2E profile requires a SQLite file: DATABASE_URL.",
    );
  }

  const configuredPath = configuredUrl.slice("file:".length);
  if (
    !configuredPath ||
    configuredPath.includes("?") ||
    configuredPath.includes("#")
  ) {
    throw new Error(
      "The self-contained E2E profile requires a plain SQLite file path without query or fragment components.",
    );
  }

  const absolutePath = isAbsolute(configuredPath)
    ? resolve(configuredPath)
    : resolve(repoRoot, configuredPath);
  return `file:${absolutePath}`;
}

export function buildE2EProfileEnv(
  env = process.env,
  {
    runId = `${process.pid}-${randomUUID()}`,
    runNonce = randomBytes(32).toString("hex"),
    repoRoot = process.cwd(),
    playwrightArgs = [],
  } = {},
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
    throw new Error("The deterministic E2E run id is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(runNonce)) {
    throw new Error(
      "The deterministic E2E run nonce must be 32 random bytes encoded as lowercase hex.",
    );
  }
  const originEnv =
    env.E2E_BASE_URL || env.BASE_URL
      ? { ...env, PORT: undefined }
      : {
          ...env,
          PORT: undefined,
          E2E_BASE_URL: `https://${deriveAuthenticatedE2EHostname(runId, runNonce)}:${
            env.E2E_PROFILE_PORT?.trim() || env.PORT?.trim() || "4000"
          }`,
        };
  const profileHostname = deriveAuthenticatedE2EHostname(runId, runNonce);
  originEnv.E2E_PROFILE_RUN_ID = runId;
  originEnv.E2E_PROFILE_RUN_NONCE = runNonce;
  originEnv.E2E_PROFILE_HOSTNAME = profileHostname;
  const origin = resolveE2EOriginConfig(originEnv);
  parseAuthenticatedE2EProfileOrigin(origin.origin, "E2E_BASE_URL", originEnv);
  const readinessPort = Number(origin.port) + 1;
  if (!Number.isSafeInteger(readinessPort) || readinessPort > 65_535) {
    throw new Error(
      `The self-contained E2E profile cannot reserve a readiness port after ${origin.port}.`,
    );
  }
  const readinessUrl = new URL(
    `http://${AUTHENTICATED_E2E_PROFILE_BIND_HOST}:${readinessPort}/ready`,
  );
  const configuredReadinessUrl = parseAuthenticatedE2EReadinessUrl(
    env.E2E_PROFILE_READINESS_URL ?? readinessUrl.toString(),
  );
  const appPort = Number(origin.port) + 2;
  if (!Number.isSafeInteger(appPort) || appPort > 65_535) {
    throw new Error(
      `The self-contained E2E profile cannot reserve an app port after ${origin.port}.`,
    );
  }
  const appUrl = parseAuthenticatedE2EAppUrl(
    env.E2E_PROFILE_APP_URL ??
      `http://${AUTHENTICATED_E2E_PROFILE_BIND_HOST}:${appPort}`,
  );
  if (configuredReadinessUrl.origin === origin.origin) {
    throw new Error(
      "E2E_PROFILE_READINESS_URL must use a separate port from E2E_BASE_URL.",
    );
  }
  if (env.BASE_URL && env.E2E_BASE_URL) {
    const baseOrigin = resolveE2EOriginConfig({
      ...env,
      E2E_BASE_URL: undefined,
      PORT: undefined,
    }).origin;
    if (baseOrigin !== origin.origin) {
      throw new Error(
        `BASE_URL ${baseOrigin} does not match E2E_BASE_URL ${origin.origin}.`,
      );
    }
  }
  const fixturePlan = resolveE2EProfileFixturePlan(playwrightArgs, env);
  const explicitSpecs = resolveE2EProfileExplicitSpecs(
    playwrightArgs,
    repoRoot,
  );
  const runtimeDir = resolve(repoRoot, ".next", "e2e-profile", runId);
  const childEnv = { ...env };
  delete childEnv.HOST;
  delete childEnv.HOSTNAME;
  delete childEnv.NEXT_HOST;
  return {
    ...childEnv,
    DB_PROVIDER: "sqlite",
    DATABASE_URL: resolveE2EProfileDatabaseUrl(env, repoRoot),
    AUTH_SECRET: env.AUTH_SECRET ?? "ci-placeholder",
    AUTH_LOGIN_RATE_LIMIT: env.AUTH_LOGIN_RATE_LIMIT ?? "100",
    ACCOUNT_EXPORT_RATE_LIMIT: env.ACCOUNT_EXPORT_RATE_LIMIT ?? "100",
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID ?? "",
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET ?? "",
    BASE_URL: origin.origin,
    E2E_BASE_URL: origin.origin,
    AUTH_URL: origin.origin,
    NEXT_PUBLIC_APP_URL: origin.origin,
    HOST: AUTHENTICATED_E2E_PROFILE_BIND_HOST,
    NODE_OPTIONS:
      "--dns-result-order=ipv4first --no-network-family-autoselection",
    PORT: appUrl.port,
    E2E_PROFILE_DIST_DIR: join(".next", "e2e-profile", runId),
    E2E_PROFILE_RUN_ID: runId,
    E2E_PROFILE_RUN_NONCE: runNonce,
    E2E_PROFILE_HOSTNAME: profileHostname,
    E2E_PROFILE_SERVER_PID_FILE: join(runtimeDir, "server.pid"),
    E2E_PROFILE_IDENTITY_FILE: join(runtimeDir, "listener-identity.json"),
    E2E_PROFILE_CREDENTIAL_GATE_FILE: join(runtimeDir, "credential-gate.json"),
    E2E_PROFILE_COMPROMISE_FILE: join(runtimeDir, "compromise-latch.json"),
    E2E_PROFILE_TLS_CERT_FILE: join(runtimeDir, "proxy-cert.pem"),
    E2E_PROFILE_TLS_CA_CERT_FILE: join(runtimeDir, "proxy-ca.pem"),
    E2E_PROFILE_BROWSER_HOME: join(runtimeDir, "browser-home"),
    PLAYWRIGHT_BROWSERS_PATH: env.PLAYWRIGHT_BROWSERS_PATH ?? "0",
    NODE_EXTRA_CA_CERTS: join(runtimeDir, "proxy-ca.pem"),
    E2E_PROFILE_APP_URL: appUrl.origin,
    E2E_PROFILE: "1",
    E2E_PROFILE_PRECOMPILE_EMAIL:
      env.E2E_PROFILE_PRECOMPILE_EMAIL ??
      env.E2E_USER_EMAIL ??
      "e2e-owner@textiq.test",
    E2E_PROFILE_PRECOMPILE_PASSWORD:
      env.E2E_PROFILE_PRECOMPILE_PASSWORD ??
      env.E2E_USER_PASSWORD ??
      "e2e-owner-pw-2026",
    E2E_PROFILE_PRECOMPILE_ROUTES:
      env.E2E_PROFILE_PRECOMPILE_ROUTES ??
      JSON.stringify([
        { kind: "dashboard", method: "GET", path: "/app", status: 200 },
        {
          kind: "import-invalid-media",
          method: "POST",
          path: "/api/import",
          status: 422,
        },
        {
          kind: "document-editor",
          method: "GET",
          path: "/app/documents/e2efixturedocument0000001",
          status: 200,
        },
      ]),
    E2E_PROFILE_READINESS_URL: configuredReadinessUrl.toString(),
    E2E_PROFILE_READINESS_TIMEOUT_MS:
      env.E2E_PROFILE_READINESS_TIMEOUT_MS ?? "120000",
    E2E_PROFILE_IDENTITY_PROOF_TIMEOUT_MS:
      env.E2E_PROFILE_IDENTITY_PROOF_TIMEOUT_MS ?? "10000",
    E2E_PROFILE_GATE_DIAGNOSTICS: "1",
    E2E_PROFILE_WORKERS: String(fixturePlan.workers),
    E2E_PROFILE_FIXTURE_SLOTS: JSON.stringify(fixturePlan.slots),
    E2E_PROFILE_EXPLICIT_SPECS: JSON.stringify(explicitSpecs),
    E2E_WEB_SERVER: "0",
    E2E_PROFILE_EXTERNAL_SERVER: "1",
    E2E_PROFILE_SERVER: env.E2E_PROFILE_SERVER ?? "dev",
    E2E_WEB_SERVER_COMMAND: "node scripts/e2e-app-server-cli.mjs",
    E2E_WEB_SERVER_TIMEOUT_MS: env.E2E_WEB_SERVER_TIMEOUT_MS ?? "480000",
    E2E_REUSE_EXISTING_SERVER: "1",
  };
}

export function resolveE2EProfileExplicitSpecs(
  playwrightArgs = [],
  repoRoot = process.cwd(),
) {
  const e2eRoot = resolve(repoRoot, "e2e");
  const specs = [];

  for (const arg of playwrightArgs) {
    if (
      typeof arg !== "string" ||
      arg.startsWith("-") ||
      !arg.endsWith(".spec.ts")
    ) {
      continue;
    }

    const relativeSpec = relative(e2eRoot, resolve(repoRoot, arg));
    if (
      !relativeSpec ||
      relativeSpec === ".." ||
      relativeSpec.startsWith(`..${sep}`) ||
      isAbsolute(relativeSpec)
    ) {
      continue;
    }
    specs.push(relativeSpec.split(sep).join("/"));
  }

  return [...new Set(specs)];
}

export function resolveE2EProfileRepeatEach(playwrightArgs = []) {
  let repeatEach = 1;
  for (let index = 0; index < playwrightArgs.length; index += 1) {
    const arg = playwrightArgs[index];
    let raw;
    if (arg === "--repeat-each") {
      raw = playwrightArgs[index + 1];
      index += 1;
    } else if (arg.startsWith("--repeat-each=")) {
      raw = arg.slice("--repeat-each=".length);
    } else {
      continue;
    }

    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new Error(
        `--repeat-each must be a positive integer, received ${JSON.stringify(raw)}.`,
      );
    }
    repeatEach = parsed;
  }
  return repeatEach;
}

export function resolveE2EProfileWorkers(
  playwrightArgs = [],
  env = process.env,
  { cpuCount = cpus().length } = {},
) {
  let rawWorkers = env.E2E_PROFILE_WORKERS?.trim() || "1";
  for (let index = 0; index < playwrightArgs.length; index += 1) {
    const arg = playwrightArgs[index];
    if (arg === "--workers") {
      rawWorkers = playwrightArgs[index + 1];
      index += 1;
    } else if (arg.startsWith("--workers=")) {
      rawWorkers = arg.slice("--workers=".length);
    }
  }

  if (typeof rawWorkers !== "string") {
    throw new Error(
      `Workers ${String(rawWorkers)} must be a number or percentage.`,
    );
  }
  if (rawWorkers.endsWith("%")) {
    const percentageText = rawWorkers.slice(0, -1);
    if (!/^\d+$/.test(percentageText)) {
      throw new Error(`Workers ${rawWorkers} must be a number or percentage.`);
    }
    const percentage = Number(percentageText);
    if (percentage < 1 || percentage > 100) {
      throw new Error(
        `Workers percentage must be between 1% and 100%, received ${rawWorkers}.`,
      );
    }
    if (!Number.isSafeInteger(cpuCount) || cpuCount < 1) {
      throw new Error(
        `Available CPU count must be a positive integer, received ${String(cpuCount)}.`,
      );
    }
    return Math.max(1, Math.floor(cpuCount * (percentage / 100)));
  }

  if (!/^\d+$/.test(rawWorkers)) {
    throw new Error(`Workers ${rawWorkers} must be a number or percentage.`);
  }
  const workers = Number(rawWorkers);
  if (!Number.isSafeInteger(workers) || workers < 1) {
    throw new Error(
      `Workers must be a positive number, received ${rawWorkers}.`,
    );
  }
  return workers;
}

export function resolveE2EProfileProjects(
  playwrightArgs = [],
  env = process.env,
) {
  const projects = [];
  for (let index = 0; index < playwrightArgs.length; index += 1) {
    const arg = playwrightArgs[index];
    if (arg === "--project") {
      projects.push(playwrightArgs[index + 1]);
      index += 1;
    } else if (arg.startsWith("--project=")) {
      projects.push(arg.slice("--project=".length));
    }
  }
  const configured =
    projects.length > 0
      ? projects
      : (env.E2E_PROFILE_PROJECTS ?? "chromium").split(",");
  const normalized = configured
    .map((project) => project?.trim())
    .filter(Boolean);
  if (normalized.length === 0) {
    throw new Error(
      "At least one deterministic Playwright project is required.",
    );
  }
  const uniqueProjects = [...new Set(normalized)];
  const unsupportedProjects = uniqueProjects.filter(
    (project) => project !== "chromium",
  );
  if (unsupportedProjects.length > 0) {
    throw new Error(
      `The deterministic E2E profile supports only the Chromium project because its per-run loopback resolver and isolated NSS trust contract is Chromium-specific; received ${unsupportedProjects.join(", ")}.`,
    );
  }
  return uniqueProjects;
}

export function resolveE2EProfileFixturePlan(
  playwrightArgs = [],
  env = process.env,
) {
  const repeatEach = resolveE2EProfileRepeatEach(playwrightArgs);
  const workers = resolveE2EProfileWorkers(playwrightArgs, env);
  const projects = resolveE2EProfileProjects(playwrightArgs, env);
  const slots = projects.flatMap((projectName) =>
    Array.from({ length: repeatEach }, (_, repeatEachIndex) =>
      Array.from({ length: workers }, (_unused, parallelIndex) => ({
        projectName,
        repeatEachIndex,
        parallelIndex,
      })),
    ).flat(),
  );
  return { projects, repeatEach, workers, slots };
}

export function buildE2EProfileSteps(env = process.env, playwrightArgs = []) {
  return [
    ["Generate Prisma client", "npm", ["run", "db:generate"]],
    ["Push SQLite schema", "npm", ["run", "db:push"]],
    ["Seed deterministic profile", "npm", ["run", "db:seed:e2e"]],
    [
      "Install Chromium",
      "npx",
      [
        "playwright",
        "install",
        ...(env.E2E_INSTALL_BROWSER_DEPS === "1" ? ["--with-deps"] : []),
        "chromium",
      ],
    ],
    [
      "Run deterministic E2E profile",
      process.execPath,
      [
        join("node_modules", "@playwright", "test", "cli.js"),
        "test",
        ...playwrightArgs,
      ],
    ],
  ];
}

function connectionRefusalCodes(error, codes = []) {
  if (!error || typeof error !== "object") return codes;
  if ("code" in error && typeof error.code === "string") {
    codes.push(error.code);
  }
  if ("cause" in error) {
    connectionRefusalCodes(error.cause, codes);
  }
  if ("errors" in error && Array.isArray(error.errors)) {
    for (const nestedError of error.errors) {
      connectionRefusalCodes(nestedError, codes);
    }
  }
  return codes;
}

export async function detectLiveE2EServer(
  origin,
  { fetchImpl = globalThis.fetch, timeoutMs = 2_000 } = {},
) {
  try {
    await fetchImpl(origin, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch (error) {
    const codes = connectionRefusalCodes(error);
    if (codes.length > 0 && codes.every((code) => code === "ECONNREFUSED")) {
      return false;
    }
    throw new Error(
      `Unable to verify that ${origin} is idle; refusing to mutate the E2E database.`,
      { cause: error },
    );
  }
}

export async function reserveE2EProfilePorts(
  ports,
  { createServerImpl = createNetServer } = {},
) {
  const reservations = [];
  try {
    for (const port of ports) {
      reservations.push(
        await reserveE2EProfilePort(port, { createServerImpl }),
      );
    }
  } catch (error) {
    await closeE2EProfilePortReservations(reservations);
    throw error;
  }
  return reservations;
}

async function reserveE2EProfilePort(
  port,
  { createServerImpl = createNetServer } = {},
) {
  const numericPort = Number(port);
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServerImpl();
    const rejectBind = (error) => {
      rejectPromise(
        new Error(
          `Unable to reserve the deterministic E2E profile port on IPv4 loopback ${AUTHENTICATED_E2E_PROFILE_BIND_HOST}:${numericPort}. Ensure IPv4 loopback is available and the port is free.`,
          { cause: error },
        ),
      );
    };
    server.once("error", rejectBind);
    server.listen(
      {
        exclusive: true,
        host: AUTHENTICATED_E2E_PROFILE_BIND_HOST,
        port: numericPort,
      },
      () => {
        server.removeListener("error", rejectBind);
        resolvePromise(server);
      },
    );
  });
}
export async function closeE2EProfilePortReservations(reservations) {
  await Promise.all(
    reservations.map(
      (server) =>
        new Promise((resolvePromise, rejectPromise) => {
          server.close((error) => {
            if (error) {
              rejectPromise(error);
              return;
            }
            resolvePromise();
          });
        }),
    ),
  );
}

export async function runE2EProfile({
  argv = process.argv,
  processEnv = process.env,
  repoRoot = process.cwd(),
  runCommand = spawnSync,
  spawnServer = spawnE2EProfileServer,
  waitForServer = waitForE2EProfileServer,
  detectLiveServer = detectLiveE2EServer,
  reservePorts = reserveE2EProfilePorts,
  closeReservations = closeE2EProfilePortReservations,
  stdout = console.log,
  cleanup = rmSync,
  captureConfig = captureE2EProfileConfigFiles,
  restoreConfig = restoreE2EProfileConfigFiles,
  stopServer = stopE2EProfileServerProcess,
  provisionTls = provisionE2ETlsIdentity,
  closeDescriptor = closeSync,
  exit = process.exit,
} = {}) {
  const listSteps = argv.includes("--list-steps");
  const playwrightArgs = argv
    .slice(2)
    .filter((arg) => arg !== "--" && arg !== "--list-steps");
  const env = buildE2EProfileEnv(processEnv, { repoRoot, playwrightArgs });
  const steps = buildE2EProfileSteps(env, playwrightArgs);

  if (listSteps) {
    for (const [label, command, args] of steps) {
      stdout(`${label}: ${command} ${args.join(" ")}`);
    }
    return;
  }
  if (playwrightArgs.includes("--list")) {
    const [, command, args] = steps.at(-1);
    const listEnv = e2EPlaywrightProcessEnv(env);
    delete listEnv.NODE_EXTRA_CA_CERTS;
    const profileLabel =
      env.E2E_PROFILE_GREP === "@required-profile"
        ? "required"
        : "deterministic";
    stdout(`\n[e2e-profile] List ${profileLabel} E2E profile`);
    const result = runCommand(command, args, {
      stdio: "inherit",
      env: listEnv,
      cwd: repoRoot,
    });
    if (result.status !== 0) {
      exit(result.status ?? 1);
    }
    return;
  }

  if (await detectLiveServer(env.E2E_BASE_URL)) {
    throw new Error(
      `Refusing to reseed while an E2E server is already responding at ${env.E2E_BASE_URL}. Stop the live server so no Yjs room can outlive the database reset.`,
    );
  }
  let reservations = await reservePorts([
    parseAuthenticatedE2EProfileOrigin(env.E2E_BASE_URL, "E2E_BASE_URL", env)
      .port,
    parseAuthenticatedE2EReadinessUrl(env.E2E_PROFILE_READINESS_URL).port,
    parseAuthenticatedE2EAppUrl(env.E2E_PROFILE_APP_URL).port,
  ]);
  let configSnapshot;
  let tlsIdentity;
  let serverProcess;
  let keyDescriptorClosed = false;
  let exitCode;
  try {
    configSnapshot = captureConfig(repoRoot);
    tlsIdentity = provisionTls(env, { repoRoot });
    for (const [label, command, args] of steps) {
      if (label === "Run deterministic E2E profile") {
        await closeReservations(reservations);
        reservations = [];
        serverProcess = spawnServer({
          env,
          keyDescriptor: tlsIdentity.keyDescriptor,
          repoRoot,
        });
        closeDescriptor(tlsIdentity.keyDescriptor);
        keyDescriptorClosed = true;
        await waitForServer({ env, serverProcess });
      }
      stdout(`\n[e2e-profile] ${label}`);
      const result = runCommand(command, args, {
        stdio: "inherit",
        env:
          label === "Run deterministic E2E profile"
            ? e2EPlaywrightProcessEnv(env)
            : env,
        cwd: repoRoot,
      });
      if (result.status !== 0) {
        exitCode = result.status ?? 1;
        break;
      }
    }
  } finally {
    // Cleanup and config restore must run even if server teardown throws, so
    // they are placed in a nested inner-finally that is always reached.
    try {
      if (reservations.length > 0) {
        await closeReservations(reservations);
      }
      await stopServer(serverProcess);
      if (tlsIdentity && !keyDescriptorClosed) {
        closeDescriptor(tlsIdentity.keyDescriptor);
      }
    } finally {
      cleanup(env.E2E_PROFILE_DIST_DIR, { force: true, recursive: true });
      if (configSnapshot !== undefined) {
        restoreConfig(configSnapshot, env.E2E_PROFILE_DIST_DIR);
      }
    }
  }

  if (exitCode !== undefined) {
    exit(exitCode);
  }
}

export function spawnE2EProfileServer({
  env,
  keyDescriptor,
  repoRoot = process.cwd(),
  spawnImpl = spawn,
}) {
  if (!Number.isSafeInteger(keyDescriptor) || keyDescriptor < 3) {
    throw new Error(
      "The deterministic E2E secure server requires a protected key descriptor.",
    );
  }
  const child = spawnImpl(
    process.execPath,
    [join("scripts", "e2e-secure-server-cli.mjs")],
    {
      cwd: repoRoot,
      env,
      stdio: ["inherit", "inherit", "inherit", keyDescriptor],
    },
  );
  child.once?.("error", (error) => {
    child.e2eSpawnError = error;
  });
  return child;
}

export function e2EPlaywrightProcessEnv(env) {
  const playwrightEnv = {
    ...env,
    E2E_PROFILE_EXTERNAL_SERVER: "1",
    E2E_REUSE_EXISTING_SERVER: "1",
    E2E_WEB_SERVER: "0",
  };
  delete playwrightEnv.E2E_PROFILE_TLS_KEY_FD;
  // Playwright forces color in its worker processes. Passing an ambient
  // NO_COLOR alongside that setting makes Node emit a warning in every worker,
  // obscuring actionable runtime warnings such as listener leaks.
  delete playwrightEnv.NO_COLOR;
  playwrightEnv.HOME = env.E2E_PROFILE_BROWSER_HOME;
  playwrightEnv.XDG_CONFIG_HOME = join(env.E2E_PROFILE_BROWSER_HOME, ".config");
  playwrightEnv.XDG_CACHE_HOME = join(env.E2E_PROFILE_BROWSER_HOME, ".cache");
  return playwrightEnv;
}

export async function waitForE2EProfileServer({
  env,
  serverProcess,
  assertGate = assertLiveE2ECredentialGate,
  existsFile = existsSync,
  delay = (ms) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
  timeoutMs = Number(env.E2E_WEB_SERVER_TIMEOUT_MS ?? 480_000),
}) {
  const deadline = Date.now() + timeoutMs;
  const requiredFiles = [
    env.E2E_PROFILE_IDENTITY_FILE,
    env.E2E_PROFILE_CREDENTIAL_GATE_FILE,
    env.E2E_PROFILE_COMPROMISE_FILE,
  ];
  let lastError;
  while (Date.now() < deadline) {
    if (serverProcess?.e2eSpawnError) {
      throw new Error("Unable to launch the deterministic E2E secure server.", {
        cause: serverProcess.e2eSpawnError,
      });
    }
    if (
      serverProcess &&
      (serverProcess.exitCode !== null || serverProcess.signalCode !== null)
    ) {
      throw new Error(
        `The deterministic E2E secure server exited before readiness (code ${serverProcess.exitCode ?? "signal"}, signal ${serverProcess.signalCode ?? "none"}).`,
      );
    }
    if (requiredFiles.every((path) => existsFile(path))) {
      try {
        return await assertGate({ env });
      } catch (error) {
        lastError = error;
      }
    }
    await delay(50);
  }
  throw new Error(
    "The deterministic E2E secure server did not establish its authenticated HTTPS/WSS gate before timeout.",
    { cause: lastError },
  );
}

export async function stopE2EProfileServerProcess(
  serverProcess,
  {
    timeoutMs = 5_000,
    kill = process.kill,
    delay = (ms) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
  } = {},
) {
  if (
    !serverProcess ||
    serverProcess.e2eSpawnError ||
    serverProcess.exitCode !== null ||
    serverProcess.signalCode !== null
  ) {
    return;
  }
  const pid = Number(serverProcess.pid);
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw new Error("The deterministic E2E secure server PID is invalid.");
  }
  try {
    kill(pid, "SIGTERM");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return;
    throw error;
  }
  const deadline = Date.now() + timeoutMs;
  while (
    Date.now() < deadline &&
    serverProcess.exitCode === null &&
    serverProcess.signalCode === null
  ) {
    await delay(25);
  }
  if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
    try {
      kill(pid, "SIGKILL");
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ESRCH") {
        throw error;
      }
    }
  }
}

export function provisionE2ETlsIdentity(
  env,
  {
    repoRoot = process.cwd(),
    runOpenSsl = spawnSync,
    open = openSync,
    close = closeSync,
    unlink = unlinkSync,
  } = {},
) {
  const certFile = env.E2E_PROFILE_TLS_CERT_FILE;
  const caCertFile = env.E2E_PROFILE_TLS_CA_CERT_FILE;
  if (!certFile || !isAbsolute(certFile)) {
    throw new Error("E2E_PROFILE_TLS_CERT_FILE must be absolute.");
  }
  if (!caCertFile || !isAbsolute(caCertFile)) {
    throw new Error("E2E_PROFILE_TLS_CA_CERT_FILE must be absolute.");
  }
  mkdirSync(dirname(certFile), { mode: 0o700, recursive: true });
  const keyDescriptor = openAnonymousDescriptor(
    dirname(certFile),
    "proxy-key",
    open,
    unlink,
  );
  const caKeyDescriptor = openAnonymousDescriptor(
    dirname(certFile),
    "proxy-ca-key",
    open,
    unlink,
  );
  const csrFile = join(dirname(certFile), `proxy-${randomUUID()}.csr`);
  try {
    runRequiredCommand(
      runOpenSsl,
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:3072",
        "-sha256",
        "-days",
        "1",
        "-nodes",
        "-subj",
        `/CN=TextIQ E2E CA ${env.E2E_PROFILE_RUN_ID}`,
        "-addext",
        "basicConstraints=critical,CA:TRUE,pathlen:0",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
        "-keyout",
        "/proc/self/fd/3",
        "-out",
        caCertFile,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe", caKeyDescriptor],
      },
      "Unable to provision the deterministic E2E CA",
    );
    runRequiredCommand(
      runOpenSsl,
      "openssl",
      [
        "req",
        "-new",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-subj",
        `/CN=${env.E2E_PROFILE_HOSTNAME}`,
        "-addext",
        `subjectAltName=DNS:${env.E2E_PROFILE_HOSTNAME}`,
        "-addext",
        "extendedKeyUsage=serverAuth",
        "-keyout",
        "/proc/self/fd/3",
        "-out",
        csrFile,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe", keyDescriptor],
      },
      "Unable to provision the deterministic E2E server key",
    );
    runRequiredCommand(
      runOpenSsl,
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        csrFile,
        "-CA",
        caCertFile,
        "-CAkey",
        "/proc/self/fd/3",
        "-set_serial",
        `0x${randomBytes(16).toString("hex")}`,
        "-days",
        "1",
        "-sha256",
        "-copy_extensions",
        "copy",
        "-out",
        certFile,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe", caKeyDescriptor],
      },
      "Unable to sign the deterministic E2E server certificate",
    );
    close(caKeyDescriptor);
    safeUnlinkFile(csrFile, unlink);
    provisionChromiumTrust(env, { repoRoot, runCommand: runOpenSsl });
    chmodSync(certFile, 0o600);
    chmodSync(caCertFile, 0o600);
    env.E2E_PROFILE_TLS_SPKI_PIN = spkiPinFromCertificate(
      readFileSync(certFile),
    );
    env.E2E_PROFILE_TLS_KEY_FD = "3";
    return { keyDescriptor };
  } catch (error) {
    safeClose(caKeyDescriptor, close);
    safeUnlinkFile(csrFile, unlink);
    close(keyDescriptor);
    throw error;
  }
}

export function provisionChromiumTrust(
  env,
  { repoRoot = process.cwd(), runCommand = spawnSync } = {},
) {
  const browserHome = env.E2E_PROFILE_BROWSER_HOME;
  const caCertFile = env.E2E_PROFILE_TLS_CA_CERT_FILE;
  if (!browserHome || !isAbsolute(browserHome)) {
    throw new Error("E2E_PROFILE_BROWSER_HOME must be absolute.");
  }
  rmSync(browserHome, { force: true, recursive: true });
  const nssDirectory = join(browserHome, ".pki", "nssdb");
  mkdirSync(nssDirectory, { mode: 0o700, recursive: true });
  const database = `sql:${nssDirectory}`;
  runRequiredCommand(
    runCommand,
    "certutil",
    ["-N", "--empty-password", "-d", database],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
    "Unable to initialize the isolated Chromium NSS trust store",
  );
  runRequiredCommand(
    runCommand,
    "certutil",
    [
      "-A",
      "-d",
      database,
      "-n",
      `TextIQ E2E ${env.E2E_PROFILE_RUN_ID}`,
      "-t",
      "C,,",
      "-i",
      caCertFile,
    ],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
    "Unable to import the per-run CA into the isolated Chromium NSS trust store",
  );
}

function openAnonymousDescriptor(directory, label, open, unlink) {
  const path = join(directory, `.${label}-${process.pid}-${randomUUID()}`);
  const descriptor = open(path, "wx+", 0o600);
  unlink(path);
  return descriptor;
}

function runRequiredCommand(runCommand, command, args, options, label) {
  const result = runCommand(command, args, options);
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label}: ${result.stderr?.trim() || result.error?.message || `${command} failed`}`,
      { cause: result.error },
    );
  }
}

function safeClose(descriptor, close) {
  try {
    close(descriptor);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EBADF")
      throw error;
  }
}

function safeUnlinkFile(path, unlink) {
  try {
    unlink(path);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT")
      throw error;
  }
}

export function stopE2EProfileServer(
  pidFile,
  {
    existsFile = existsSync,
    readFile = readFileSync,
    removeFile = unlinkSync,
    kill = process.kill,
  } = {},
) {
  if (!isAbsolute(pidFile)) {
    throw new Error("E2E server PID file must use an absolute path.");
  }
  if (!existsFile(pidFile)) return;
  const rawPid = readFile(pidFile, "utf8").trim();
  if (!/^[1-9]\d*$/.test(rawPid)) {
    throw new Error(`Invalid E2E server PID file: ${pidFile}`);
  }
  const pid = Number(rawPid);
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw new Error(`Invalid E2E server PID file: ${pidFile}`);
  }
  try {
    kill(pid, "SIGTERM");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ESRCH") {
      throw error;
    }
  } finally {
    removeFile(pidFile);
  }
}

export function captureE2EProfileConfigFiles(repoRoot = process.cwd()) {
  return Object.fromEntries(
    ["tsconfig.json", "next-env.d.ts"].map((relativePath) => {
      const path = join(repoRoot, relativePath);
      return [path, existsSync(path) ? readFileSync(path, "utf8") : undefined];
    }),
  );
}

export function restoreE2EProfileConfigFiles(snapshot, distDir) {
  const tsconfigPath = Object.keys(snapshot).find((path) =>
    path.endsWith("tsconfig.json"),
  );
  const nextEnvPath = Object.keys(snapshot).find((path) =>
    path.endsWith("next-env.d.ts"),
  );

  if (tsconfigPath && snapshot[tsconfigPath] !== undefined) {
    restoreTsconfig(tsconfigPath, snapshot[tsconfigPath], distDir);
  }
  if (nextEnvPath) {
    restoreNextEnv(nextEnvPath, snapshot[nextEnvPath], distDir);
  }
}

export function removeGeneratedTypeIncludes(config, distDir) {
  const generatedIncludes = new Set([
    `${distDir}/types/**/*.ts`,
    `${distDir}/dev/types/**/*.ts`,
  ]);

  return {
    ...config,
    include: Array.isArray(config.include)
      ? config.include.filter((entry) => !generatedIncludes.has(entry))
      : config.include,
  };
}

function restoreTsconfig(path, originalContent, distDir) {
  if (!existsSync(path)) {
    return;
  }

  const currentContent = readFileSync(path, "utf8");
  if (currentContent === originalContent) {
    return;
  }

  try {
    const original = JSON.parse(originalContent);
    const current = removeGeneratedTypeIncludes(
      JSON.parse(currentContent),
      distDir,
    );
    if (isDeepStrictEqual(current, original)) {
      writeFileSync(path, originalContent);
    }
  } catch {
    // Leave concurrently edited configuration untouched.
  }
}

function restoreNextEnv(path, originalContent, distDir) {
  if (!existsSync(path)) {
    return;
  }

  const currentContent = readFileSync(path, "utf8");
  if (!currentContent.includes(distDir)) {
    return;
  }
  if (originalContent === undefined) {
    rmSync(path, { force: true });
  } else {
    writeFileSync(path, originalContent);
  }
}

export function reportE2EProfileFailure(error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runE2EProfile().catch(reportE2EProfileFailure);
}
