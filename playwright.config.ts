import { defineConfig, devices } from "@playwright/test";

import { resolveE2EOrigin } from "./scripts/e2e-origin.mjs";

/**
 * Playwright end-to-end configuration for TextIQ (issue #107).
 *
 * These specs live exclusively under `e2e/` so the unit gate
 * (`npm test`, which runs node:test over the src test files) never picks them
 * up. They are run separately via `npm run test:e2e` against a running dev
 * server.
 *
 * The base URL is configurable from the environment (`E2E_BASE_URL`, falling
 * back to `BASE_URL`) and defaults to http://127.0.0.1:4000.
 *
 * No mandatory `webServer` is configured: the required unit gate must not spin
 * up a server. To have Playwright start the app for you, set `E2E_WEB_SERVER=1`
 * (see `e2e/README.md`). `E2E_WEB_SERVER_COMMAND` can point at a prebuilt
 * production server for deterministic CI runs.
 */
const baseURL = resolveE2EOrigin(process.env);

const startWebServer = process.env.E2E_WEB_SERVER === "1";
const webServerCommand = process.env.E2E_WEB_SERVER_COMMAND ?? "npm run dev";
const webServerTimeoutMs = positiveIntegerEnv(
  process.env.E2E_WEB_SERVER_TIMEOUT_MS,
  240_000,
);
const reuseExistingServer = booleanEnv(
  process.env.E2E_REUSE_EXISTING_SERVER,
  !process.env.CI,
);
const deterministicProfile = process.env.E2E_PROFILE === "1";
const deterministicProfileTimeoutMs = 18 * 60_000;
const profileGrep = process.env.E2E_PROFILE_GREP
  ? new RegExp(process.env.E2E_PROFILE_GREP)
  : undefined;
const deterministicProfileSpecs = [
  "auth/authenticated-nested-routes.spec.ts",
  "editor/document-editor-profile.spec.ts",
  "import/import-roundtrip.spec.ts",
  "presentation/present-export.spec.ts",
  "presentation/slide-asset-upload.spec.ts",
  "presentation/slides-layout-screenshots.spec.ts",
  "ui-matrix/catalog.spec.ts",
];

export default defineConfig({
  testDir: "e2e",
  testMatch: deterministicProfile ? deterministicProfileSpecs : /.*\.spec\.ts/,
  grep: deterministicProfile ? profileGrep : undefined,
  timeout: deterministicProfile ? 180_000 : undefined,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: deterministicProfile ? 0 : process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  globalTimeout: deterministicProfile
    ? deterministicProfileTimeoutMs
    : undefined,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: startWebServer
    ? {
        command: webServerCommand,
        url: baseURL,
        reuseExistingServer,
        timeout: webServerTimeoutMs,
      }
    : undefined,
});

function booleanEnv(value: string | undefined, fallback: boolean) {
  if (value === "1" || value === "true") {
    return true;
  }

  if (value === "0" || value === "false") {
    return false;
  }

  return fallback;
}

function positiveIntegerEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
