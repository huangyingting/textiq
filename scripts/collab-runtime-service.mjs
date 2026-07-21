export const COLLAB_INLINE_PATH = "/collab";

const DEFAULT_APP_BASE_URL = "http://127.0.0.1:4000";

const trimTrailingSlashes = (value) => String(value).trim().replace(/\/+$/, "");

const readOptionalString = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
};

/**
 * @typedef {'inline'|'standalone'} CollabRuntimeMode
 */

/**
 * Resolves the app base URL and internal service endpoints used by the collab
 * runtime. Inline mode always points at its own HTTP server to preserve existing
 * cookie forwarding and internal-flush behavior. Standalone mode points at
 * COLLAB_AUTHORIZE_URL's origin when explicitly configured, otherwise AUTH_URL
 * or the historical localhost default.
 *
 * @param {{ runtimeMode: CollabRuntimeMode, env?: Record<string, string|undefined>, port?: number }} options
 */
export function resolveCollabServiceUrls(options) {
  const env = options.env || {};

  if (options.runtimeMode === "inline") {
    const port = Number(options.port || env.PORT || 4000);
    const appBaseUrl = `http://127.0.0.1:${port}`;
    return {
      appBaseUrl,
      authorizeUrl: `${appBaseUrl}/api/collab/authorize`,
      flushUrl: `${appBaseUrl}/api/collab/flush`,
    };
  }

  const configuredAppBaseUrl = trimTrailingSlashes(
    env.AUTH_URL || DEFAULT_APP_BASE_URL,
  );
  const authorizeOverride = readOptionalString(env.COLLAB_AUTHORIZE_URL);
  const authorizeUrl =
    authorizeOverride || `${configuredAppBaseUrl}/api/collab/authorize`;
  const appBaseUrl = authorizeOverride
    ? (originFromAbsoluteUrl(authorizeOverride) ?? configuredAppBaseUrl)
    : configuredAppBaseUrl;
  return {
    appBaseUrl,
    authorizeUrl,
    flushUrl: `${appBaseUrl}/api/collab/flush`,
  };
}

function originFromAbsoluteUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Keeps COLLAB_INTERNAL_SECRET resolution centralized and normalized the same
 * way as the API endpoint. The flusher remains a no-op-with-warning when this is
 * falsy; the API endpoint remains fail-closed independently.
 *
 * @param {Record<string, string|undefined>} env
 */
export function resolveCollabInternalSecret(env = {}) {
  const secret = env.COLLAB_INTERNAL_SECRET?.trim();
  return secret ? secret : undefined;
}

/**
 * Inline room names are the path segment after `/collab/`.
 *
 * @param {string|undefined} url
 * @param {string} [collabPath]
 */
export function roomFromInlineUrl(url, collabPath = COLLAB_INLINE_PATH) {
  const pathname = (url || "/").split("?")[0];
  const room = pathname.slice(collabPath.length).replace(/^\/+/, "");
  return room || "default";
}

/**
 * Standalone room names are the full root path after the first slash.
 *
 * @param {string|undefined} url
 */
export function roomFromStandaloneUrl(url) {
  return (url || "/").slice(1).split("?")[0] || "default";
}
