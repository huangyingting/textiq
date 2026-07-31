import { defineConfig, devices } from "@playwright/test";

import {
  resolveE2EOrigin,
  resolveE2EProfileGlobalTimeout,
} from "./scripts/e2e-origin.mjs";

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
process.env.E2E_BASE_URL = baseURL;

const deterministicProfile = process.env.E2E_PROFILE === "1";
if (deterministicProfile && process.env.E2E_PROFILE_EXTERNAL_SERVER !== "1") {
  throw new Error(
    "The deterministic profile must be launched through `npm run test:e2e:profile` so its secure HTTPS/WSS server is available.",
  );
}
const startWebServer =
  process.env.E2E_WEB_SERVER === "1" && !deterministicProfile;
const webServerCommand = process.env.E2E_WEB_SERVER_COMMAND ?? "npm run dev";
const webServerTimeoutMs = positiveIntegerEnv(
  process.env.E2E_WEB_SERVER_TIMEOUT_MS,
  240_000,
);
const reuseExistingServer = booleanEnv(
  process.env.E2E_REUSE_EXISTING_SERVER,
  !process.env.CI,
);
const webServerReadinessURL = baseURL;
const deterministicProfileGlobalTimeoutMs = deterministicProfile
  ? resolveE2EProfileGlobalTimeout(process.env)
  : undefined;
const profileHostname = deterministicProfile
  ? requiredProfileHostname()
  : undefined;
const profileGrep = process.env.E2E_PROFILE_GREP
  ? new RegExp(process.env.E2E_PROFILE_GREP)
  : undefined;
const deterministicProfileSpecs = [
  "auth/authenticated-nested-routes.spec.ts",
  "editor/block-id-preservation.spec.ts",
  "editor/document-editor-profile.spec.ts",
  "editor/document-table-autosave.spec.ts",
  "import/import-roundtrip.spec.ts",
  "public-render/share-fallback.spec.ts",
  "presentation/focus-and-mobile-controls-regression.spec.ts",
  "presentation/overlap-selection-regression.spec.ts",
  "presentation/present-export.spec.ts",
  "presentation/pointer-interactions.spec.ts",
  "presentation/presentation-controls.spec.ts",
  "presentation/slide-asset-upload.spec.ts",
  "presentation/slide-delete-persistence.spec.ts",
  "presentation/slides-conflict-recovery.spec.ts",
  "presentation/slides-layout-screenshots.spec.ts",
  "presentation/slides-smoke.spec.ts",
  "presentation/touch-controls.spec.ts",
  "ui-matrix/account-lifecycle-ui.spec.ts",
  "ui-matrix/auth-public-ui.spec.ts",
  "ui-matrix/catalog.spec.ts",
  "ui-matrix/dashboard-document-lifecycle-ui.spec.ts",
  "ui-matrix/document-editor-ui.spec.ts",
  "ui-matrix/presentation-ui.spec.ts",
  "ui-matrix/public-render-ui.spec.ts",
  "ui-matrix/workspace-billing-brand-ui.spec.ts",
];
const explicitProfileSpecs = parseExplicitProfileSpecs(
  process.env.E2E_PROFILE_EXPLICIT_SPECS,
);
const profileSpecs = [
  ...new Set([...deterministicProfileSpecs, ...explicitProfileSpecs]),
];

export default defineConfig({
  // scripts/**/*.mjs files are native ESM and must not go through Playwright's
  // Babel/esbuild transpiler. Without this exclusion the transpiler converts
  // their `export` statements to CJS `exports.X = ...`, which then fails at
  // link time with "does not provide an export named '...'" because .mjs
  // files are always loaded as ESM by Node.js.
  build: {
    external: ["scripts/**/*.mjs"],
  },
  testDir: "e2e",
  testMatch: deterministicProfile ? profileSpecs : /.*\.spec\.ts/,
  grep: deterministicProfile ? profileGrep : undefined,
  timeout: deterministicProfile ? 180_000 : undefined,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: deterministicProfile ? 0 : process.env.CI ? 2 : 0,
  workers: deterministicProfile
    ? positiveIntegerEnv(process.env.E2E_PROFILE_WORKERS, 1)
    : process.env.CI
      ? 1
      : undefined,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: deterministicProfile
    ? "./scripts/e2e-global-setup.mjs"
    : undefined,
  globalTimeout: deterministicProfile
    ? deterministicProfileGlobalTimeoutMs
    : undefined,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: deterministicProfile
          ? {
              args: [
                `--host-resolver-rules=MAP ${profileHostname} 127.0.0.1`,
                "--no-first-run",
              ],
            }
          : undefined,
      },
    },
  ],
  webServer: startWebServer
    ? {
        command: webServerCommand,
        url: webServerReadinessURL,
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

function parseExplicitProfileSpecs(value: string | undefined): string[] {
  if (!value) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("E2E_PROFILE_EXPLICIT_SPECS must be valid JSON.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.startsWith("/") ||
        entry.includes("\\") ||
        entry
          .split("/")
          .some((segment) => segment === "." || segment === "..") ||
        !entry.endsWith(".spec.ts"),
    )
  ) {
    throw new Error(
      "E2E_PROFILE_EXPLICIT_SPECS must contain relative E2E spec paths.",
    );
  }
  return parsed;
}

function requiredProfileHostname() {
  const hostname = process.env.E2E_PROFILE_HOSTNAME;
  if (!hostname || !/^r-[a-f0-9]{32}\.localhost$/.test(hostname)) {
    throw new Error(
      "The deterministic profile requires its validated per-run loopback hostname.",
    );
  }
  return hostname;
}
