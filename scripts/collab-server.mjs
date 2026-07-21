#!/usr/bin/env node
/**
 * Self-hosted Yjs websocket sync server for TextIQ real-time collaboration
 * (US-019).
 *
 * Hosts the shared sync logic from `collab-core.mjs` as a standalone process on
 * its own port; clients connect to `ws://host:port/<documentId>`. This is the
 * production / separate-process deployment. In local dev the same core is also
 * mounted on the Next.js server (`server.mjs`) so a single forwarded port can
 * carry both the app and collaboration.
 *
 * Run with: `npm run collab` (PORT via COLLAB_PORT, default 1234).
 *
 * This is a Ralph tooling/runtime script, not part of the Next.js bundle.
 */
import http from "node:http";

import { resolveStandaloneCollabConfig } from "./collab-config.mjs";
import {
  createCollabWss,
  roomCount,
  connCount,
  flushStats,
  recentFlushFailures,
} from "./collab-core.mjs";
import {
  createCollabHealthHandler,
  createRuntimeAuthorizer,
  createRuntimeEvictionFlusher,
  emitDeploymentDiagnostics,
  resolveCollabDeployment,
  roomFromStandaloneUrl,
} from "./collab-runtime.mjs";
import { logScriptInfo } from "./structured-log.mjs";

const { port: PORT, host: HOST } = resolveStandaloneCollabConfig(process.env);

// Resolve and validate the deployment configuration at startup.
const deploymentConfig = resolveCollabDeployment(process.env);

if (
  !emitDeploymentDiagnostics(deploymentConfig, {
    runtimeMode: "standalone",
    scope: "collab.server.configure",
  })
) {
  process.exit(1);
}

const collabHealthHandler = createCollabHealthHandler({
  deploymentConfig,
  getStats: () => ({
    rooms: roomCount(),
    connections: connCount(),
    flushFailures: flushStats().flushFailures,
    recentFlushFailureCount: recentFlushFailures().length,
  }),
});

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    collabHealthHandler(req, res);
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("TextIQ collaboration server\n");
});

// Standalone: the room is the whole path (`/<documentId>`). Each upgrade is
// authenticated + authorized against the app's `/api/collab/authorize` route by
// forwarding the request cookies (issue #88). Point at the app with
// COLLAB_AUTHORIZE_URL (defaults to AUTH_URL or http://127.0.0.1:4000).
const authorize = createRuntimeAuthorizer({
  runtimeMode: "standalone",
  env: process.env,
});

// Flush dirty rooms to the app's internal recovery-snapshot endpoint before
// eviction (#497). Resolves against the same app origin used for authorize.
// When COLLAB_INTERNAL_SECRET is unset the flusher is a no-op (logs one
// warning), so dev without the secret still runs.
const onBeforeEvict = createRuntimeEvictionFlusher({
  runtimeMode: "standalone",
  env: process.env,
});
const { handleUpgrade } = createCollabWss(roomFromStandaloneUrl, {
  authorize,
  onBeforeEvict,
});
server.on("upgrade", (req, socket, head) => {
  handleUpgrade(req, socket, head);
});

server.listen(PORT, HOST, () => {
  logScriptInfo("collab.server.listen", "Yjs websocket server listening", {
    host: HOST,
    port: PORT,
    mode: deploymentConfig.mode,
  });
});
