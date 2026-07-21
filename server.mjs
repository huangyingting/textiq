#!/usr/bin/env node
/**
 * Custom Next.js server that also hosts the Yjs collaboration websocket
 * (US-019) on the *same* port at the `/collab` path. Serving collaboration
 * through the app origin means a single forwarded port (e.g. VS Code port
 * forwarding, a tunnel, or a single reverse-proxy host) carries both the app
 * and the realtime socket, so the browser derives the websocket URL from the
 * page origin (`resolveCollabWsUrl`) and collaboration works automatically with
 * no extra port to forward or configure.
 *
 * Non-`/collab` upgrade requests (Next's HMR websocket in dev) are forwarded to
 * Next's own upgrade handler. The standalone `scripts/collab-server.mjs` remains
 * for deployments that prefer a separate collaboration process.
 *
 * Used by `npm run dev` and `npm start`. Set `COLLAB_INLINE=0` to disable the
 * inline collab socket (e.g. when running the standalone server instead).
 */
import { createServer } from "node:http";

import "dotenv/config";
import next from "next";

import { resolveInlineCollabConfig } from "./scripts/collab-config.mjs";
import {
  createCollabWss,
  roomCount,
  connCount,
  flushStats,
  recentFlushFailures,
} from "./scripts/collab-core.mjs";
import {
  createCollabHealthHandler,
  COLLAB_INLINE_PATH,
  createRuntimeAuthorizer,
  createRuntimeEvictionFlusher,
  emitDeploymentDiagnostics,
  resolveCollabDeployment,
  roomFromInlineUrl,
} from "./scripts/collab-runtime.mjs";

const dev = process.env.NODE_ENV !== "production";
const { port, hostname, inlineCollab } = resolveInlineCollabConfig(process.env);
const COLLAB_PATH = COLLAB_INLINE_PATH;

// Resolve and validate the deployment configuration at startup.
const deploymentConfig = resolveCollabDeployment(process.env);

if (
  !emitDeploymentDiagnostics(deploymentConfig, {
    runtimeMode: "inline",
    scope: "collab.server.configure",
    writeInlineWarning: (line) => console.warn(line),
    writeInlineError: (line) => console.error(line),
  })
) {
  process.exit(1);
}

const app = next({ dev, hostname, port, turbopack: false });
const handle = app.getRequestHandler();

await app.prepare();

const collabHealthHandler = createCollabHealthHandler({
  deploymentConfig,
  getStats: () => ({
    rooms: roomCount(),
    connections: connCount(),
    flushFailures: flushStats().flushFailures,
    recentFlushFailureCount: recentFlushFailures().length,
  }),
});

const server = createServer((req, res) => {
  // Health endpoint for the inline collab socket.
  if (req.url === `${COLLAB_PATH}/health`) {
    collabHealthHandler(req, res);
    return;
  }
  // Let Next parse the raw request URL itself. Supplying a pre-parsed legacy
  // url.parse object can bypass App Router dynamic route resolution in dev.
  handle(req, res);
});

if (inlineCollab) {
  // Authenticate + authorize each upgrade against the app's permission rules by
  // forwarding the request cookies to the `/api/collab/authorize` route on this
  // same server (issue #88). Unauthenticated/forbidden upgrades are refused.
  const authorize = createRuntimeAuthorizer({
    runtimeMode: "inline",
    env: process.env,
    port,
  });

  // Flush dirty rooms to the internal recovery-snapshot endpoint before
  // eviction (#497). Resolves against this same server's app origin. When
  // COLLAB_INTERNAL_SECRET is unset the flusher is a no-op (logs one warning),
  // so dev without the secret still runs.
  const onBeforeEvict = createRuntimeEvictionFlusher({
    runtimeMode: "inline",
    env: process.env,
    port,
  });

  // Room name is the path after `/collab/` (`/collab/<documentId>`).
  const { handleUpgrade: handleCollabUpgrade } = createCollabWss(
    (url) => roomFromInlineUrl(url, COLLAB_PATH),
    { authorize, onBeforeEvict },
  );

  const handleNextUpgrade = app.getUpgradeHandler();

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url || "/", "http://localhost");
    if (pathname === COLLAB_PATH || pathname?.startsWith(`${COLLAB_PATH}/`)) {
      handleCollabUpgrade(req, socket, head);
      return;
    }
    // Everything else (Next.js HMR in dev) goes to Next.
    void handleNextUpgrade(req, socket, head);
  });
}

server.listen(port, hostname, () => {
  console.log(`▲ Ready on http://${hostname}:${port}`);
  if (inlineCollab) {
    console.log(
      `[collab] inline Yjs websocket mounted at ${COLLAB_PATH} ` +
        `[mode: ${deploymentConfig.mode}]`,
    );
  }
});
