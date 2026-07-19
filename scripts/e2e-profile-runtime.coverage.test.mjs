import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { deriveAuthenticatedE2EHostname } from "./e2e-origin.mjs";
import { resolveE2EWebServerRuntime } from "./e2e-profile-runtime.mjs";

function runtimeEnv(overrides = {}) {
  const runId = "runtime-coverage";
  const nonce = "4".repeat(64);
  const dir = join(process.cwd(), ".tmp", "test-fixtures", "runtime-coverage");
  return {
    E2E_PROFILE_RUN_ID: runId,
    E2E_PROFILE_RUN_NONCE: nonce,
    E2E_PROFILE_HOSTNAME: deriveAuthenticatedE2EHostname(runId, nonce),
    E2E_PROFILE_SERVER_PID_FILE: join(dir, "server.pid"),
    E2E_PROFILE_IDENTITY_FILE: join(dir, "identity.json"),
    E2E_PROFILE_CREDENTIAL_GATE_FILE: join(dir, "gate.json"),
    E2E_PROFILE_COMPROMISE_FILE: join(dir, "compromise.json"),
    E2E_PROFILE_TLS_CERT_FILE: join(dir, "cert.pem"),
    E2E_PROFILE_TLS_CA_CERT_FILE: join(dir, "ca.pem"),
    ...overrides,
  };
}

test("profile runtime accepts only derived hostnames and co-located absolute files", () => {
  const env = runtimeEnv();
  assert.deepEqual(resolveE2EWebServerRuntime(env), {
    compromiseFile: env.E2E_PROFILE_COMPROMISE_FILE,
    credentialGateFile: env.E2E_PROFILE_CREDENTIAL_GATE_FILE,
    hostname: env.E2E_PROFILE_HOSTNAME,
    identityFile: env.E2E_PROFILE_IDENTITY_FILE,
    nonce: env.E2E_PROFILE_RUN_NONCE,
    pidFile: env.E2E_PROFILE_SERVER_PID_FILE,
    runId: env.E2E_PROFILE_RUN_ID,
    tlsCaCertFile: env.E2E_PROFILE_TLS_CA_CERT_FILE,
    tlsCertFile: env.E2E_PROFILE_TLS_CERT_FILE,
  });

  for (const overrides of [
    { E2E_PROFILE_RUN_ID: "-bad" },
    { E2E_PROFILE_RUN_NONCE: "not-hex" },
    { E2E_PROFILE_HOSTNAME: "wrong.localhost" },
    { E2E_PROFILE_SERVER_PID_FILE: "relative.pid" },
    {
      E2E_PROFILE_TLS_CA_CERT_FILE: join(
        process.cwd(),
        ".tmp",
        "test-fixtures",
        "other-runtime",
        "ca.pem",
      ),
    },
  ]) {
    assert.throws(() => resolveE2EWebServerRuntime(runtimeEnv(overrides)));
  }

  for (const name of [
    "E2E_PROFILE_SERVER_PID_FILE",
    "E2E_PROFILE_IDENTITY_FILE",
    "E2E_PROFILE_CREDENTIAL_GATE_FILE",
    "E2E_PROFILE_COMPROMISE_FILE",
    "E2E_PROFILE_TLS_CERT_FILE",
    "E2E_PROFILE_TLS_CA_CERT_FILE",
  ]) {
    assert.throws(() =>
      resolveE2EWebServerRuntime(runtimeEnv({ [name]: undefined })),
    );
  }
});
