import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright end-to-end configuration for TextIQ (issue #107).
 *
 * These specs live exclusively under `e2e/` so the unit gate
 * (`npm test`, which runs node:test over the src test files) never picks them
 * up. They are run separately via `npm run test:e2e` against a running dev
 * server.
 *
 * The base URL is configurable from the environment (`E2E_BASE_URL`, falling
 * back to `BASE_URL`) and defaults to http://localhost:3000.
 *
 * No mandatory `webServer` is configured: in CI the required unit gate must not
 * spin up a server. To have Playwright start the dev server for you locally,
 * set `E2E_WEB_SERVER=1` (see `e2e/README.md`).
 */
const baseURL =
  process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:4000";

const startWebServer = process.env.E2E_WEB_SERVER === "1";
const deterministicProfile = process.env.E2E_PROFILE === "1";
const deterministicProfileSpecs = [
  "authenticated-nested-routes.spec.ts",
  "document-editor-profile.spec.ts",
  "import-roundtrip.spec.ts",
  "present-export.spec.ts",
  "slide-asset-upload.spec.ts",
  "slides-layout-screenshots.spec.ts",
  "ui-matrix/*.spec.ts",
];

export default defineConfig({
  testDir: "e2e",
  testMatch: deterministicProfile ? deterministicProfileSpecs : /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
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
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      }
    : undefined,
});
