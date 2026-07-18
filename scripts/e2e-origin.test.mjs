import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { deriveAuthenticatedE2EHostname } from "./e2e-origin.mjs";
import { resolveE2EWebServerRuntime } from "./e2e-profile-runtime.mjs";

test("profile runtime origin helper is a callable named ESM export", () => {
  const runId = "origin-module-contract";
  const nonce = "a".repeat(64);
  const hostname = deriveAuthenticatedE2EHostname(runId, nonce);
  const runtimeDirectory = resolve(".next", "e2e-profile", runId);
  const runtime = resolveE2EWebServerRuntime({
    E2E_PROFILE_RUN_ID: runId,
    E2E_PROFILE_RUN_NONCE: nonce,
    E2E_PROFILE_HOSTNAME: hostname,
    E2E_PROFILE_SERVER_PID_FILE: resolve(runtimeDirectory, "server.pid"),
    E2E_PROFILE_IDENTITY_FILE: resolve(
      runtimeDirectory,
      "listener-identity.json",
    ),
    E2E_PROFILE_CREDENTIAL_GATE_FILE: resolve(
      runtimeDirectory,
      "credential-gate.json",
    ),
    E2E_PROFILE_COMPROMISE_FILE: resolve(
      runtimeDirectory,
      "compromise-latch.json",
    ),
    E2E_PROFILE_TLS_CERT_FILE: resolve(runtimeDirectory, "proxy-cert.pem"),
    E2E_PROFILE_TLS_CA_CERT_FILE: resolve(runtimeDirectory, "proxy-ca.pem"),
  });

  assert.equal(typeof deriveAuthenticatedE2EHostname, "function");
  assert.match(hostname, /^r-[a-f0-9]{32}\.localhost$/);
  assert.equal(runtime.hostname, hostname);
});
