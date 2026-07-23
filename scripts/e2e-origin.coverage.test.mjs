import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAuthenticatedE2EHostname,
  parseAuthenticatedE2EAppUrl,
  parseAuthenticatedE2EProfileOrigin,
  parseAuthenticatedE2EReadinessUrl,
  resolveE2EOrigin,
  resolveE2EOriginConfig,
  resolveE2EProfileGlobalTimeout,
} from "./e2e-origin.mjs";

function profileEnv() {
  const runId = "origin-coverage";
  const nonce = "c".repeat(64);
  const hostname = deriveAuthenticatedE2EHostname(runId, nonce);
  return {
    runId,
    nonce,
    hostname,
    env: {
      E2E_PROFILE_RUN_ID: runId,
      E2E_PROFILE_RUN_NONCE: nonce,
      E2E_PROFILE_HOSTNAME: hostname,
    },
  };
}

test("authenticated E2E origin helpers reject wrong protocols before hostname checks", () => {
  const runId = "protocol-coverage";
  const nonce = "b".repeat(64);
  const hostname = deriveAuthenticatedE2EHostname(runId, nonce);
  const env = {
    E2E_PROFILE_RUN_ID: runId,
    E2E_PROFILE_RUN_NONCE: nonce,
    E2E_PROFILE_HOSTNAME: hostname,
  };

  assert.throws(
    () =>
      parseAuthenticatedE2EProfileOrigin(
        `http://${hostname}:443`,
        "E2E_BASE_URL",
        env,
      ),
    /E2E_BASE_URL must use http: with the exact lowercase http:\/\/ prefix/,
  );
  assert.throws(
    () =>
      parseAuthenticatedE2EReadinessUrl(
        "https://127.0.0.1:4000/ready",
        "E2E_PROFILE_READINESS_URL",
      ),
    /E2E_PROFILE_READINESS_URL must use http:/,
  );
  assert.throws(
    () =>
      parseAuthenticatedE2EAppUrl(
        "https://127.0.0.1:4000",
        "E2E_PROFILE_APP_URL",
      ),
    /E2E_PROFILE_APP_URL must use http:/,
  );
});

test("resolveE2EOriginConfig preserves explicit default ports and wildcard hosts", () => {
  assert.deepEqual(
    resolveE2EOriginConfig({
      E2E_BASE_URL: "https://example.test:443",
      HOST: "0.0.0.0",
    }),
    {
      origin: "https://example.test:443",
      port: "443",
      serverHost: "0.0.0.0",
    },
  );

  assert.deepEqual(resolveE2EOriginConfig({ HOST: "::", PORT: "4100" }), {
    origin: "http://127.0.0.1:4100",
    port: "4100",
    serverHost: "::",
  });
});

