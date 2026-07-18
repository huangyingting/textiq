import process from "node:process";

import {
  assertLiveE2ECredentialGate,
  resolveLiveCredentialGateConfig,
  sendE2ERequestOverVerifiedProxy,
} from "./e2e-credential-gate.mjs";
import {
  authenticateE2EProfile,
  precompileE2EProfileRoutes,
  resolveE2EWebServerCredentials,
} from "./e2e-web-server.mjs";

export async function runE2EGlobalSetup({
  env = process.env,
  assertGate = assertE2ECredentialGate,
  precompile = precompileE2EProfile,
} = {}) {
  if (env.E2E_PROFILE_EXTERNAL_SERVER !== "1") {
    throw new Error(
      "The deterministic E2E profile must be started through `npm run test:e2e:profile`; direct Playwright profile invocation cannot access the secure server.",
    );
  }
  const config = resolveE2EGlobalSetupConfig(env);
  await assertGate(config, { env });
  await precompile({ env });
  return async () => {};
}

export default runE2EGlobalSetup;

export async function establishE2ECredentialGate({
  env = process.env,
  ...options
} = {}) {
  return assertLiveE2ECredentialGate({ env, ...options });
}

export async function assertE2ECredentialGate(
  _config = resolveE2EGlobalSetupConfig(process.env),
  options = {},
) {
  return assertLiveE2ECredentialGate({
    env: options.env ?? process.env,
    ...options,
  });
}

export async function precompileE2EProfile({ env = process.env } = {}) {
  const config = resolveE2EGlobalSetupConfig(env);
  const credentials = resolveE2EWebServerCredentials(env);
  const fetchImpl = createAuthenticatedTransportFetch(env);
  const cookie = await authenticateE2EProfile({
    origin: config.origin,
    ...credentials,
    fetchImpl,
    assertServerIdentity: () => assertLiveE2ECredentialGate({ env }),
  });
  const routes = JSON.parse(env.E2E_PROFILE_PRECOMPILE_ROUTES ?? "[]");
  await precompileE2EProfileRoutes({
    cookie,
    fetchImpl,
    origin: config.origin,
    routes,
    assertServerIdentity: () => assertLiveE2ECredentialGate({ env }),
  });
}

export async function runE2EPrecompileProcess({ env = process.env } = {}) {
  return precompileE2EProfile({ env });
}

export function resolveE2EGlobalSetupConfig(env = process.env) {
  return resolveLiveCredentialGateConfig(env);
}

function createAuthenticatedTransportFetch(env) {
  return async (target, init = {}) => {
    const body =
      init.body === undefined
        ? undefined
        : Buffer.isBuffer(init.body)
          ? init.body
          : Buffer.from(
              init.body instanceof URLSearchParams
                ? init.body.toString()
                : String(init.body),
            );
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    if (body) headers["content-length"] = String(body.length);
    const result = await sendE2ERequestOverVerifiedProxy({
      body,
      env,
      headers,
      method: init.method ?? "GET",
      url: target.toString(),
    });
    return {
      headers: {
        get(name) {
          const value = result.headers[name.toLowerCase()];
          return Array.isArray(value) ? value.join(", ") : (value ?? null);
        },
        getSetCookie() {
          const value = result.headers["set-cookie"];
          return Array.isArray(value) ? value : value ? [value] : [];
        },
      },
      status: result.status,
      text: async () => result.body.toString("utf8"),
      url: result.url,
    };
  };
}
