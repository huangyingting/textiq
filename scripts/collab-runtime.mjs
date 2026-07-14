/**
 * Runtime assembly helpers for the plain-Node collaboration entry points.
 *
 * This module is the stable public facade consumed by `server.mjs` and
 * `scripts/collab-server.mjs`. Internal concerns are split across focused
 * modules for config diagnostics, health serialization, URL/room parsing, and
 * authorizer/flusher bootstrap.
 */

export {
  resolveCollabDeployment,
  emitDeploymentDiagnostics,
} from "./collab-runtime-config.mjs";
export {
  buildCollabHealthSummary,
  createCollabHealthHandler,
} from "./collab-runtime-health.mjs";
export {
  COLLAB_INLINE_PATH,
  resolveCollabServiceUrls,
  resolveCollabInternalSecret,
  roomFromInlineUrl,
  roomFromStandaloneUrl,
} from "./collab-runtime-service.mjs";
export {
  createRuntimeAuthorizer,
  createRuntimeEvictionFlusher,
} from "./collab-runtime-bootstrap.mjs";
