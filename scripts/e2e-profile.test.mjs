import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { resolveE2EOrigin, resolveE2EOriginConfig } from "./e2e-origin.mjs";
import {
  buildE2EProfileEnv,
  buildE2EProfileSteps,
  captureE2EProfileConfigFiles,
  removeGeneratedTypeIncludes,
  restoreE2EProfileConfigFiles,
  runE2EProfile,
} from "./e2e-profile.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

test("E2E origin defaults to one loopback origin and honors host/port overrides", () => {
  assert.deepEqual(resolveE2EOriginConfig({}), {
    origin: "http://127.0.0.1:4000",
    port: "4000",
    serverHost: "127.0.0.1",
  });
  assert.deepEqual(
    resolveE2EOriginConfig({ HOST: "localhost", PORT: "4555" }),
    {
      origin: "http://localhost:4555",
      port: "4555",
      serverHost: "localhost",
    },
  );
  assert.equal(
    resolveE2EOrigin({ HOST: "0.0.0.0", PORT: "4666" }),
    "http://127.0.0.1:4666",
  );
  assert.equal(
    resolveE2EOrigin({ HOST: "[::]", PORT: "4667" }),
    "http://127.0.0.1:4667",
  );
  assert.equal(
    resolveE2EOrigin({ HOST: "::1", PORT: "4668" }),
    "http://[::1]:4668",
  );
  assert.equal(
    resolveE2EOrigin({ HOST: "[::1]", PORT: "4669" }),
    "http://[::1]:4669",
  );
  assert.equal(
    resolveE2EOrigin({ BASE_URL: "http://localhost:4670" }),
    "http://localhost:4670",
  );
  assert.deepEqual(
    resolveE2EOriginConfig({ E2E_BASE_URL: "http://localhost" }),
    {
      origin: "http://localhost",
      port: "80",
      serverHost: "localhost",
    },
  );
});

test("E2E origin safely normalizes explicit base URL overrides", () => {
  assert.deepEqual(
    resolveE2EOriginConfig({
      E2E_BASE_URL: "http://LOCALHOST:4777/",
    }),
    {
      origin: "http://localhost:4777",
      port: "4777",
      serverHost: "localhost",
    },
  );
  assert.equal(
    resolveE2EOrigin({
      E2E_BASE_URL: "http://localhost/",
      PORT: "4888",
    }),
    "http://localhost:4888",
  );
  assert.throws(
    () =>
      resolveE2EOrigin({
        E2E_BASE_URL: "http://localhost:4777",
        PORT: "4888",
      }),
    /does not match PORT/,
  );
  assert.throws(
    () => resolveE2EOrigin({ E2E_BASE_URL: "http://localhost:4777/app" }),
    /must be an origin/,
  );
  assert.throws(
    () => resolveE2EOrigin({ E2E_BASE_URL: "file:///workspace" }),
    /must use http: or https:/,
  );
  assert.throws(
    () => resolveE2EOrigin({ E2E_BASE_URL: "not a URL" }),
    /must be an absolute HTTP\(S\) URL/,
  );
  assert.throws(
    () => resolveE2EOrigin({ E2E_BASE_URL: "http://user:pass@localhost" }),
    /must not contain credentials/,
  );
  assert.throws(
    () => resolveE2EOrigin({ E2E_BASE_URL: "http://:pass@localhost" }),
    /must not contain credentials/,
  );
  assert.throws(
    () => resolveE2EOrigin({ E2E_BASE_URL: "http://localhost/?query=1" }),
    /must be an origin/,
  );
  assert.throws(
    () => resolveE2EOrigin({ E2E_BASE_URL: "http://localhost/#fragment" }),
    /must be an origin/,
  );
  assert.throws(
    () => resolveE2EOrigin({ PORT: "0" }),
    /PORT must be an integer/,
  );
  assert.throws(
    () => resolveE2EOrigin({ PORT: "12.5" }),
    /PORT must be an integer/,
  );
  assert.throws(
    () => resolveE2EOrigin({ PORT: "65536" }),
    /PORT must be an integer/,
  );
  assert.deepEqual(
    resolveE2EOriginConfig({
      E2E_BASE_URL: "http://localhost:4777",
      PORT: "4777",
      HOST: "0.0.0.0",
    }),
    {
      origin: "http://localhost:4777",
      port: "4777",
      serverHost: "0.0.0.0",
    },
  );
  assert.deepEqual(
    resolveE2EOriginConfig({
      E2E_BASE_URL: "https://[::1]/",
      HOST: "::",
    }),
    {
      origin: "https://[::1]",
      port: "443",
      serverHost: "::",
    },
  );
  assert.deepEqual(
    resolveE2EOriginConfig({
      E2E_BASE_URL: "https://[::1]/",
    }),
    {
      origin: "https://[::1]",
      port: "443",
      serverHost: "::1",
    },
  );
  assert.equal(
    resolveE2EOrigin({ HOST: "::", PORT: "4998" }),
    "http://127.0.0.1:4998",
  );
});