test("resolveE2EOriginConfig validates configured URL and PORT combinations", () => {
  assert.deepEqual(
    resolveE2EOriginConfig({
      E2E_BASE_URL: "http://example.test",
      PORT: "4100",
    }),
    {
      origin: "http://example.test:4100",
      port: "4100",
      serverHost: "example.test",
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
  assert.equal(
    resolveE2EOrigin({
      E2E_PROFILE: "1",
      E2E_BASE_URL: "http://127.0.0.1:4300",
      PORT: "9999",
    }),
    "http://127.0.0.1:4300",
  );

  assert.throws(
    () =>
      resolveE2EOriginConfig({
        E2E_BASE_URL: "http://example.test:4000",
        PORT: "4100",
      }),
    /E2E_BASE_URL port 4000 does not match PORT 4100/,
  );
  assert.throws(
    () => resolveE2EOriginConfig({ PORT: "0" }),
    /PORT must be an integer from 1 to 65535/,
  );
  assert.throws(
    () => resolveE2EOriginConfig({ E2E_BASE_URL: "http://user@example.test" }),
    /must not contain credentials/,
  );
  assert.throws(
    () => resolveE2EOriginConfig({ E2E_BASE_URL: "http://example.test/path" }),
    /must be an origin without a path/,
  );
});

test("authenticated profile URL parsing preserves canonical explicit ports", () => {
  const { hostname, env } = profileEnv();
  const origin = parseAuthenticatedE2EProfileOrigin(
    `https://${hostname}:443`,
    "E2E_BASE_URL",
    env,
  );
  assert.equal(origin.port, "443");
  assert.equal(origin.toString(), `https://${hostname}:443/`);
  assert.equal(origin.toJSON(), `https://${hostname}:443/`);

  const readiness = parseAuthenticatedE2EReadinessUrl(
    "http://127.0.0.1:4000/ready",
  );
  assert.equal(readiness.toString(), "http://127.0.0.1:4000/ready");

  const app = parseAuthenticatedE2EAppUrl("http://127.0.0.1:4000");
  assert.equal(app.toString(), "http://127.0.0.1:4000/");
});

test("authenticated profile URL parsing reports malformed run metadata and URLs", () => {
  const { hostname, env } = profileEnv();

  assert.throws(
    () => deriveAuthenticatedE2EHostname("-bad", "c".repeat(64)),
    /run id is invalid/,
  );
  assert.throws(
    () => deriveAuthenticatedE2EHostname("good", "z".repeat(64)),
    /nonce must be 32 random bytes/,
  );
  assert.throws(
    () =>
      parseAuthenticatedE2EProfileOrigin(
        `https://${hostname}:443/path`,
        "E2E_BASE_URL",
        env,
      ),
    /without a path/,
  );
  assert.throws(
    () =>
      parseAuthenticatedE2EProfileOrigin(
        `https://user@${hostname}:443`,
        "E2E_BASE_URL",
        env,
      ),
    /must not contain credentials/,
  );
  assert.throws(
    () =>
      parseAuthenticatedE2EProfileOrigin(
        "https://wrong.localhost:443",
        "E2E_BASE_URL",
        env,
      ),
    /must use the exact per-run hostname/,
  );
  assert.throws(
    () =>
      parseAuthenticatedE2EProfileOrigin(
        `https://${hostname}`,
        "E2E_BASE_URL",
        env,
      ),
    /explicit canonical decimal port/,
  );
  assert.throws(
    () =>
      parseAuthenticatedE2EProfileOrigin(
        `https://${hostname}:0443`,
        "E2E_BASE_URL",
        env,
      ),
    /explicit canonical decimal port/,
  );
});

test("authenticated internal URLs enforce loopback, exact paths, and explicit ports", () => {
  assert.throws(
    () => parseAuthenticatedE2EReadinessUrl("http://127.0.0.1:4000/ready?x=1"),
    /exact \/ready path/,
  );
  assert.throws(
    () => parseAuthenticatedE2EReadinessUrl("http://localhost:4000/ready"),
    /exact IPv4 loopback/,
  );
  assert.throws(
    () => parseAuthenticatedE2EReadinessUrl("http://127.0.0.1/ready"),
    /explicit canonical decimal port/,
  );
  assert.throws(
    () => parseAuthenticatedE2EReadinessUrl("http://127.0.0.1:70000/ready"),
    /absolute URL/,
  );
  assert.throws(
    () => parseAuthenticatedE2EAppUrl("http://127.0.0.1:4000/app"),
    /without a path/,
  );
  assert.throws(
    () => parseAuthenticatedE2EAppUrl("http://user@127.0.0.1:4000"),
    /must not contain credentials/,
  );
});

test("resolveE2EProfileGlobalTimeout uses profile-aware defaults and honours override", () => {
  // Full local profile: 60-minute default.
  assert.equal(resolveE2EProfileGlobalTimeout({}), 60 * 60_000);
  // CI required-profile: bounded 18-minute default.
  assert.equal(
    resolveE2EProfileGlobalTimeout({ E2E_PROFILE_GREP: "@required-profile" }),
    18 * 60_000,
  );
  // Any other grep falls back to the full-profile budget.
  assert.equal(
    resolveE2EProfileGlobalTimeout({ E2E_PROFILE_GREP: "@smoke" }),
    60 * 60_000,
  );
  // Explicit positive override wins regardless of grep.
  assert.equal(
    resolveE2EProfileGlobalTimeout({ E2E_GLOBAL_TIMEOUT_MS: "600000" }),
    600_000,
  );
  assert.equal(
    resolveE2EProfileGlobalTimeout({
      E2E_PROFILE_GREP: "@required-profile",
      E2E_GLOBAL_TIMEOUT_MS: "720000",
    }),
    720_000,
  );
  // Non-positive or non-numeric override falls back to the profile default.
  for (const bad of ["0", "-1", "nan", "", "  "]) {
    assert.equal(
      resolveE2EProfileGlobalTimeout({ E2E_GLOBAL_TIMEOUT_MS: bad }),
      60 * 60_000,
      `expected fallback for E2E_GLOBAL_TIMEOUT_MS=${JSON.stringify(bad)}`,
    );
  }
});
