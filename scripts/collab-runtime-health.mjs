/**
 * @typedef {{
 *   ok: boolean,
 *   rooms: number,
 *   connections: number,
 *   mode: 'single-instance'|'unconfigured',
 *   warnings: string[],
 *   healthy: boolean,
 *   flushFailures: number,
 *   recentFlushFailureCount: number,
 * }} CollabHealthSummary
 */

/**
 * Combines live runtime counters and deployment config into the JSON health
 * payload returned by both inline and standalone collaboration endpoints.
 *
 * @param {{
 *   deploymentConfig: { mode: 'single-instance'|'unconfigured', warnings: string[], healthy: boolean },
 *   rooms: number,
 *   connections: number,
 *   flushFailures: number,
 *   recentFlushFailureCount: number,
 * }} input
 * @returns {CollabHealthSummary}
 */
export function buildCollabHealthSummary(input) {
  return {
    ok: input.deploymentConfig.healthy,
    rooms: input.rooms,
    connections: input.connections,
    mode: input.deploymentConfig.mode,
    warnings: input.deploymentConfig.warnings,
    healthy: input.deploymentConfig.healthy,
    flushFailures: input.flushFailures,
    recentFlushFailureCount: input.recentFlushFailureCount,
  };
}

/**
 * Creates a ready-to-use HTTP request handler for the collaboration `/health`
 * endpoint. Both the standalone and inline entry points share the same
 * serialisation logic; only their `getStats` source differs.
 *
 * @param {{
 *   deploymentConfig: { mode: string, warnings: string[], healthy: boolean },
 *   getStats: () => { rooms: number, connections: number, flushFailures: number, recentFlushFailureCount: number },
 * }} options
 * @returns {(req: unknown, res: { writeHead: Function, end: Function }) => void}
 */
export function createCollabHealthHandler({ deploymentConfig, getStats }) {
  return function handleCollabHealth(_req, res) {
    const stats = getStats();
    const summary = buildCollabHealthSummary({
      deploymentConfig,
      rooms: stats.rooms,
      connections: stats.connections,
      flushFailures: stats.flushFailures,
      recentFlushFailureCount: stats.recentFlushFailureCount,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(summary));
  };
}
