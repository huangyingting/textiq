import { dirname, isAbsolute } from "node:path";
import { deriveAuthenticatedE2EHostname } from "./e2e-origin.mjs";

export function resolveE2EWebServerRuntime(env = process.env) {
  const runId = env.E2E_PROFILE_RUN_ID;
  const nonce = env.E2E_PROFILE_RUN_NONCE;
  const pidFile = env.E2E_PROFILE_SERVER_PID_FILE;
  const identityFile = env.E2E_PROFILE_IDENTITY_FILE;
  const credentialGateFile = env.E2E_PROFILE_CREDENTIAL_GATE_FILE;
  const compromiseFile = env.E2E_PROFILE_COMPROMISE_FILE;
  const tlsCertFile = env.E2E_PROFILE_TLS_CERT_FILE;
  const tlsCaCertFile = env.E2E_PROFILE_TLS_CA_CERT_FILE;
  if (!runId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
    throw new Error(
      "E2E_PROFILE_RUN_ID is required and must be a safe run id.",
    );
  }
  if (!nonce || !/^[a-f0-9]{64}$/.test(nonce)) {
    throw new Error(
      "E2E_PROFILE_RUN_NONCE is required and must be 32 bytes of lowercase hex.",
    );
  }
  const hostname = deriveAuthenticatedE2EHostname(runId, nonce);
  if (env.E2E_PROFILE_HOSTNAME !== hostname) {
    throw new Error(
      "E2E_PROFILE_HOSTNAME must exactly match the hostname derived for this run.",
    );
  }
  for (const [name, value] of [
    ["E2E_PROFILE_SERVER_PID_FILE", pidFile],
    ["E2E_PROFILE_IDENTITY_FILE", identityFile],
    ["E2E_PROFILE_CREDENTIAL_GATE_FILE", credentialGateFile],
    ["E2E_PROFILE_COMPROMISE_FILE", compromiseFile],
    ["E2E_PROFILE_TLS_CERT_FILE", tlsCertFile],
    ["E2E_PROFILE_TLS_CA_CERT_FILE", tlsCaCertFile],
  ]) {
    if (!value) throw new Error(`${name} is required.`);
    if (!isAbsolute(value))
      throw new Error(`${name} must be an absolute path.`);
  }
  const runtimeDirectory = dirname(pidFile);
  if (
    dirname(identityFile) !== runtimeDirectory ||
    dirname(credentialGateFile) !== runtimeDirectory ||
    dirname(compromiseFile) !== runtimeDirectory ||
    dirname(tlsCertFile) !== runtimeDirectory ||
    dirname(tlsCaCertFile) !== runtimeDirectory
  ) {
    throw new Error(
      "E2E profile PID, identity, credential-gate, compromise, and certificate files must share one runtime directory.",
    );
  }
  return {
    compromiseFile,
    credentialGateFile,
    identityFile,
    hostname,
    nonce,
    pidFile,
    runId,
    tlsCertFile,
    tlsCaCertFile,
  };
}
