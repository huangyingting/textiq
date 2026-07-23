import { createHash } from "node:crypto";

export const AUTHENTICATED_E2E_PROFILE_BIND_HOST = "127.0.0.1";
const DEFAULT_E2E_HOST = AUTHENTICATED_E2E_PROFILE_BIND_HOST;
const DEFAULT_E2E_PORT = "4000";

/**
 * Resolve the single browser/server origin used by Playwright and the
 * self-contained deterministic profile.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
export function resolveE2EOriginConfig(env = process.env) {
  const configuredUrl = env.E2E_BASE_URL || env.BASE_URL;
  const configuredPort =
    env.E2E_PROFILE === "1" && env.E2E_BASE_URL
      ? undefined
      : parsePort(env.PORT);

  if (configuredUrl) {
    const url = parseBaseUrl(configuredUrl);
    const explicitPort = extractCanonicalHostPort(configuredUrl, url);
    const urlPort = explicitPort ?? url.port;
    if (configuredPort) {
      if (urlPort && urlPort !== configuredPort) {
        throw new Error(
          `E2E_BASE_URL port ${urlPort} does not match PORT ${configuredPort}.`,
        );
      }
      if (!urlPort) {
        url.port = configuredPort;
      }
    }

    return {
      origin: explicitPort ? explicitHostOrigin(url, explicitPort) : url.origin,
      port: (explicitPort ?? url.port) || defaultPort(url.protocol),
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

export function parseAuthenticatedE2EProfileOrigin(
  value,
  name = "E2E_BASE_URL",
  env = process.env,
) {
  const url = parseAbsoluteUrl(value, name, undefined, ["https://"]);
  validateProfileHostname(url, name, env);
  const port = parseExplicitHostPort(value, url, name);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `${name} must be an origin without a path, query, or fragment.`,
    );
  }
  return preserveExplicitPort(url, port);
}

export function parseAuthenticatedE2EReadinessUrl(
  value,
  name = "E2E_PROFILE_READINESS_URL",
) {
  const url = parseAbsoluteUrl(value, name, undefined, ["http://"]);
  validateInternalLoopback(url, name, "http:");
  const port = parseExplicitHostPort(value, url, name);
  if (url.pathname !== "/ready" || url.search || url.hash) {
    throw new Error(
      `${name} must use the exact /ready path without a query or fragment.`,
    );
  }
  return preserveExplicitPort(url, port);
}

export function parseAuthenticatedE2EAppUrl(
  value,
  name = "E2E_PROFILE_APP_URL",
) {
  const url = parseAbsoluteUrl(value, name, undefined, ["http://"]);
  validateInternalLoopback(url, name, "http:");
  const port = parseExplicitHostPort(value, url, name);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `${name} must be an origin without a path, query, or fragment.`,
    );
  }
  return preserveExplicitPort(url, port);
}

function parseBaseUrl(value) {
  const url = parseAbsoluteUrl(
    value,
    "E2E_BASE_URL",
    `E2E_BASE_URL must be an absolute HTTP(S) URL: ${value}`,
    ["http://", "https://"],
  );

  /* node:coverage ignore next 5 */
  /* parseAbsoluteUrl accepts only the canonical http:// and https:// prefixes above. */
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

function parseAbsoluteUrl(value, name, invalidMessage, canonicalPrefixes) {
  validateRawUrl(value, name, invalidMessage, canonicalPrefixes);
  try {
    return new URL(value);
  } catch {
    throw new Error(invalidMessage ?? `${name} must be an absolute URL.`);
  }
}

function validateRawUrl(value, name, invalidMessage, canonicalPrefixes) {
  if (
    typeof value !== "string" ||
    !canonicalPrefixes.some((prefix) => value.startsWith(prefix)) ||
    [...value].some(isWhitespaceOrAsciiControl)
  ) {
    throw new Error(
      invalidMessage ??
        `${name} must use http: with the exact lowercase http:// prefix and contain no whitespace or ASCII control characters.`,
    );
  }
}

function isWhitespaceOrAsciiControl(character) {
  const codePoint = character.codePointAt(0);
  return (
    codePoint <= 0x1f || codePoint === 0x7f || character.trim().length === 0
  );
}

