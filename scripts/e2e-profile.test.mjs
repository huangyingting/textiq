import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { resolveE2EOrigin, resolveE2EOriginConfig } from "./e2e-origin.mjs";
import {
  buildE2EProfileEnv,
  E2E_PROFILE_STEPS,
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

  assert.equal(commands.length, E2E_PROFILE_STEPS.length);
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
