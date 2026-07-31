import { isIP } from "node:net";

/**
 * Plain-Node runtime config helpers for collaboration entry points.
 *
 * These scripts cannot import TypeScript app modules, so this file owns the
 * inline/standalone process defaults used by `server.mjs` and `npm run collab`.
 */

export function resolveInlineCollabConfig(env = {}) {
  return {
    port: Number(env.PORT || 4000),
    hostname: env.HOST || "0.0.0.0",
    inlineCollab: env.COLLAB_INLINE !== "0",
  };
}

export function resolveInternalAppOrigin({ hostname, port }) {
  const unwrappedHostname = hostname.replace(/^\[|\]$/g, "");
  const internalHostname =
    unwrappedHostname === "0.0.0.0"
      ? "127.0.0.1"
      : unwrappedHostname === "::"
        ? "::1"
        : unwrappedHostname;
  const formattedHostname =
    isIP(internalHostname) === 6 ? `[${internalHostname}]` : internalHostname;
  return `http://${formattedHostname}:${port}`;
}

export function resolveStandaloneCollabConfig(env = {}) {
  return {
    port: Number(env.COLLAB_PORT || 1234),
    host: env.COLLAB_HOST || "0.0.0.0",
  };
}