export function deriveAuthenticatedE2EHostname(runId, nonce) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId ?? "")) {
    throw new Error("The deterministic E2E run id is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(nonce ?? "")) {
    throw new Error(
      "The deterministic E2E run nonce must be 32 random bytes encoded as lowercase hex.",
    );
  }
  const label = createHash("sha256")
    .update(`${runId}\0${nonce}`)
    .digest("hex")
    .slice(0, 32);
  return `r-${label}.localhost`;
}

function validateProfileHostname(url, name, env) {
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use https:`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials.`);
  }
  const expected = deriveAuthenticatedE2EHostname(
    env.E2E_PROFILE_RUN_ID,
    env.E2E_PROFILE_RUN_NONCE,
  );
  if (
    env.E2E_PROFILE_HOSTNAME !== expected ||
    url.hostname !== expected ||
    !/^r-[a-f0-9]{32}\.localhost$/.test(url.hostname)
  ) {
    throw new Error(
      `${name} must use the exact per-run hostname derived from E2E_PROFILE_RUN_ID and E2E_PROFILE_RUN_NONCE.`,
    );
  }
}

function validateInternalLoopback(url, name, protocol) {
  if (url.protocol !== protocol) {
    throw new Error(`${name} must use ${protocol}`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials.`);
  }
  if (url.hostname !== AUTHENTICATED_E2E_PROFILE_BIND_HOST) {
    throw new Error(`${name} must use the exact IPv4 loopback address.`);
  }
}

function parseExplicitHostPort(value, url, name) {
  const portText = extractCanonicalHostPort(value, url);
  const port = Number(portText);
  if (
    !portText ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    (url.port && url.port !== portText)
  ) {
    throw new Error(
      `${name} must use an explicit canonical decimal port from 1 to 65535.`,
    );
  }
  return portText;
}

function extractCanonicalHostPort(value, url) {
  const authority = extractAuthority(value);
  const escapedHostname = url.hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escapedHostname}:([1-9]\\d*)$`).exec(
    authority ?? "",
  );
  const portText = match?.[1];
  const port = Number(portText);
  if (
    !portText ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    String(port) !== portText ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    authority !== `${url.hostname}:${portText}`
  ) {
    return undefined;
  }
  return portText;
}

function extractAuthority(value) {
  if (typeof value !== "string" || value.trim() !== value) return undefined;
  const schemeSeparator = value.indexOf("://");
  if (schemeSeparator < 0) return undefined;
  const authorityStart = schemeSeparator + 3;
  const authorityTail = value.slice(authorityStart);
  const boundary = authorityTail.search(/[/?#]/);
  return boundary < 0 ? authorityTail : authorityTail.slice(0, boundary);
}

function explicitHostOrigin(url, port) {
  return `${url.protocol}//${url.hostname}:${port}`;
}

function preserveExplicitPort(url, port) {
  const explicitUrl = `${explicitHostOrigin(url, port)}${url.pathname}${url.search}${url.hash}`;
  const returnExplicitUrl = () => explicitUrl;
  Object.defineProperties(url, {
    port: { value: port },
    toJSON: { value: returnExplicitUrl },
    toString: { value: returnExplicitUrl },
  });
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

/**
 * Resolves the Playwright `globalTimeout` for the deterministic profile.
 *
 * - `E2E_GLOBAL_TIMEOUT_MS` overrides everything when set to a positive integer.
 * - The `@required-profile` CI subset uses a bounded 18-minute budget.
 * - The full local profile (no grep or any other tag) gets 60 minutes so all
 *   101+ specs can finish without being cut off by the hard global clock.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {number} timeout in milliseconds
 */
export function resolveE2EProfileGlobalTimeout(env = process.env) {
  const override = env.E2E_GLOBAL_TIMEOUT_MS?.trim();
  if (override) {
    const ms = Number.parseInt(override, 10);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (env.E2E_PROFILE_GREP?.trim() === "@required-profile") {
    return 18 * 60_000;
  }
  return 60 * 60_000;
}
