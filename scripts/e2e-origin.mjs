const DEFAULT_E2E_HOST = "127.0.0.1";
const DEFAULT_E2E_PORT = "4000";

/**
 * Resolve the single browser/server origin used by Playwright and the
 * self-contained deterministic profile.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
export function resolveE2EOriginConfig(env = process.env) {
  const configuredUrl = env.E2E_BASE_URL || env.BASE_URL;
  const configuredPort = parsePort(env.PORT);

  if (configuredUrl) {
    const url = parseBaseUrl(configuredUrl);
    if (configuredPort) {
      if (url.port && url.port !== configuredPort) {
        throw new Error(
          `E2E_BASE_URL port ${url.port} does not match PORT ${configuredPort}.`,
        );
      }
      if (!url.port) {
        url.port = configuredPort;
      }
    }

    return {
      origin: url.origin,
      port: url.port || defaultPort(url.protocol),
      serverHost: env.HOST || unbracket(url.hostname),
    };
  }

  const port = configuredPort || DEFAULT_E2E_PORT;
  const serverHost = env.HOST || DEFAULT_E2E_HOST;
  const browserHost = isWildcardHost(serverHost)
    ? DEFAULT_E2E_HOST
    : serverHost;
  const url = new URL("http://127.0.0.1");
  url.hostname = bracketIpv6(browserHost);
  url.port = port;

  return {
    origin: url.origin,
    port,
    serverHost,
  };
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
export function resolveE2EOrigin(env = process.env) {
  return resolveE2EOriginConfig(env).origin;
}

function parseBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`E2E_BASE_URL must be an absolute HTTP(S) URL: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `E2E_BASE_URL must use http: or https:, received ${url.protocol}`,
    );
  }
  if (url.username || url.password) {
    throw new Error("E2E_BASE_URL must not contain credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "E2E_BASE_URL must be an origin without a path, query, or fragment.",
    );
  }

  return url;
}

function parsePort(value) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(
      `PORT must be an integer from 1 to 65535, received ${value}`,
    );
  }
  return String(parsed);
}

function defaultPort(protocol) {
  return protocol === "https:" ? "443" : "80";
}

function isWildcardHost(host) {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

function bracketIpv6(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function unbracket(host) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
