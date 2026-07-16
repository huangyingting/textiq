import { createCollabAuthorizer } from "./collab-auth.mjs";
import { createEvictionFlusher } from "./collab-flush.mjs";
import {
  resolveCollabInternalSecret,
  resolveCollabServiceUrls,
} from "./collab-runtime-service.mjs";

/**
 * @typedef {'inline'|'standalone'} CollabRuntimeMode
 */

/**
 * @param {{ runtimeMode: CollabRuntimeMode, env?: Record<string, string|undefined>, port?: number, fetchImpl?: typeof fetch }} options
 */
export function createRuntimeAuthorizer(options) {
  const urls = resolveCollabServiceUrls(options);
  return createCollabAuthorizer({
    authorizeUrl: urls.authorizeUrl,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.env?.COLLAB_AUTHORIZE_TIMEOUT_MS,
  });
}

/**
 * @param {{ runtimeMode: CollabRuntimeMode, env?: Record<string, string|undefined>, port?: number, fetchImpl?: typeof fetch }} options
 */
export function createRuntimeEvictionFlusher(options) {
  const env = options.env || {};
  const urls = resolveCollabServiceUrls(options);
  return createEvictionFlusher({
    flushUrl: urls.flushUrl,
    internalSecret: resolveCollabInternalSecret(env),
    fetchImpl: options.fetchImpl,
  });
}