test("self-contained runner propagates one canonical origin to every boundary", () => {
  const env = buildE2EProfileEnv(
    {
      E2E_BASE_URL: "http://localhost:4999/",
      AUTH_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:2",
      E2E_REUSE_EXISTING_SERVER: "1",
    },
    { runId: "runner-test" },
  );

  assert.equal(env.E2E_BASE_URL, "http://localhost:4999");
  assert.equal(env.AUTH_URL, env.E2E_BASE_URL);
  assert.equal(env.NEXT_PUBLIC_APP_URL, env.E2E_BASE_URL);
  assert.equal(env.HOST, "localhost");
  assert.equal(env.PORT, "4999");
  assert.equal(env.E2E_REUSE_EXISTING_SERVER, "0");
  assert.equal(
    env.E2E_PROFILE_DIST_DIR,
    join(".next", "e2e-profile", "runner-test"),
  );
  assert.throws(
    () => buildE2EProfileEnv({ E2E_BASE_URL: "https://localhost" }),
    /requires an http:\/\//,
  );
  assert.deepEqual(buildE2EProfileSteps({})[3], [
    "Install Chromium",
    "npx",
    ["playwright", "install", "chromium"],
  ]);
  assert.deepEqual(buildE2EProfileSteps({ E2E_INSTALL_BROWSER_DEPS: "1" })[3], [
    "Install Chromium",
    "npx",
    ["playwright", "install", "--with-deps", "chromium"],
  ]);
  const explicit = buildE2EProfileEnv(
    {
      DB_PROVIDER: "postgres",
      DATABASE_URL: "postgresql://example.test/db",
      AUTH_SECRET: "test-secret",
      AUTH_LOGIN_RATE_LIMIT: "42",
      E2E_PROFILE_SERVER: "custom",
      E2E_WEB_SERVER_COMMAND: "node custom-server.mjs",
      E2E_WEB_SERVER_TIMEOUT_MS: "12345",
      PORT: "4997",
    },
    { runId: "explicit-env" },
  );
  assert.equal(explicit.DB_PROVIDER, "postgres");
  assert.equal(explicit.DATABASE_URL, "postgresql://example.test/db");
  assert.equal(explicit.AUTH_SECRET, "test-secret");
  assert.equal(explicit.AUTH_LOGIN_RATE_LIMIT, "42");
  assert.equal(explicit.E2E_PROFILE_SERVER, "custom");
  assert.equal(explicit.E2E_WEB_SERVER_COMMAND, "node custom-server.mjs");
  assert.equal(explicit.E2E_WEB_SERVER_TIMEOUT_MS, "12345");
  assert.equal(buildE2EProfileSteps()[3][2].at(-1), "chromium");
});

test("self-contained runner passes the canonical env to every command and cleans its dist dir", () => {
  const commands = [];
  const cleanupEvents = [];

  runE2EProfile({
    argv: ["node", "scripts/e2e-profile.mjs"],
    processEnv: { PORT: "5111" },
    runCommand: (command, args, options) => {
      commands.push({ command, args, env: options.env });
      return { status: 0 };
    },
    stdout: () => {},
    cleanup: (path) => cleanupEvents.push(["dist", path]),
    captureConfig: () => ({ snapshot: "config" }),
    restoreConfig: (snapshot, path) =>
      cleanupEvents.push(["config", snapshot, path]),
  });

  assert.equal(commands.length, buildE2EProfileSteps({}).length);
  for (const command of commands) {
    assert.equal(command.env.E2E_BASE_URL, "http://127.0.0.1:5111");
    assert.equal(command.env.AUTH_URL, command.env.E2E_BASE_URL);
    assert.equal(command.env.NEXT_PUBLIC_APP_URL, command.env.E2E_BASE_URL);
  }
  assert.deepEqual(cleanupEvents, [
    ["dist", commands[0].env.E2E_PROFILE_DIST_DIR],
    ["config", { snapshot: "config" }, commands[0].env.E2E_PROFILE_DIST_DIR],
  ]);
});

test("self-contained runner lists its command plan without running commands", () => {
  const output = [];
  const commands = [];

  runE2EProfile({
    argv: ["node", "scripts/e2e-profile.mjs", "--list"],
    processEnv: {},
    runCommand: (...args) => commands.push(args),
    stdout: (line) => output.push(line),
    captureConfig: () => ({}),
  });

  assert.deepEqual(commands, []);
  assert.equal(output.length, 5);
  assert.match(output[3], /playwright install chromium/);
});

test("self-contained runner cleans its dist dir before reporting a command failure", () => {
  const cleaned = [];
  let exitCode;

  runE2EProfile({
    argv: ["node", "scripts/e2e-profile.mjs"],
    processEnv: { PORT: "5112" },
    runCommand: () => ({ status: 7 }),
    stdout: () => {},
    cleanup: (path) => cleaned.push(path),
    captureConfig: () => ({}),
    restoreConfig: () => {},
    exit: (code) => {
      exitCode = code;
    },
  });

  assert.equal(exitCode, 7);
  assert.equal(cleaned.length, 1);
});

