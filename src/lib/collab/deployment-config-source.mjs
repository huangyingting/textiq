/**
 * Canonical collaboration deployment policy shared by TypeScript and plain-ESM
 * runtime entry points.
 *
 * @typedef {'single-instance'|'unconfigured'} CollabDeploymentMode
 * @typedef {{ mode: CollabDeploymentMode, warnings: string[], healthy: boolean }} CollabDeploymentConfig
 */

/**
 * Derives the collaboration deployment configuration from environment variables.
 * Pure: no I/O, no side-effects.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {CollabDeploymentConfig}
 */
export function resolveDeploymentConfig(env = {}) {
  const singleInstance =
    env.COLLAB_SINGLE_INSTANCE === "1" || env.COLLAB_SINGLE_INSTANCE === "true";
  const instanceCount = Math.max(
    1,
    parseInt(env.COLLAB_INSTANCE_COUNT ?? "1", 10) || 1,
  );
  const stickyRouting =
    env.COLLAB_STICKY_ROUTING === "1" || env.COLLAB_STICKY_ROUTING === "true";

  if (singleInstance) {
    return { mode: "single-instance", warnings: [], healthy: true };
  }

  if (instanceCount > 1 && !stickyRouting) {
    return {
      mode: "unconfigured",
      warnings: [
        `COLLAB_INSTANCE_COUNT=${instanceCount} is set without COLLAB_STICKY_ROUTING=1. ` +
          "Clients on different instances will not converge — they will each see a private " +
          "in-memory room and edits will silently diverge. Either enable sticky routing at " +
          "your load balancer and set COLLAB_STICKY_ROUTING=1, or run a single instance " +
          "and set COLLAB_SINGLE_INSTANCE=1.",
      ],
      healthy: false,
    };
  }

  if (instanceCount > 1 && stickyRouting) {
    return { mode: "unconfigured", warnings: [], healthy: true };
  }

  return {
    mode: "unconfigured",
    warnings: [
      "COLLAB_SINGLE_INSTANCE is not set. Set COLLAB_SINGLE_INSTANCE=1 to explicitly " +
        "declare single-instance mode and silence this warning. Running without this " +
        "flag is safe for a single instance but will produce this advisory on every start.",
    ],
    healthy: true,
  };
}