test("self-contained runner maps a signaled command failure to exit code one", () => {
  let exitCode;

  runE2EProfile({
    argv: ["node", "scripts/e2e-profile.mjs"],
    processEnv: { PORT: "5113" },
    runCommand: () => ({ status: null }),
    stdout: () => {},
    cleanup: () => {},
    captureConfig: () => ({}),
    restoreConfig: () => {},
    exit: (code) => {
      exitCode = code;
    },
  });

  assert.equal(exitCode, 1);
});

test("profile cleanup removes only the generated Next type includes", () => {
  const config = {
    compilerOptions: { strict: true },
    include: [
      "**/*.ts",
      ".next/e2e-profile/run-1/types/**/*.ts",
      ".next/e2e-profile/run-1/dev/types/**/*.ts",
      ".next/e2e-profile/other/types/**/*.ts",
    ],
  };

  assert.deepEqual(
    removeGeneratedTypeIncludes(config, ".next/e2e-profile/run-1"),
    {
      compilerOptions: { strict: true },
      include: ["**/*.ts", ".next/e2e-profile/other/types/**/*.ts"],
    },
  );
});

test("profile cleanup restores Next-generated config drift", (t) => {
  const root = createTestFixtureRoot("e2e-profile-config-cleanup", t);
  const tsconfigPath = join(root, "tsconfig.json");
  const nextEnvPath = join(root, "next-env.d.ts");
  const distDir = ".next/e2e-profile/run-1";
  const originalTsconfig = `${JSON.stringify(
    {
      compilerOptions: { strict: true },
      include: ["**/*.ts"],
    },
    null,
    2,
  )}\n`;
  const originalNextEnv = 'import "./.next/dev/types/routes.d.ts";\n';
  const snapshot = {
    [tsconfigPath]: originalTsconfig,
    [nextEnvPath]: originalNextEnv,
  };

  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: { strict: true },
        include: [
          "**/*.ts",
          `${distDir}/types/**/*.ts`,
          `${distDir}/dev/types/**/*.ts`,
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(nextEnvPath, `import "./${distDir}/dev/types/routes.d.ts";\n`);

  restoreE2EProfileConfigFiles(snapshot, distDir);

  assert.equal(readFileSync(tsconfigPath, "utf8"), originalTsconfig);
  assert.equal(readFileSync(nextEnvPath, "utf8"), originalNextEnv);
});

test("profile config capture and cleanup handle missing and concurrent files", (t) => {
  const root = createTestFixtureRoot("e2e-profile-config-edges", t);
  const tsconfigPath = join(root, "tsconfig.json");
  const nextEnvPath = join(root, "next-env.d.ts");
  const originalTsconfig = '{"include":["**/*.ts"]}\n';
  writeFileSync(tsconfigPath, originalTsconfig);

  const snapshot = captureE2EProfileConfigFiles(root);
  assert.equal(snapshot[tsconfigPath], originalTsconfig);
  assert.equal(snapshot[nextEnvPath], undefined);

  restoreE2EProfileConfigFiles(snapshot, ".next/e2e-profile/run");
  assert.equal(readFileSync(tsconfigPath, "utf8"), originalTsconfig);

  writeFileSync(tsconfigPath, "{invalid");
  writeFileSync(
    nextEnvPath,
    'import "./.next/e2e-profile/run/dev/types/routes.d.ts";\n',
  );
  restoreE2EProfileConfigFiles(snapshot, ".next/e2e-profile/run");
  assert.equal(readFileSync(tsconfigPath, "utf8"), "{invalid");
  assert.equal(existsSync(nextEnvPath), false);

  rmSync(tsconfigPath);
  restoreE2EProfileConfigFiles(snapshot, ".next/e2e-profile/run");
});

test("profile CLI entry point supports list mode", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/e2e-profile.mjs", "--list"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PORT: "5333" },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Run deterministic E2E profile/);
});

test("Playwright baseURL and webServer use the same normalized origin", () => {
  const config = loadPlaywrightConfig({
    E2E_BASE_URL: "http://LOCALHOST:5222/",
    E2E_WEB_SERVER: "1",
    E2E_REUSE_EXISTING_SERVER: "0",
  });

  assert.equal(config.baseURL, "http://localhost:5222");
  assert.equal(config.webServerUrl, config.baseURL);
  assert.equal(config.reuseExistingServer, false);
});

function loadPlaywrightConfig(overrides) {
  const configUrl = pathToFileURL(
    join(process.cwd(), "playwright.config.ts"),
  ).href;
  const source = `
    import config from ${JSON.stringify(configUrl)};
    const resolved = config.default ?? config;
    process.stdout.write(JSON.stringify({
      baseURL: resolved.use?.baseURL,
      webServerUrl: resolved.webServer?.url,
      reuseExistingServer: resolved.webServer?.reuseExistingServer,
    }));
  `;
  const env = { ...process.env };
  for (const name of [
    "BASE_URL",
    "E2E_BASE_URL",
    "E2E_WEB_SERVER",
    "E2E_REUSE_EXISTING_SERVER",
    "HOST",
    "PORT",
  ]) {
    delete env[name];
  }
  Object.assign(env, overrides);

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", source],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
